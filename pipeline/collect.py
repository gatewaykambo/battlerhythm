"""Sweep the sources, score new stories, group duplicates, post the Wire, and draft TOC Reports.

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
from urllib.parse import quote

import feedparser
import requests

import ai
from common import (DATA, LANES, PULLED_PATH, QUEUE_PATH, SEEN_PATH, SUGGESTIONS_PATH, WIRE_PATH, iso, load_json,
                    load_text, load_yaml, make_id, now, save_json, strip_html, title_key, watchlist_flags)

UA = "Mozilla/5.0 (compatible; WarPartyTOC/0.2; news monitoring for a veterans news digest)"
GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=artlist&format=json&maxrecords={n}&timespan=2d&sort=datedesc"


# ------------------------------------------------------------------ sources

def fetch_entries(feed: dict, fixtures: pathlib.Path | None, limit: int) -> list[dict]:
    """Return normalized entries: link, title, summary, published (datetime or None), source."""
    if fixtures:
        slug = re.sub(r"[^a-z0-9]+", "-", feed["name"].lower()).strip("-")
        path = fixtures / f"{slug}.xml"
        return rss_entries(feedparser.parse(path.read_bytes()) if path.exists() else feedparser.parse(b""), feed, limit)
    if feed.get("type") == "gdelt":
        url = GDELT_URL.format(q=quote(feed["query"]), n=min(limit, 75))
        for wait in (6, 20, 45):  # GDELT allows about one request every five seconds; shared servers often need longer
            time.sleep(wait)
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if r.status_code != 429:
                break
        r.raise_for_status()
        try:
            data = r.json()
        except ValueError:
            raise RuntimeError("GDELT returned a non-JSON reply: " + r.text[:120])
        out = []
        for a in (data.get("articles") or [])[:limit]:
            try:
                published = dt.datetime.strptime(a.get("seendate") or "", "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
            except ValueError:
                published = None
            out.append({"link": a.get("url"), "title": a.get("title"), "summary": "", "published": published,
                        "source": re.sub(r"^www\.", "", (a.get("domain") or "news").lower())})
        return out
    r = requests.get(feed["url"], headers={"User-Agent": UA}, timeout=25)
    r.raise_for_status()
    return rss_entries(feedparser.parse(r.content), feed, limit)


def rss_entries(parsed, feed: dict, limit: int) -> list[dict]:
    out = []
    for e in parsed.entries[:limit]:
        published = None
        for key in ("published_parsed", "updated_parsed"):
            if e.get(key):
                published = dt.datetime(*e.get(key)[:6], tzinfo=dt.timezone.utc)
                break
        src = e.get("source") or {}
        source = src.get("title").strip() if isinstance(src, dict) and src.get("title") else feed["name"].split(" · ")[0]
        out.append({"link": e.get("link"), "title": e.get("title"), "summary": strip_html(e.get("summary", ""))[:600],
                    "published": published, "source": source})
    return out


def clean_title(title: str, source: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    for suffix in (" - " + source, " | " + source):
        if source and t.endswith(suffix):
            t = t[: -len(suffix)].strip()
    return t


def article_text(url: str, limit: int) -> str:
    """Paragraph text of an article, or empty when the page can't be read."""
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=20, allow_redirects=True)
        if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
            return ""
        html = r.text
    except requests.RequestException:
        return ""
    paras = [strip_html(p) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", html)]
    paras = [p for p in paras if len(p) > 60 and not re.search(r"(?i)cookie|subscribe|sign up|all rights reserved|newsletter", p)]
    return re.sub(r"\s+", " ", " ".join(paras)).strip()[:limit]


# ------------------------------------------------------------------ duplicates

STOP = set("the a an and or of to in on for with at by from as is are was were be after before over into about amid new says say said how what why who its it this that their his her".split())


def words(title: str) -> set[str]:
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", (title or "").lower()).split() if w not in STOP and len(w) > 1}


def group_by_words(ranked: list[dict]) -> list[list[int]]:
    """Fallback grouping when the AI grouping step is unavailable."""
    groups: list[list[int]] = []
    sets: list[set[str]] = []
    for i, c in enumerate(ranked):
        w = words(c["title"])
        for g, s in zip(groups, sets):
            shared = w & s
            if ranked[g[0]]["lane"] == c["lane"] and len(shared) >= 4 and len(shared) / max(1, min(len(w), len(s))) >= 0.5:
                g.append(i)
                break
        else:
            groups.append([i])
            sets.append(w)
    return groups


def collapse(ranked: list[dict], groups: list[list[int]]) -> list[dict]:
    """Keep the best-scored story of each group; the others become 'also covered by'."""
    kept = []
    for g in groups:
        g = sorted(set(g), key=lambda i: -ranked[i]["score"])
        lead = ranked[g[0]]
        lead["also"] = [{"source": ranked[i]["source"], "url": ranked[i]["url"], "title": ranked[i]["title"]} for i in g[1:]]
        kept.append(lead)
    return sorted(kept, key=lambda c: -c["score"])


# ------------------------------------------------------------------ main

def wire_record(c: dict, stamp: str) -> dict:
    """What the public Wire shows: the outlet's headline and a link. Nothing else from the source."""
    return {
        "id": c["id"], "headline": c["title"], "source": c["source"], "url": c["url"],
        "lane": c["lane"], "state": c["state"], "country": c["country"], "place": c["place"],
        "lat": c["lat"], "lon": c["lon"], "policy": c["policy"], "score": c["score"],
        "published_at": c["published_at"], "found_at": stamp,
        "also": [{"source": a["source"], "url": a["url"]} for a in c.get("also", [])[:4]],
    }


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
    hold_types = set(settings.get("hold_flags", []))

    queue = load_json(QUEUE_PATH, [])
    seen = load_json(SEEN_PATH, {"ids": {}, "titles": {}})
    pulled = load_json(PULLED_PATH, [])
    lessons = [{"headline": p.get("headline", ""), "reason": p.get("reason", "")} for p in pulled[:15] if p.get("reason")]
    run = {"started_at": iso(now()), "dry_run": dry, "feeds_ok": [], "feeds_failed": [], "new": 0, "scored": 0,
           "wired": 0, "queued": 0, "drafted": 0, "no_article": 0, "duplicates_merged": 0, "deadlines": 0, "errors": []}

    cutoff = now() - dt.timedelta(hours=lim["max_age_hours"])
    candidates, batch_titles = [], set()

    # 1. Sweep
    for feed in feeds:
        try:
            entries = fetch_entries(feed, args.fixtures, lim["max_items_per_feed"])
            run["feeds_ok"].append(f"{feed['name']} ({len(entries)})")
        except Exception as e:  # noqa: BLE001 - one dead source must not stop the run
            run["feeds_failed"].append(f"{feed['name']}: {e.__class__.__name__}: {str(e)[:120]}")
            continue
        for e in entries:
            if not e.get("link") or not e.get("title"):
                continue
            if e["published"] and e["published"] < cutoff:
                continue
            title = clean_title(e["title"], e["source"])
            sid, tkey = make_id(e["link"]), title_key(title)
            if sid in seen["ids"] or (tkey and tkey in seen["titles"]) or tkey in batch_titles:
                continue
            batch_titles.add(tkey)
            candidates.append({
                "id": sid, "title": title, "source": e["source"], "url": e["link"], "snippet": e["summary"],
                "published_at": iso(e["published"]) if e["published"] else None,
                "lane_hint": feed.get("lane"), "kind": feed.get("kind", "news"),
                "weight": float(feed.get("weight", 1.0)), "feed": feed["name"], "wire_only": bool(feed.get("wire_only")),
            })
    run["new"] = len(candidates)

    # 2. Score. A batch that fails is skipped (its stories get another chance next sweep), never guessed at.
    stamp = iso(now())
    scored_ok = []
    for start in range(0, len(candidates), lim["score_batch_size"]):
        batch = candidates[start:start + lim["score_batch_size"]]
        try:
            scores = ai.score_batch(batch, models["scorer"], lessons=lessons, dry=dry)
        except ai.AIError as e:
            run["errors"].append(f"scoring batch {start}: {e}")
            if "HTTP 4" in str(e) and "HTTP 429" not in str(e):
                run["errors"].append("Stopped: the Claude API rejected the request. Check the API key setup (see README).")
                break
            continue
        scored_ok.extend(batch)
        for it, s in zip(batch, scores):
            p = {k: int(max(0, s.get(k, 0) or 0)) for k in ("relevance", "impact", "traction", "angle", "timeliness")}
            parts = {"relevance": min(p["relevance"], 30), "impact": min(p["impact"], 25), "traction": min(p["traction"], 15),
                     "angle": min(p["angle"], 15), "timeliness": min(p["timeliness"], 15)}
            lane = s.get("lane") if s.get("lane") in LANES else (it["lane_hint"] if it["lane_hint"] in LANES else "veterans")
            state, country = s.get("state"), (s.get("country") or "").upper()[:2] or None
            lat, lon = s.get("lat"), s.get("lon")
            ok_coord = isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 and -180 <= lon <= 180
            it.update({
                "lane": lane, "score": min(100, round(sum(parts.values()) * it["weight"])), "score_parts": parts,
                "score_why": str(s.get("why") or "")[:200], "policy": bool(s.get("policy")) or it["kind"] == "policy",
                "state": state.upper() if isinstance(state, str) and len(state) == 2 and country in (None, "US") else None,
                "country": country, "place": str(s.get("place") or "")[:60] or None,
                "lat": round(float(lat), 3) if ok_coord else None, "lon": round(float(lon), 3) if ok_coord else None,
                "ai_flags": [f for f in (s.get("flags") or []) if isinstance(f, str)][:5],
            })
            seen["ids"][it["id"]] = stamp[:10]
            seen["titles"][title_key(it["title"])] = stamp[:10]
        run["scored"] += len(batch)

    # 3. Group duplicates: the same event from different outlets, even with different headlines
    ranked = sorted((c for c in scored_ok if c.get("score", 0) >= th["wire"]), key=lambda c: -c["score"])
    groups = None
    if ranked and not dry:
        try:
            groups = ai.group_events(ranked[:90], models["scorer"])
            covered = {i for g in groups for i in g}
            groups += [[i] for i in range(len(ranked)) if i not in covered]
        except ai.AIError as e:
            run["errors"].append(f"grouping: {e}")
    keep = collapse(ranked, groups or group_by_words(ranked))
    run["duplicates_merged"] = len(ranked) - len(keep)

    for c in keep:
        flags = watchlist_flags(" ".join([c["title"], c["snippet"]]), watchlist)
        for f in c.get("ai_flags", []):
            flags.append({"type": f, "label": f.replace("_", " "), "detail": "", "disclosure": ""})
        c["flags"] = flags
        c["held"] = any(f["type"] in hold_types for f in flags)

    # 4. Post the Wire; draft the best stories only when the full reporting can be read
    wire = load_json(WIRE_PATH, [])
    wire_ids = {w["id"] for w in wire}
    suggestions = load_json(SUGGESTIONS_PATH, [])
    attempts = 0
    for c in keep:
        draft = None
        if c["score"] >= th["draft"] and attempts < lim["max_drafts_per_run"] and not (c.get("wire_only") and not c.get("also")):
            attempts += 1
            texts = []
            if args.fixtures:
                texts = [(c["source"], (c["snippet"] + " ") * 20)]  # offline tests stand in for article text
            else:
                for src, url in [(c["source"], c["url"])] + [(a["source"], a["url"]) for a in c.get("also", [])[:2]]:
                    t = article_text(url, lim["article_chars"])
                    if len(t) >= lim["min_article_chars"] // 2:
                        texts.append((src, t))
            if sum(len(t) for _, t in texts) >= lim["min_article_chars"]:
                try:
                    draft = ai.draft_item(c, texts, guide, models["drafter"], dry=dry)
                    run["drafted"] += 1
                except ai.AIError as e:
                    run["errors"].append(f"drafting {c['id']}: {e}")
                body = " ".join(t for _, t in texts)
                extra = [f for f in watchlist_flags(body, watchlist) if f["type"] not in {x["type"] for x in c["flags"]}]
                c["flags"] += extra
                c["held"] = c["held"] or any(f["type"] in hold_types for f in extra)
            else:
                run["no_article"] += 1  # the reporting couldn't be read: Wire link only, no Report
            if not dry:
                time.sleep(0.5)
        if not c["held"] and c["id"] not in wire_ids:
            wire.append(wire_record(c, stamp))
            wire_ids.add(c["id"])
            run["wired"] += 1
        if draft:
            for d in draft.get("deadlines", []):
                suggestions.append({"id": make_id(c["id"] + d["date"] + d["label"]), "date": d["date"], "label": d["label"],
                                    "story_id": c["id"], "headline": draft.get("headline") or c["title"], "found_at": stamp})
                run["deadlines"] += 1
        if draft or c["held"]:
            queue.append({
                "id": c["id"], "status": "pending", "tier": "report" if draft else "hold",
                "sitrep": c["score"] >= th["sitrep"], "on_wire": not c["held"], "lane": c["lane"],
                "score": c["score"], "score_parts": c["score_parts"], "score_why": c["score_why"],
                "policy": c["policy"], "state": c["state"], "country": c["country"], "place": c["place"],
                "lat": c["lat"], "lon": c["lon"], "flags": c["flags"], "source": c["source"],
                "source_url": c["url"], "source_title": c["title"], "snippet": c["snippet"],
                "published_at": c["published_at"], "found_at": stamp, "feed": c["feed"],
                "also_covered_by": c.get("also", [])[:5], "draft": draft,
            })
            run["queued"] += 1
    save_json(WIRE_PATH, wire)
    save_json(SUGGESTIONS_PATH, list({s["id"]: s for s in suggestions}.values()))

    # 5. Prune the dedupe memory to 30 days
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
        f"## War Party TOC sweep {'(dry run)' if run['dry_run'] else ''}",
        f"- New stories found: **{run['new']}** · scored: {run['scored']} · duplicates merged: {run['duplicates_merged']}",
        f"- On the Wire: **{run['wired']}** · drafted as TOC Reports: **{run['drafted']}** · to the editors: **{run['queued']}**",
        f"- Report candidates skipped because the full article couldn't be read: {run['no_article']}",
        f"- Deadlines suggested for Countdowns: {run['deadlines']}",
        f"- Sources working: {len(run['feeds_ok'])} · failing: {len(run['feeds_failed'])}",
    ]
    if run["feeds_failed"]:
        lines.append("\n### Sources that failed\n" + "\n".join(f"- {f}" for f in run["feeds_failed"]))
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
