"""Apply editor decisions and rebuild the public site data.

Approvers never edit queue.json directly. The approval page writes one small file per
decision into data/decisions/. This script folds those decisions into the queue,
updates site/data/published.json, expires stale items, and archives old ones.
"""
from __future__ import annotations

import datetime as dt
import sys

from common import (ARCHIVE_DIR, DATA, DECISIONS_DIR, LANES, META_PATH, PUBLISHED_PATH, QUEUE_PATH, iso,
                    load_json, load_yaml, now, parse_iso, save_json)

EDITABLE = ("headline", "summary", "why_it_matters", "take", "x_post", "fb_post", "lane")


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


def main() -> int:
    settings = load_yaml("settings.yml")
    qcfg = settings["queue"]
    queue = load_json(QUEUE_PATH, [])
    published = load_json(PUBLISHED_PATH, [])
    by_id = {it["id"]: it for it in queue}
    pub_by_id = {p["id"]: p for p in published}
    log = []

    # 1. Fold in decisions
    files = sorted(DECISIONS_DIR.glob("*.json")) if DECISIONS_DIR.exists() else []
    for path in files:
        d = load_json(path, None)
        if not isinstance(d, dict) or not d.get("id"):
            log.append(f"skipped unreadable decision {path.name}")
            path.unlink(missing_ok=True)
            continue
        item = by_id.get(d["id"])
        status = d.get("status")
        if status == "approved" and item:
            rec = public_record(item, d)
            pub_by_id[rec["id"]] = rec
            item["status"] = "approved"
            log.append(f"approved {d['id']} by {d.get('editor')}")
        elif status == "killed" and item:
            item["status"] = "killed"
            log.append(f"killed {d['id']} by {d.get('editor')}")
        elif status == "unpublished":
            pub_by_id.pop(d["id"], None)
            if item:
                item["status"] = "unpublished"
            log.append(f"unpublished {d['id']} by {d.get('editor')}")
        elif status == "edited" and d["id"] in pub_by_id:
            rec = pub_by_id[d["id"]]
            for k, v in (d.get("edits") or {}).items():
                if k in EDITABLE and v not in (None, ""):
                    rec[k] = v
            if rec.get("lane") in LANES:
                rec["lane_label"] = LANES[rec["lane"]]
            log.append(f"edited published {d['id']} by {d.get('editor')}")
        else:
            log.append(f"decision for unknown or archived item {d['id']} ignored")
        if item is not None:
            item["decision"] = {k: d.get(k) for k in ("status", "editor", "editor_login", "decided_at")}
        path.unlink(missing_ok=True)

    # 2. Expire and archive
    t = now()
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

    # 3. Write outputs
    published = sorted(pub_by_id.values(), key=lambda p: p.get("approved_at") or "", reverse=True)[: qcfg["max_published"]]
    save_json(QUEUE_PATH, active)
    save_json(PUBLISHED_PATH, published)
    last_run = load_json(DATA / "last_run.json", {})
    counts = {lane: sum(1 for p in published if p["lane"] == lane) for lane in LANES}
    save_json(META_PATH, {
        "site_name": settings.get("site_name", "Battle Rhythm"),
        "updated_at": iso(t),
        "last_sweep_at": last_run.get("finished_at"),
        "published_count": len(published),
        "lane_counts": counts,
        "pending_count": sum(1 for it in active if it["status"] == "pending"),
        "editors": settings.get("editors", []),
    })
    print("\n".join(log) or "no decisions to apply")
    print(f"queue: {len(active)} active, {sum(len(v) for v in archived.values())} archived · published: {len(published)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
