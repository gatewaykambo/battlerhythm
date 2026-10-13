"""Shared helpers for the Battle Rhythm pipeline."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import pathlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
DATA = ROOT / "data"
SITE_DATA = ROOT / "site" / "data"

QUEUE_PATH = DATA / "queue.json"
SEEN_PATH = DATA / "seen.json"
DECISIONS_DIR = DATA / "decisions"
ARCHIVE_DIR = DATA / "archive"
PUBLISHED_PATH = SITE_DATA / "published.json"
META_PATH = SITE_DATA / "meta.json"
WIRE_PATH = SITE_DATA / "wire.json"
COUNTDOWNS_PATH = SITE_DATA / "countdowns.json"
PULLED_PATH = DATA / "pulled.json"
SUGGESTIONS_PATH = DATA / "countdown_suggestions.json"

LANES = {
    "active_duty": "Active Duty",
    "veterans": "Veterans / VA",
    "first_responders": "First Responders",
    "plant_medicine": "Integrative Health & Policy",
}

TRACKING_PARAMS = re.compile(r"^(utm_|fbclid|gclid|mc_|ocid|cmpid|ref$|src$)")


def load_yaml(name: str) -> dict:
    with open(CONFIG / name, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_text(name: str) -> str:
    return (CONFIG / name).read_text(encoding="utf-8")


def load_json(path: pathlib.Path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    tmp.replace(path)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(d: dt.datetime) -> str:
    return d.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def canonical_url(url: str) -> str:
    """Strip tracking parameters and fragments so the same story dedupes."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    query = [(k, v) for k, v in parse_qsl(parts.query) if not TRACKING_PARAMS.match(k.lower())]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), urlencode(query), ""))


def title_key(title: str) -> str:
    """A loose fingerprint of a headline, so the same story from two feeds dedupes."""
    t = re.sub(r"\s+[-|–—]\s+[^-|–—]{2,40}$", "", title or "")  # drop " - Source Name" suffixes
    t = re.sub(r"[^a-z0-9 ]", "", t.lower())
    words = [w for w in t.split() if len(w) > 2]
    return " ".join(words[:12])


def make_id(url: str) -> str:
    return hashlib.sha1(canonical_url(url).encode("utf-8")).hexdigest()[:12]


def strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header|form)[^>]*>.*?</\1>", " ", html or "")
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&#8217;|&rsquo;", "'", text)
    text = re.sub(r"&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;", '"', text)
    text = re.sub(r"&#?\w+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def watchlist_flags(text: str, watchlist: dict) -> list[dict]:
    """Deterministic conflict flags from config/watchlist.yml."""
    found = []
    low = (text or "").lower()
    for key, group in (watchlist or {}).items():
        hits = [t for t in group.get("terms", []) if re.search(r"(?<![a-z0-9])" + re.escape(t.lower()) + r"(?![a-z0-9])", low)]
        if hits:
            found.append({
                "type": key,
                "label": group.get("label", key),
                "detail": ", ".join(sorted(set(hits))),
                "disclosure": group.get("disclosure", ""),
            })
    return found
