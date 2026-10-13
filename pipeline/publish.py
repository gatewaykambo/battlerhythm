"""Apply editor decisions and rebuild the public site data.

Editors never edit the data files directly. The approval desk (and editor mode on the
site) writes one small file per decision into data/decisions/. This script folds them in:
  site/data/published.json   TOC Reports (approved, drafted pieces)
  site/data/wire.json        the Wire: headline links to the original reporting
  site/data/countdowns.json  confirmed deadlines
  site/data/meta.json        counts and timestamps
  data/pulled.json           pulled stories, kept for undo and for the scorer to learn from
"""
from __future__ import annotations

import datetime as dt
import sys

from common import (ARCHIVE_DIR, COUNTDOWNS_PATH, DATA, DECISIONS_DIR, LANES, META_PATH, PUBLISHED_PATH, PULLED_PATH,
                    QUEUE_PATH, SUGGESTIONS_PATH, WIRE_PATH, iso, load_json, load_yaml, make_id, now, parse_iso, save_json)

EDITABLE = ("headline", "summary", "why_it_matters", "take", "x_post", "fb_post", "lane")


def public_record(item: dict, decision: dict) -> dict:
    draft = item.get("draft") or {}
    edits = decision.get("edits") or {}
    final = {k: (edits.get(k) if edits.get(k) not in (None, "") else draft.get(k, "")) for k in EDITABLE}
    lane = final.get("lane") if final.get("lane") in LANES else item["lane"]
    return {
        "id": item["id"], "lane": lane, "lane_label": LANES[lane],
        "headline": final["headline"] or item["source_title"], "summary": final["summary"],
        "why_it_matters": final["why_it_matters"], "take": final["take"],
        "take_by": decision.get("editor") or "War Party TOC editors",
        "source": item["source"], "source_url": item["source_url"], "source_published_at": item.get("published_at"),
        "also": [{"source": a["source"], "url": a["url"]} for a in item.get("also_covered_by", [])[:4]],
        "approved_at": decision.get("decided_at") or iso(now()),
        "policy": bool(item.get("policy")), "state": item.get("state"), "country": item.get("country"),
        "place": item.get("place"), "lat": item.get("lat"), "lon": item.get("lon"), "score": item.get("score"),
        "hashtags": draft.get("hashtags", []), "x_post": final["x_post"], "fb_post": final["fb_post"],
        "disclosures": sorted({f["disclosure"] for f in item.get("flags", []) if f.get("disclosure")}),
        "suicide_safe": any(f.get("type") == "suicide" for f in item.get("flags", [])),
    }


def wire_from_item(item: dict, stamp: str) -> dict:
    return {
        "id": item["id"], "headline": item["source_title"], "source": item["source"], "url": item["source_url"],
        "lane": item["lane"], "state": item.get("state"), "country": item.get("country"), "place": item.get("place"),
        "lat": item.get("lat"), "lon": item.get("lon"), "policy": bool(item.get("policy")), "score": item.get("score"),
        "published_at": item.get("published_at"), "found_at": stamp,
        "also": [{"source": a["source"], "url": a["url"]} for a in item.get("also_covered_by", [])[:4]],
        "disclosures": sorted({f["disclosure"] for f in item.get("flags", []) if f.get("disclosure")}),
    }


def main() -> int:
    settings = load_yaml("settings.yml")
    qcfg = settings["queue"]
    t = now()
    queue = load_json(QUEUE_PATH, [])
    by_id = {it["id"]: it for it in queue}
    pub_by_id = {p["id"]: p for p in load_json(PUBLISHED_PATH, [])}
    wire_by_id = {w["id"]: w for w in load_json(WIRE_PATH, [])}
    countdowns = load_json(COUNTDOWNS_PATH, [])
    suggestions = load_json(SUGGESTIONS_PATH, [])
    pulled = load_json(PULLED_PATH, [])
    log = []

    def pull(kind: str, rec: dict, d: dict) -> None:
        pulled.insert(0, {"kind": kind, "id": rec["id"], "headline": rec.get("headline", ""), "reason": d.get("reason") or "",
                          "note": d.get("note") or "", "by": d.get("editor"), "at": d.get("decided_at") or iso(t), "record": rec})

    # 1. Fold in decisions, oldest first
    files = sorted(DECISIONS_DIR.glob("*.json"), key=lambda p: p.name.split("-")[-1]) if DECISIONS_DIR.exists() else []
    for path in files:
        d = load_json(path, None)
        path.unlink(missing_ok=True)
        if not isinstance(d, dict) or not d.get("id"):
            log.append(f"skipped unreadable decision {path.name}")
            continue
        item, status, who, did = by_id.get(d["id"]), d.get("status"), d.get("editor"), d["id"]
        if status == "approved" and item:
            pub_by_id[did] = public_record(item, d)
            item["status"] = "approved"
            log.append(f"report approved {did} by {who}")
        elif status == "wire" and item:
            wire_by_id[did] = wire_from_item(item, d.get("decided_at") or iso(t))
            item["status"] = "wired"
            log.append(f"posted to the wire {did} by {who}")
        elif status == "killed" and item:
            item["status"] = "killed"
            log.append(f"report skipped {did} by {who}")
        elif status == "killed_all":
            if item:
                item["status"] = "killed"
            if did in wire_by_id:
                pull("wire", wire_by_id.pop(did), d)
            log.append(f"skipped and pulled from the wire {did} by {who}")
        elif status in ("unpublished", "pull"):  # pull a TOC Report (and its wire link) off the site
            if did in pub_by_id:
                pull("report", pub_by_id.pop(did), d)
            if did in wire_by_id:
                pull("wire", wire_by_id.pop(did), d)
            if item:
                item["status"] = "pulled"
            log.append(f"pulled {did} by {who}: {d.get('reason')}")
        elif status == "hide_wire":
            if did in wire_by_id:
                pull("wire", wire_by_id.pop(did), d)
            log.append(f"wire link pulled {did} by {who}: {d.get('reason')}")
        elif status == "restore":
            for p in [p for p in pulled if p["id"] == did]:
                (pub_by_id if p["kind"] == "report" else wire_by_id)[did] = p["record"]
            pulled = [p for p in pulled if p["id"] != did]
            if did in pub_by_id and did in wire_by_id:
                wire_by_id[did]["report"] = True
            log.append(f"restored {did} by {who}")
        elif status == "edited" and did in pub_by_id:
            rec = pub_by_id[did]
            for k, v in (d.get("edits") or {}).items():
                if k in EDITABLE and v not in (None, ""):
                    rec[k] = v
            if (d.get("correction") or "").strip():
                rec["correction"] = {"note": d["correction"].strip()[:400], "at": d.get("decided_at") or iso(t), "by": who}
            log.append(f"report edited {did} by {who}")
        elif status == "countdown_add":
            date, label = str(d.get("date") or ""), str(d.get("label") or "").strip()[:80]
            if len(date) == 10 and label:
                cid = d.get("suggestion_id") or make_id(date + label)
                countdowns = [c for c in countdowns if c["id"] != cid]
                countdowns.append({"id": cid, "date": date, "label": label, "story_id": d.get("story_id"),
                                   "headline": d.get("headline"), "added_by": who, "added_at": d.get("decided_at") or iso(t)})
                suggestions = [s for s in suggestions if s["id"] != d.get("suggestion_id")]
                log.append(f"countdown added {date} {label} by {who}")
        elif status == "countdown_dismiss":
            suggestions = [s for s in suggestions if s["id"] != did]
            log.append(f"countdown suggestion dismissed {did} by {who}")
        elif status == "countdown_remove":
            countdowns = [c for c in countdowns if c["id"] != did]
            log.append(f"countdown removed {did} by {who}")
        else:
            log.append(f"decision {status} for unknown or archived item {did} ignored")
            continue
        if item is not None:
            item["decision"] = {k: d.get(k) for k in ("status", "editor", "editor_login", "decided_at", "reason")}

    # 2. Expire and archive the queue
    ttl, keep_for = dt.timedelta(hours=qcfg["pending_ttl_hours"]), dt.timedelta(days=qcfg["keep_decided_days"])
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

    # 3. Wire: drop old links, mark links that have a Report
    wire_ttl = dt.timedelta(hours=qcfg.get("wire_ttl_hours", 72))
    wire = [w for w in wire_by_id.values() if t - (parse_iso(w.get("found_at")) or t) <= wire_ttl]
    for w in wire:
        if w["id"] in pub_by_id:
            w["report"] = True
        else:
            w.pop("report", None)
    wire.sort(key=lambda w: (w.get("published_at") or w.get("found_at") or ""), reverse=True)
    wire = wire[: qcfg.get("max_wire", 400)]

    # 4. Countdowns: drop a day after their date; suggestions expire after two weeks or once past
    today = t.date().isoformat()
    yesterday = (t - dt.timedelta(days=1)).date().isoformat()
    countdowns = sorted([c for c in countdowns if c["date"] >= yesterday], key=lambda c: c["date"])
    two_weeks = iso(t - dt.timedelta(days=14))
    taken = {c["id"] for c in countdowns}
    suggestions = [s for s in suggestions if s["date"] >= today and s.get("found_at", "") >= two_weeks and s["id"] not in taken]

    # 5. Write outputs (lane labels always follow the current lane names)
    published = sorted(pub_by_id.values(), key=lambda p: p.get("approved_at") or "", reverse=True)[: qcfg["max_published"]]
    for p in published:
        if p.get("lane") in LANES:
            p["lane_label"] = LANES[p["lane"]]
    save_json(QUEUE_PATH, active)
    save_json(PUBLISHED_PATH, published)
    save_json(WIRE_PATH, wire)
    save_json(COUNTDOWNS_PATH, countdowns)
    save_json(SUGGESTIONS_PATH, suggestions)
    save_json(PULLED_PATH, pulled[: qcfg.get("max_pulled", 200)])
    last_run = load_json(DATA / "last_run.json", {})
    save_json(META_PATH, {
        "site_name": settings.get("site_name", "War Party TOC"), "updated_at": iso(t),
        "last_sweep_at": last_run.get("finished_at"), "report_count": len(published), "wire_count": len(wire),
        "lane_counts": {lane: sum(1 for w in wire if w["lane"] == lane) for lane in LANES},
        "pending_count": sum(1 for it in active if it["status"] == "pending"),
        "lanes": LANES, "editors": settings.get("editors", []),
    })
    print("\n".join(log) or "no decisions to apply")
    print(f"queue: {len(active)} active · reports: {len(published)} · wire: {len(wire)} · countdowns: {len(countdowns)} · pulled: {len(pulled)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
