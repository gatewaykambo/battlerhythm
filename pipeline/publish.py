"""Apply editor decisions and rebuild the public site data.

Approvers never edit the data files directly. The approval desk writes one small file per
decision into data/decisions/. This script folds those decisions in and rebuilds:
  site/data/published.json   Battle Rhythm Reports (approved, drafted pieces)
  site/data/wire.json        the Wire: headline links to the original reporting
  site/data/xposts.json      hand-picked X posts for the "On X" scroll
  site/data/meta.json        counts and timestamps
"""
from __future__ import annotations

import datetime as dt
import re
import sys

from common import (ARCHIVE_DIR, DATA, DECISIONS_DIR, LANES, META_PATH, PUBLISHED_PATH, QUEUE_PATH, WIRE_PATH,
                    XPOSTS_PATH, iso, load_json, load_yaml, now, parse_iso, save_json)

EDITABLE = ("headline", "summary", "why_it_matters", "take", "x_post", "fb_post", "lane")
X_URL = re.compile(r"^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{5,25})")


def public_record(item: dict, decision: dict) -> dict:
    draft = item.get("draft") or {}
    edits = decision.get("edits") or {}
    final = {k: (edits.get(k) if edits.get(k) not in (None, "") else draft.get(k, "")) for k in EDITABLE}
    lane = final.get("lane") if final.get("lane") in LANES else item["lane"]
    disclosures = sorted({f["disclosure"] for f in item.get("flags", []) if f.get("disclosure")})
    return {
        "id": item["id"],
        "lane": lane,
        "lane_label": LANES[lane],
        "headline": final["headline"] or item["source_title"],
        "summary": final["summary"],
        "why_it_matters": final["why_it_matters"],
        "take": final["take"],
        "take_by": decision.get("editor") or "Battle Rhythm editors",
        "source": item["source"],
        "source_url": item["source_url"],
        "source_published_at": item.get("published_at"),
        "approved_at": decision.get("decided_at") or iso(now()),
        "policy": bool(item.get("policy")),
        "state": item.get("state"),
        "score": item.get("score"),
        "hashtags": draft.get("hashtags", []),
        "x_post": final["x_post"],
        "fb_post": final["fb_post"],
        "disclosures": disclosures,
        "suicide_safe": any(f.get("type") == "suicide" for f in item.get("flags", [])),
    }


def wire_from_item(item: dict, stamp: str) -> dict:
    disclosures = sorted({f["disclosure"] for f in item.get("flags", []) if f.get("disclosure")})
    return {
        "id": item["id"], "headline": item["source_title"], "source": item["source"], "url": item["source_url"],
        "lane": item["lane"], "state": item.get("state"), "policy": bool(item.get("policy")), "score": item.get("score"),
        "published_at": item.get("published_at"), "found_at": stamp,
        "also": [{"source": a["source"], "url": a["url"]} for a in item.get("also_covered_by", [])[:4]],
        "disclosures": disclosures,
    }


def main() -> int:
    settings = load_yaml("settings.yml")
    qcfg = settings["queue"]
    queue = load_json(QUEUE_PATH, [])
    by_id = {it["id"]: it for it in queue}
    pub_by_id = {p["id"]: p for p in load_json(PUBLISHED_PATH, [])}
    wire = load_json(WIRE_PATH, [])
    wire_by_id = {w["id"]: w for w in wire}
    xposts = load_json(XPOSTS_PATH, [])
    log = []
    t = now()

    # 1. Fold in decisions, oldest first
    files = sorted(DECISIONS_DIR.glob("*.json"), key=lambda p: p.name.split("-")[-1]) if DECISIONS_DIR.exists() else []
    for path in files:
        d = load_json(path, None)
        path.unlink(missing_ok=True)
        if not isinstance(d, dict) or not d.get("id"):
            log.append(f"skipped unreadable decision {path.name}")
            continue
        item, status, who = by_id.get(d["id"]), d.get("status"), d.get("editor")
        if status == "approved" and item:
            pub_by_id[item["id"]] = public_record(item, d)
            item["status"] = "approved"
            log.append(f"report approved {d['id']} by {who}")
        elif status == "wire" and item:
            wire_by_id[item["id"]] = wire_from_item(item, d.get("decided_at") or iso(t))
            item["status"] = "wired"
            log.append(f"posted to the wire {d['id']} by {who}")
        elif status == "killed" and item:
            item["status"] = "killed"
            if not item.get("on_wire"):
                wire_by_id.pop(item["id"], None)
            log.append(f"killed {d['id']} by {who}")
        elif status == "killed_all":  # kill the report and pull its wire link too
            if item:
                item["status"] = "killed"
            wire_by_id.pop(d["id"], None)
            log.append(f"killed and pulled {d['id']} by {who}")
        elif status == "unpublished":
            pub_by_id.pop(d["id"], None)
            if item:
                item["status"] = "unpublished"
            log.append(f"report unpublished {d['id']} by {who}")
        elif status == "hide_wire":
            wire_by_id.pop(d["id"], None)
            log.append(f"wire link removed {d['id']} by {who}")
        elif status == "edited" and d["id"] in pub_by_id:
            rec = pub_by_id[d["id"]]
            for k, v in (d.get("edits") or {}).items():
                if k in EDITABLE and v not in (None, ""):
                    rec[k] = v
            if rec.get("lane") in LANES:
                rec["lane_label"] = LANES[rec["lane"]]
            log.append(f"report edited {d['id']} by {who}")
        elif status == "xpost_add":
            m = X_URL.match((d.get("url") or "").strip())
            if not m:
                log.append(f"rejected X link {d.get('url')!r}")
                continue
            post_id = m.group(2)
            xposts = [x for x in xposts if x["id"] != post_id]
            xposts.insert(0, {
                "id": post_id, "handle": m.group(1), "url": f"https://x.com/{m.group(1)}/status/{post_id}",
                "note": str(d.get("note") or "")[:200], "lane": d.get("lane") if d.get("lane") in LANES else None,
                "added_by": who, "added_at": d.get("decided_at") or iso(t),
            })
            log.append(f"X post added @{m.group(1)} by {who}")
        elif status == "xpost_remove":
            xposts = [x for x in xposts if x["id"] != d["id"]]
            log.append(f"X post removed {d['id']} by {who}")
        else:
            log.append(f"decision {status} for unknown or archived item {d['id']} ignored")
            continue
        if item is not None:
            item["decision"] = {k: d.get(k) for k in ("status", "editor", "editor_login", "decided_at")}

    # 2. Expire and archive the queue
    ttl = dt.timedelta(hours=qcfg["pending_ttl_hours"])
    keep_for = dt.timedelta(days=qcfg["keep_decided_days"])
    active, archived = [], {}
    for it in queue:
        found = parse_iso(it.get("found_at")) or t
        if it["status"] == "pending" and t - found > ttl:
            it["status"] = "expired"
        if it["status"] != "pending" and t - found > keep_for:
            archived.setdefault(found.strftime("%Y-%m"), []).append(it)
        else:
            active.append(it)
    for month, items in archived.items():
        path = ARCHIVE_DIR / f"{month}.json"
        save_json(path, load_json(path, []) + items)

    # 3. Wire: drop old links, point links at our Report when one exists
    wire_ttl = dt.timedelta(hours=qcfg.get("wire_ttl_hours", 72))
    wire = [w for w in wire_by_id.values() if t - (parse_iso(w.get("found_at")) or t) <= wire_ttl]
    for w in wire:
        if w["id"] in pub_by_id:
            w["report"] = True
        else:
            w.pop("report", None)
    wire.sort(key=lambda w: (w.get("published_at") or w.get("found_at") or ""), reverse=True)
    wire = wire[: qcfg.get("max_wire", 400)]

    # 4. Write outputs
    published = sorted(pub_by_id.values(), key=lambda p: p.get("approved_at") or "", reverse=True)[: qcfg["max_published"]]
    xposts = xposts[: qcfg.get("max_xposts", 30)]
    save_json(QUEUE_PATH, active)
    save_json(PUBLISHED_PATH, published)
    save_json(WIRE_PATH, wire)
    save_json(XPOSTS_PATH, xposts)
    last_run = load_json(DATA / "last_run.json", {})
    save_json(META_PATH, {
        "site_name": settings.get("site_name", "Battle Rhythm"),
        "updated_at": iso(t),
        "last_sweep_at": last_run.get("finished_at"),
        "report_count": len(published),
        "wire_count": len(wire),
        "lane_counts": {lane: sum(1 for w in wire if w["lane"] == lane) for lane in LANES},
        "pending_count": sum(1 for it in active if it["status"] == "pending"),
        "editors": settings.get("editors", []),
    })
    print("\n".join(log) or "no decisions to apply")
    print(f"queue: {len(active)} active · reports: {len(published)} · wire: {len(wire)} · X posts: {len(xposts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
