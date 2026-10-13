"""Sweep the feeds, score new stories, draft the best ones, and add them to the approval queue.

Usage:
  python pipeline/collect.py                 # live run (needs ANTHROPIC_API_KEY)
  python pipeline/collect.py --dry-run       # offline test: keyword scores, placeholder drafts
  python pipeline/collect.py --dry-run --fixtures tests/fixtures   # read local RSS files instead of the web
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import pathlib
import re
import sys
import time

import feedparser
import requests

import ai
from common import (DATA, LANES, QUEUE_PATH, SEEN_PATH, iso, load_json, load_text, load_yaml,
                    make_id, now, parse_iso, save_json, strip_html, title_key, watchlist_flags)

UA = "Mozilla/5.0 (compatible; BattleRhythmBot/0.1; news monitoring for a veterans news digest)"


def fetch_feed(feed: dict, fixtures: pathlib.Path | None) -> feedparser.FeedParserDict:
    if fixtures:
        slug = re.sub(r"[^a-z0-9]+", "-", feed["name"].lower()).strip("-")
        path = fixtures / f"{slug}.xml"
        if not path.exists():
            return feedparser.parse(b"")
        return feedparser.parse(path.read_bytes())
    r = requests.get(feed["url"], headers={"User-Agent": UA}, timeout=25)
    r.raise_for_status()
    return feedparser.parse(r.content)


def entry_time(e) -> dt.datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        t = e.get(key)
        if t:
            return dt.datetime(*t[:6], tzinfo=dt.timezone.utc)
    return None


def entry_source(e, feed: dict) -> str:
    src = e.get("source") or {}
    if isinstance(src, dict) and src.get("title"):
        return src["title"].strip()
    return feed["name"].split(" · ")[0] if not feed["name"].startswith("News search") else "News"


def clean_title(title: str, source: str) -> str:
    t = (title or "").strip()
    if source and t.endswith(" - " + source):
        t = t[: -(len(source) + 3)].strip()
    return re.sub(r"\s+", " ", t)


def article_text(url: str, limit: int) -> str:
    """Best-effort article text for the drafter. Paragraph text only; empty on failure."""
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=20, allow_redirects=True)
        if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
            return ""
        html = r.text
    except requests.RequestException:
        return ""
    paras = re.findall(r"(?is)<p[^>]*>(.*?)</p>", html)
    text = " ".join(strip_html(p) for p in paras)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 400:
        text = strip_html(html)[: limit // 2]
    return text[:limit]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="no API calls: keyword scores and placeholder drafts")
    ap.add_argument("--fixtures", type=pathlib.Path, help="read RSS from this folder instead of the web")
    args = ap.parse_args()

    dry = args.dry_run
    if not dry and not ai.has_key():
        print("ANTHROPIC_API_KEY is not set. Add it as a repository secret, or run with --dry-run to test.", file=sys.stderr)
        return 2

    feeds = load_yaml("feeds.yml").get("feeds", [])
    settings = load_yaml("settings.yml")
    watchlist = load_yaml("watchlist.yml")
    guide = load_text("editorial.md")
    lim, th, models = settings["limits"], settings["thresholds"], settings["models"]

    queue = load_json(QUEUE_PATH, [])
    seen = load_json(SEEN_PATH, {"ids": {}, "titles": {}})
    run = {"started_at": iso(now()), "dry_run": dry, "feeds_ok": [], "feeds_failed": [],
           "new": 0, "scored": 0, "queued": 0, "drafted": 0, "errors": []}

    cutoff = now() - dt.timedelta(hours=lim["max_age_hours"])
    candidates, batch_titles = [], set()

    # 1. Sweep
    for feed in feeds:
        try:
            parsed = fetch_feed(feed, args.fixtures)
            entries = parsed.entries[: lim["max_items_per_feed"]]
            run["feeds_ok"].append(f"{feed['name']} ({len(entries)})")
        except Exception as e:  # noqa: BLE001 - a dead feed must not stop the run
            run["feeds_failed"].append(f"{feed['name']}: {e.__class__.__name__}: {str(e)[:120]}")
            continue
        for e in entries:
            link = e.get("link")
            if not link or not e.get("title"):
                continue
            published = entry_time(e)
            if published and published < cutoff:
                continue
            source = entry_source(e, feed)
            title = clean_title(e.get("title"), source)
            sid, tkey = make_id(link), title_key(title)
            if sid in seen["ids"] or (tkey and tkey in seen["titles"]) or tkey in batch_titles:
                continue
            batch_titles.add(tkey)
            candidates.append({
                "id": sid,
                "title": title,
                "source": source,
                "url": link,
                "snippet": strip_html(e.get("summary", ""))[:600],
                "published_at": iso(published) if published else None,
                "lane_hint": feed.get("lane"),
                "kind": feed.get("kind", "news"),
                "weight": float(feed.get("weight", 1.0)),
                "feed": feed["name"],
            })
    run["new"] = len(candidates)

    # 2. Score
    # A batch that fails to score is skipped, not guessed at: its stories stay unseen
    # and get another chance on the next sweep.
    stamp = iso(now())
    scored_ok = []
    for start in range(0, len(candidates), lim["score_batch_size"]):
        batch = candidates[start:start + lim["score_batch_size"]]
        try:
            scores = ai.score_batch(batch, models["scorer"], dry=dry)
        except ai.AIError as e:
            run["errors"].append(f"scoring batch {start}: {e}")
            if "HTTP 4" in str(e) and "HTTP 429" not in str(e):
                run["errors"].append("Stopped: the Claude API rejected the request. Check the API key setup (see README).")
                break
            continue
        scored_ok.extend(batch)
        for it, s in zip(batch, scores):
            parts = {k: int(max(0, s.get(k, 0) or 0)) for k in ("relevance", "impact", "traction", "angle", "timeliness")}
            parts["relevance"] = min(parts["relevance"], 30)
            parts["impact"] = min(parts["impact"], 25)
            for k in ("traction", "angle", "timeliness"):
                parts[k] = min(parts[k], 15)
            total = min(100, round(sum(parts.values()) * it["weight"]))
            lane = s.get("lane") if s.get("lane") in LANES else (it["lane_hint"] if it["lane_hint"] in LANES else "veterans")
            state = s.get("state")
            it.update({
                "lane": lane,
                "score": total,
                "score_parts": parts,
                "score_why": str(s.get("why") or "")[:200],
                "policy": bool(s.get("policy")) or it["kind"] == "policy",
                "state": state.upper() if isinstance(state, str) and len(state) == 2 else None,
                "ai_flags": [f for f in (s.get("flags") or []) if isinstance(f, str)][:5],
            })
            seen["ids"][it["id"]] = stamp[:10]
            if it["title"]:
                seen["titles"][title_key(it["title"])] = stamp[:10]
        run["scored"] += len(batch)

    # 3. Keep what clears the bar, best first
    keep = sorted((c for c in scored_ok if c.get("score", 0) >= th["browse"]), key=lambda c: -c["score"])
    to_draft = [c for c in keep if c["score"] >= th["draft"]][: lim["max_drafts_per_run"]]
    draft_ids = {c["id"] for c in to_draft}

    for c in keep:
        text = ""
        draft = None
        if c["id"] in draft_ids:
            text = article_text(c["url"], lim["article_chars"]) if not args.fixtures else ""
            try:
                draft = ai.draft_item(c, text, guide, models["drafter"], dry=dry)
                run["drafted"] += 1
            except ai.AIError as e:
                run["errors"].append(f"drafting {c['id']}: {e}")
            if not dry:
                time.sleep(0.5)
        flags = watchlist_flags(" ".join([c["title"], c["snippet"], text]), watchlist)
        for f in c.get("ai_flags", []):
            flags.append({"type": f, "label": f.replace("_", " "), "detail": "", "disclosure": ""})
        tier = "sitrep" if c["score"] >= th["sitrep"] else ("draft" if draft else "browse")
        queue.append({
            "id": c["id"],
            "status": "pending",
            "tier": tier,
            "lane": c["lane"],
            "score": c["score"],
            "score_parts": c["score_parts"],
            "score_why": c["score_why"],
            "policy": c["policy"],
            "state": c["state"],
            "flags": flags,
            "source": c["source"],
            "source_url": c["url"],
            "source_title": c["title"],
            "snippet": c["snippet"],
            "published_at": c["published_at"],
            "found_at": stamp,
            "feed": c["feed"],
            "draft": draft,
        })
        run["queued"] += 1

    # 4. Prune the dedupe memory to 30 days
    prune = (now() - dt.timedelta(days=30)).date().isoformat()
    for k in ("ids", "titles"):
        seen[k] = {key: d for key, d in seen[k].items() if d >= prune}

    save_json(QUEUE_PATH, queue)
    save_json(SEEN_PATH, seen)
    run["finished_at"] = iso(now())
    save_json(DATA / "last_run.json", run)
    report(run)
    if candidates and not scored_ok:
        print("No stories could be scored. Failing the run so GitHub flags it.", file=sys.stderr)
        return 1
    return 0


def report(run: dict) -> None:
    lines = [
        f"## Battle Rhythm sweep {'(dry run)' if run['dry_run'] else ''}",
        f"- New stories found: **{run['new']}**",
        f"- Scored: {run['scored']} · Added to queue: **{run['queued']}** · Drafted: **{run['drafted']}**",
        f"- Feeds working: {len(run['feeds_ok'])} · Feeds failing: {len(run['feeds_failed'])}",
    ]
    if run["feeds_failed"]:
        lines.append("\n### Feeds that failed\n" + "\n".join(f"- {f}" for f in run["feeds_failed"]))
    if run["errors"]:
        lines.append("\n### Errors\n" + "\n".join(f"- {e}" for e in run["errors"][:20]))
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    sys.exit(main())
