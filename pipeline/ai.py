"""Claude calls for scoring and drafting, plus an offline dry-run mode for testing.

Uses the Messages API directly over HTTPS so there is no SDK version to keep current.
The API key comes from the ANTHROPIC_API_KEY environment variable (a GitHub secret).
"""
from __future__ import annotations

import json
import os
import re
import time

import requests

from common import LANES

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


class AIError(RuntimeError):
    pass


def has_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _call(model: str, system: str, user: str, max_tokens: int = 4000, tool: dict | None = None):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise AIError("ANTHROPIC_API_KEY is not set")
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if tool:
        body["tools"] = [tool]
        body["tool_choice"] = {"type": "tool", "name": tool["name"]}
    headers = {"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"}
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    if workspace:  # needed only for keys that are not tied to a workspace
        headers["anthropic-workspace-id"] = workspace
    last = None
    for attempt in range(4):
        try:
            r = requests.post(API_URL, headers=headers, json=body, timeout=120)
        except requests.RequestException as e:
            last = str(e)
            time.sleep(2 ** attempt * 3)
            continue
        if r.status_code in (429, 500, 502, 503, 529):
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            time.sleep(2 ** attempt * 5)
            continue
        if r.status_code == 400 and tool and "tool_choice" in r.text and body.get("tool_choice", {}).get("type") == "tool":
            # Some models won't accept a forced form. Ask for it instead; the reader below handles either reply.
            body["tool_choice"] = {"type": "auto"}
            body["system"] = system + "\n\nAlways answer by calling the " + tool["name"] + " tool."
            continue
        if r.status_code != 200:
            raise AIError(f"HTTP {r.status_code}: {r.text[:500]}")
        data = r.json()
        if data.get("stop_reason") == "max_tokens":
            raise AIError("Reply was cut off at the length limit")
        if tool:
            for block in data.get("content", []):
                if block.get("type") == "tool_use":
                    return block.get("input") or {}
            text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
            return _json_from(text)
        return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
    raise AIError(f"Claude API failed after retries: {last}")


def _json_from(text: str):
    """Pull the first JSON value out of a model reply."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    for opener, closer in (("[", "]"), ("{", "}")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1], strict=False)  # tolerate line breaks inside text
            except json.JSONDecodeError:
                continue
    raise AIError("Reply was not valid JSON: " + text[:300])


# ---------------------------------------------------------------- scoring

SCORE_SYSTEM = """You are the triage desk for War Party TOC, a daily news watch for U.S. service members, veterans, first responders, and their families, edited by veterans.

You receive a batch of news items (headline, source, short snippet). Score each one for how much it belongs in our audience's morning briefing.

Lanes (pick the single best fit):
- active_duty: the U.S. military and military news worldwide: service members, military families, pay, benefits, deployments, bases, readiness, recruiting, military justice, DoD policy, U.S. forces in conflicts, and major wars or alliance news that affect the force
- veterans: VA, claims, health care, toxic exposure, PACT Act, transition, veteran employment and business, suicide prevention, veteran legislation
- first_responders: firefighters, police, EMS, dispatchers: line-of-duty benefits, PTSD and wellness, cancer presumptions, staffing, legislation
- plant_medicine (shown to readers as "Integrative Health & Policy"): psychedelic-assisted therapy research, VA and DoD studies of non-drug and alternative treatments, integrative therapies such as acupuncture or breathwork, and cannabis and hemp law and regulation, especially where veterans or responders are affected

Coverage rules:
- Military news counts worldwide.
- Veterans, first responders, and integrative health are U.S.-focused. A story about another country in those lanes scores 25 or less unless it directly affects Americans. Say which country in "why".

Rubric (integers):
- relevance 0-30: how directly it affects our audience
- impact 0-25: does it change pay, benefits, care, rights, or safety for real people
- traction 0-15: would people share it, argue about it, forward it to their unit
- angle 0-15: can veteran editors add a take nobody else can
- timeliness 0-15: breaking or developing scores high; old or evergreen scores low

Score honestly and spread the scores out. Most general news should land below 50. Celebrity, sports, and entertainment items score near zero unless the story is about a veteran or responder issue. Press-release fluff scores low on traction.

Also return:
- policy: true if the item is about a bill, law, regulation, rule, court ruling, agency policy, or ballot measure
- country: two-letter country code the story is mainly about ("US" for the United States), or null if unclear
- state: the two-letter U.S. state when the story is about one U.S. state, else null
- place: a short place name for a map label ("Fort Bragg, NC", "Persian Gulf", "Seoul"), or null if national or unclear
- lat, lon: approximate coordinates of that place, or null when place is null
- flags: any of "medical_claim" (makes or repeats a treatment or health claim), "suicide" (involves suicide or self-harm), "thin_source" (unclear sourcing), "opinion_source" (the item is itself an opinion piece), "graphic" (violence or graphic content). Empty list if none.
- why: one short line explaining the score

Record one score for every item with the record_scores tool, using each item's "i" number."""

SCORE_TOOL = {
    "name": "record_scores",
    "description": "Record the triage score for every item in the batch.",
    "input_schema": {
        "type": "object",
        "properties": {
            "scores": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "i": {"type": "integer"},
                        "lane": {"type": "string", "enum": ["active_duty", "veterans", "first_responders", "plant_medicine"]},
                        "relevance": {"type": "integer"}, "impact": {"type": "integer"}, "traction": {"type": "integer"},
                        "angle": {"type": "integer"}, "timeliness": {"type": "integer"},
                        "policy": {"type": "boolean"},
                        "country": {"type": ["string", "null"]}, "state": {"type": ["string", "null"]},
                        "place": {"type": ["string", "null"]}, "lat": {"type": ["number", "null"]}, "lon": {"type": ["number", "null"]},
                        "flags": {"type": "array", "items": {"type": "string"}},
                        "why": {"type": "string"},
                    },
                    "required": ["i", "lane", "relevance", "impact", "traction", "angle", "timeliness", "policy", "country", "flags", "why"],
                },
            }
        },
        "required": ["scores"],
    },
}


def score_batch(items: list[dict], model: str, lessons: list[dict] | None = None, dry: bool = False) -> list[dict]:
    if dry:
        return [_dry_score(i, it) for i, it in enumerate(items)]
    system = SCORE_SYSTEM
    if lessons:
        system += "\n\nRecently our editors pulled these stories after they were posted. Score similar stories lower:\n" + \
            "\n".join(f"- {l['headline'][:120]} (reason: {l['reason']})" for l in lessons)
    lines = [json.dumps({"i": i, "headline": it["title"], "source": it["source"], "lane_hint": it.get("lane_hint"),
                         "snippet": (it.get("snippet") or "")[:500]}, ensure_ascii=False) for i, it in enumerate(items)]
    out = (_call(model, system, "Score these items:\n" + "\n".join(lines), max_tokens=1200 + 300 * len(items), tool=SCORE_TOOL) or {}).get("scores")
    if not isinstance(out, list):
        raise AIError("Scorer did not return a list")
    by_i = {o.get("i"): o for o in out if isinstance(o, dict)}
    missing = [i for i in range(len(items)) if i not in by_i]
    if len(missing) > len(items) // 2:
        raise AIError(f"Scorer skipped {len(missing)} of {len(items)} items")
    return [by_i.get(i) or {"i": i, "relevance": 0, "why": "not scored"} for i in range(len(items))]


KEYWORDS = {
    "veterans": ["veteran", " va ", "veterans affairs", "pact act", "burn pit", "gi bill", "disability claim"],
    "active_duty": ["troops", "service members", "soldier", "sailor", "marine", "airman", "pentagon", "army", "navy", "air force", "space force", "military famil"],
    "first_responders": ["firefighter", "police", "officer", "paramedic", "ems", "dispatcher", "first responder"],
    "plant_medicine": ["psilocybin", "mdma", "psychedelic", "ibogaine", "cannabis", "marijuana", "hemp", "thc", "acupuncture"],
}


def _dry_score(i: int, it: dict, fallback: bool = False) -> dict:
    """Keyword scoring for offline tests. Never used for a live run with a key."""
    text = f" {it['title']} {it.get('snippet', '')} ".lower()
    best, hits = it.get("lane_hint") if it.get("lane_hint") in LANES else "veterans", 0
    for lane, ws in KEYWORDS.items():
        n = sum(text.count(w) for w in ws)
        if n > hits:
            best, hits = lane, n
    policy = any(w in text for w in (" bill", " law", "rule", "court", "ruling", "regulation", "ban"))
    return {"i": i, "lane": best, "relevance": min(30, 8 + hits * 7), "impact": min(25, 6 + hits * 5), "traction": 8,
            "angle": min(15, 5 + hits * 3), "timeliness": 10, "policy": policy, "country": "US", "state": None,
            "place": None, "lat": None, "lon": None, "flags": [], "why": "dry-run keyword score"}


# ---------------------------------------------------------------- grouping

GROUP_SYSTEM = """You group news headlines that report the same event or development, even when outlets word them differently.
Only group items that are truly about the same specific event (for example, two outlets reporting the same casualty update, or the same bill).
Do not group items that merely share a topic. Every item appears in exactly one group; single items are groups of one.
Record the groups with the record_groups tool, using each item's "i" number."""

GROUP_TOOL = {
    "name": "record_groups",
    "description": "Record which items report the same event.",
    "input_schema": {
        "type": "object",
        "properties": {"groups": {"type": "array", "items": {"type": "array", "items": {"type": "integer"}}}},
        "required": ["groups"],
    },
}


def group_events(items: list[dict], model: str) -> list[list[int]]:
    lines = [json.dumps({"i": i, "headline": it["title"], "source": it["source"]}, ensure_ascii=False) for i, it in enumerate(items)]
    out = (_call(model, GROUP_SYSTEM, "\n".join(lines), max_tokens=2000, tool=GROUP_TOOL) or {}).get("groups")
    if not isinstance(out, list):
        raise AIError("Grouping did not return a list")
    seen, groups = set(), []
    for g in out:
        g = [i for i in g if isinstance(i, int) and 0 <= i < len(items) and i not in seen]
        if g:
            seen.update(g)
            groups.append(g)
    return groups


# ---------------------------------------------------------------- drafting

DRAFT_SYSTEM = """You are the drafting desk for War Party TOC. You write the first draft of a TOC Report that a veteran editor will review, edit, and approve. Nothing you write is published without a human.

Follow the editorial guide below exactly. Above all:
- Use ONLY facts found in the SOURCE MATERIAL. Never invent numbers, names, quotes, dates, or outcomes.
- You may have the same story from several outlets. Combine their facts. If they disagree, use the more specific, better-sourced account, or say the reports differ.
- Write in your own words. Do not copy sentences from the sources. At most one short quote under 15 words, attributed.
- The public fields (headline, summary, why_it_matters, take, x_post, fb_post) state what is known with confidence. They never mention what the sources lack, never say "we only have the headline," and never talk about the drafting process. Put anything unknown or unconfirmed in open_questions, which only editors see.
- If the story is not about the United States, name the country in the headline or the first sentence of the summary.
- The take is clearly opinion, follows from the facts, and reflects the positions in the guide. Do not start it with "Opinion:"; the site labels it.
- If the story involves suicide, follow safe messaging and end the summary or take with: "If you or someone you know is struggling, call the Veterans Crisis Line: dial 988, then press 1."
- No medical advice or treatment claims.
- deadlines: list any future date the sources state that our audience would care about (a law taking effect, a vote, a comment period closing, an application deadline), as YYYY-MM-DD with a short label of eight words or fewer. Only dates stated in the sources. Empty list if none.

EDITORIAL GUIDE:
{guide}

Record the draft with the record_draft tool."""

DRAFT_FIELDS = {
    "headline": "Our own headline, plain and specific, under 90 characters, no clickbait.",
    "summary": "2-3 sentences, 40-80 words: what happened, in our own words.",
    "why_it_matters": "One sentence on what it means for the lane's audience.",
    "take": "2-4 sentences of opinion in War Party TOC's voice, first person plural (we).",
    "x_post": "A post for X under 230 characters. No link and no hashtags; both are added later.",
    "fb_post": "A Facebook post of 2-4 short paragraphs: the news, why it matters, our view, and one question that invites comments. No link; it is added later.",
    "open_questions": "For editors only: what the sources do not answer yet, or an empty string.",
}

DRAFT_TOOL = {
    "name": "record_draft",
    "description": "Record the first draft for the editor to review.",
    "input_schema": {
        "type": "object",
        "properties": dict(
            {k: {"type": "string", "description": v} for k, v in DRAFT_FIELDS.items()},
            hashtags={"type": "array", "items": {"type": "string"}, "description": "At most two relevant hashtags without the # sign."},
            deadlines={"type": "array", "items": {"type": "object", "properties": {"date": {"type": "string"}, "label": {"type": "string"}},
                                                  "required": ["date", "label"]}},
        ),
        "required": list(DRAFT_FIELDS) + ["hashtags", "deadlines"],
    },
}


def draft_item(item: dict, texts: list[tuple[str, str]], guide: str, model: str, dry: bool = False) -> dict:
    if dry:
        return {
            "headline": item["title"][:90],
            "summary": "[DRY RUN] This is placeholder text from an offline test. A live run writes a real summary here.",
            "why_it_matters": "[DRY RUN] Placeholder.",
            "take": "[DRY RUN] Placeholder take. A live run drafts the take in the voice set in config/editorial.md.",
            "x_post": "[DRY RUN] " + item["title"][:180], "fb_post": "[DRY RUN] " + item["title"],
            "hashtags": [], "open_questions": "", "deadlines": [{"date": "2026-12-11", "label": "[DRY RUN] sample deadline"}],
        }
    material = [
        f"HEADLINE: {item['title']}", f"LEAD SOURCE: {item['source']}",
        f"PUBLISHED: {item.get('published_at') or 'unknown'}", f"LANE: {LANES.get(item.get('lane'), item.get('lane'))}",
        f"COUNTRY: {item.get('country') or 'unknown'}   PLACE: {item.get('place') or 'unknown'}",
    ]
    for src, text in texts:
        material.append(f"\n--- ARTICLE TEXT FROM {src} ---\n{text}")
    out = _call(model, DRAFT_SYSTEM.replace("{guide}", guide), "SOURCE MATERIAL\n" + "\n".join(material), max_tokens=3000, tool=DRAFT_TOOL)
    if not isinstance(out, dict):
        raise AIError("Drafter did not return an object")
    out["hashtags"] = [re.sub(r"[^A-Za-z0-9_]", "", str(t)) for t in (out.get("hashtags") or [])][:2]
    for k in DRAFT_FIELDS:
        out[k] = str(out.get(k) or "").strip()
    out["take"] = re.sub(r"^(opinion|our take)\s*[:\-]\s*", "", out["take"], flags=re.I)
    good = []
    for d in out.get("deadlines") or []:
        if isinstance(d, dict) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("date", ""))) and d.get("label"):
            good.append({"date": d["date"], "label": str(d["label"])[:80]})
    out["deadlines"] = good[:3]
    return out
