import csv
import hashlib
import html
import json
import random
import re
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Dict, List, Optional
from urllib.error import URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from flask import Flask, jsonify, render_template

try:
    from third_party.pubmed_sieve import helpers as sieve_helpers
    from third_party.pubmed_sieve import pubmed_sieve as sieve_query_builder
    PUBMED_SIEVE_IMPORT_ERROR = ""
except Exception as exc:
    sieve_helpers = None
    sieve_query_builder = None
    PUBMED_SIEVE_IMPORT_ERROR = str(exc)


APP_ROOT = Path(__file__).resolve().parent
FEEDS_CSV_PATH = APP_ROOT / "feeds.csv"
REFRESH_SECONDS = 15 * 60
MAX_SUMMARY_LEN = 900
MAX_ABSTRACT_LEN = 4000
PUBMED_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:a-z0-9]+\b", re.IGNORECASE)
PUBMED_SIEVE_QUERY_TERM = "transfusion"
PUBMED_SIEVE_DATE_FILTER = "\"last 6 months\"[dp]"
PUBMED_SIEVE_MAX_ITEMS = 150


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1].lower()
    return tag.lower()


def get_child_text(node: ET.Element, candidates: List[str]) -> str:
    for child in node:
        if local_name(child.tag) in candidates and child.text:
            text = child.text.strip()
            if text:
                return text
    return ""


def parse_pub_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None

    # Handles common RSS formats like RFC 2822.
    try:
        dt = parsedate_to_datetime(raw)
        if dt:
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        pass

    # Handles ISO8601-like timestamps.
    normalized = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def clean_html(raw: str) -> str:
    if not raw:
        return ""
    no_tags = re.sub(r"<[^>]+>", " ", raw)
    unescaped = html.unescape(no_tags)
    compact = re.sub(r"\s+", " ", unescaped).strip()
    if len(compact) <= MAX_SUMMARY_LEN:
        return compact
    return compact[:MAX_SUMMARY_LEN].rstrip() + "..."


class StudyDeck:
    def __init__(self, feeds_csv_path: Path, refresh_seconds: int = REFRESH_SECONDS) -> None:
        self.feeds_csv_path = feeds_csv_path
        self.refresh_seconds = refresh_seconds
        self.lock = threading.Lock()
        self.items: List[Dict] = []
        self.deck: List[Dict] = []
        self.pubmed_cache: Dict[str, Dict] = {}
        self.last_refresh_ts = 0.0
        self.last_error = ""

    def load_feeds(self) -> List[Dict[str, str]]:
        feeds: List[Dict[str, str]] = []
        if not self.feeds_csv_path.exists():
            return feeds

        with self.feeds_csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                name = (row.get("name") or "").strip()
                url = (row.get("url") or "").strip()
                enabled = (row.get("enabled") or "1").strip().lower()
                if not url:
                    continue
                if enabled in {"0", "false", "no", "off"}:
                    continue
                feeds.append({"name": name or "Unnamed Feed", "url": url})
        return feeds

    def fetch_feed(self, url: str) -> bytes:
        request = Request(
            url,
            headers={
                "User-Agent": "DoomScrollStudies/1.0 (+https://example.local)",
                "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
            },
        )
        with urlopen(request, timeout=12) as response:
            return response.read()

    def fetch_url(self, url: str, accept: str = "*/*") -> bytes:
        request = Request(
            url,
            headers={
                "User-Agent": "DoomScrollStudies/1.0 (+https://example.local)",
                "Accept": accept,
            },
        )
        with urlopen(request, timeout=12) as response:
            return response.read()

    def parse_feed_items(self, xml_bytes: bytes, configured_name: str, feed_url: str) -> List[Dict]:
        root = ET.fromstring(xml_bytes)
        root_tag = local_name(root.tag)
        parsed_items: List[Dict] = []

        if root_tag == "rss":
            channel = None
            for child in root:
                if local_name(child.tag) == "channel":
                    channel = child
                    break
            if channel is None:
                return parsed_items

            channel_title = get_child_text(channel, ["title"]) or configured_name
            for item in channel:
                if local_name(item.tag) != "item":
                    continue

                title = get_child_text(item, ["title"]) or "Untitled study"
                link = get_child_text(item, ["link"])
                published_raw = get_child_text(item, ["pubdate", "published", "updated", "date"])
                summary_raw = get_child_text(item, ["description", "summary", "content", "encoded"])
                guid = get_child_text(item, ["guid"])
                published_dt = parse_pub_date(published_raw)

                parsed_items.append(
                    self._build_study(
                        title=title,
                        link=link,
                        summary=summary_raw,
                        published_dt=published_dt,
                        journal_name=channel_title,
                        feed_url=feed_url,
                        stable_key=guid or link or title,
                    )
                )
            return parsed_items

        if root_tag == "feed":  # Atom
            feed_title = get_child_text(root, ["title"]) or configured_name
            for entry in root:
                if local_name(entry.tag) != "entry":
                    continue

                title = get_child_text(entry, ["title"]) or "Untitled study"
                link = ""
                for child in entry:
                    if local_name(child.tag) == "link":
                        rel = (child.attrib.get("rel") or "alternate").lower()
                        href = (child.attrib.get("href") or "").strip()
                        if rel == "alternate" and href:
                            link = href
                            break
                        if not link and href:
                            link = href

                published_raw = get_child_text(entry, ["published", "updated", "date"])
                summary_raw = get_child_text(entry, ["summary", "content"])
                entry_id = get_child_text(entry, ["id"])
                published_dt = parse_pub_date(published_raw)

                parsed_items.append(
                    self._build_study(
                        title=title,
                        link=link,
                        summary=summary_raw,
                        published_dt=published_dt,
                        journal_name=feed_title,
                        feed_url=feed_url,
                        stable_key=entry_id or link or title,
                    )
                )
            return parsed_items

        return parsed_items

    def _build_study(
        self,
        title: str,
        link: str,
        summary: str,
        published_dt: Optional[datetime],
        journal_name: str,
        feed_url: str,
        stable_key: str,
    ) -> Dict:
        if not stable_key:
            stable_key = f"{title}:{link}:{feed_url}"
        stable_hash = hashlib.sha1(stable_key.encode("utf-8", errors="ignore")).hexdigest()[:16]
        if published_dt:
            published_label = published_dt.strftime("%b %d, %Y")
            published_iso = published_dt.isoformat()
            published_sort_ts = published_dt.timestamp()
        else:
            published_label = "Date unavailable"
            published_iso = ""
            published_sort_ts = 0.0

        cleaned_summary = clean_html(summary) or "No abstract/summary included in this feed item."
        return {
            "id": stable_hash,
            "title": title.strip(),
            "link": link.strip(),
            "summary": cleaned_summary,
            "journal": journal_name.strip() or "Unknown journal",
            "feed_url": feed_url,
            "published_iso": published_iso,
            "published_label": published_label,
            "published_sort_ts": published_sort_ts,
        }

    def _rebuild_deck_locked(self) -> None:
        self.deck = self.items.copy()
        random.shuffle(self.deck)

    def fetch_pubmed_sieve_items(self) -> List[Dict]:
        if sieve_helpers is None or sieve_query_builder is None:
            raise RuntimeError(
                "pubmed-sieve unavailable. Install requirements or check third_party/pubmed_sieve. "
                f"Import error: {PUBMED_SIEVE_IMPORT_ERROR}"
            )

        # NCBI requests a contact email when using Entrez.
        if hasattr(sieve_helpers, "Entrez"):
            sieve_helpers.Entrez.email = "doomscroll-studies@example.com"

        base_query = sieve_query_builder.build_keyword_and_journal_query(
            keywords=[PUBMED_SIEVE_QUERY_TERM],
            journals=[],
            require_hasabstract=False,
        )
        if not base_query:
            return []

        query = f"({base_query}) AND ({PUBMED_SIEVE_DATE_FILTER})"
        df = sieve_helpers.pubmed_articles_for_query(query)
        if df is None or len(df) == 0:
            return []

        if len(df) > PUBMED_SIEVE_MAX_ITEMS:
            df = df.head(PUBMED_SIEVE_MAX_ITEMS)

        parsed: List[Dict] = []
        for row in df.to_dict(orient="records"):
            pmid = str(row.get("PMID") or "").strip()
            title = str(row.get("Title") or "").strip() or "Untitled PubMed study"
            journal = str(row.get("Journal") or "").strip() or "PubMed"
            abstract = str(row.get("Abstract") or "").strip()
            published_dt = self._year_to_datetime(row.get("Year"))
            parsed.append(
                self._build_study(
                    title=title,
                    link=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
                    summary=abstract or "No abstract available from PubMed.",
                    published_dt=published_dt,
                    journal_name=journal,
                    feed_url=f"pubmed-sieve:{PUBMED_SIEVE_QUERY_TERM}",
                    stable_key=f"pubmed-sieve:{pmid or title}",
                )
            )

        return parsed

    def _year_to_datetime(self, value: object) -> Optional[datetime]:
        if value is None:
            return None
        raw = str(value).strip()
        if not raw or raw.lower() == "nan":
            return None
        try:
            year = int(float(raw))
        except ValueError:
            return None
        if year < 1800 or year > 2200:
            return None
        return datetime(year, 1, 1, tzinfo=timezone.utc)

    def _refresh_locked(self) -> None:
        feeds = self.load_feeds()

        all_items: List[Dict] = []
        errors: List[str] = []
        if not feeds:
            errors.append("No RSS feeds configured. Add at least one row to feeds.csv.")

        for feed in feeds:
            name = feed["name"]
            url = feed["url"]
            try:
                xml_bytes = self.fetch_feed(url)
                parsed = self.parse_feed_items(xml_bytes, configured_name=name, feed_url=url)
                all_items.extend(parsed)
            except (URLError, TimeoutError, ET.ParseError, ValueError) as exc:
                errors.append(f"{name}: {exc}")

        try:
            all_items.extend(self.fetch_pubmed_sieve_items())
        except Exception as exc:
            errors.append(f"PubMed (pubmed-sieve): {exc}")

        deduped: Dict[str, Dict] = {}
        for item in all_items:
            dedupe_key = (item.get("link") or item["id"]).strip().lower()
            if not dedupe_key:
                dedupe_key = item["id"]
            if dedupe_key not in deduped:
                deduped[dedupe_key] = item

        self.items = sorted(
            deduped.values(),
            key=lambda x: x.get("published_sort_ts", 0.0),
            reverse=True,
        )
        valid_ids = {item["id"] for item in self.items}
        self.pubmed_cache = {k: v for k, v in self.pubmed_cache.items() if k in valid_ids}
        self._rebuild_deck_locked()
        self.last_error = "; ".join(errors) if errors else ""
        self.last_refresh_ts = time.time()

    def force_refresh(self) -> None:
        with self.lock:
            self._refresh_locked()

    def maybe_refresh(self) -> None:
        with self.lock:
            stale = (time.time() - self.last_refresh_ts) > self.refresh_seconds
            if stale or not self.items:
                self._refresh_locked()

    def get_next(self) -> Dict:
        self.maybe_refresh()
        with self.lock:
            if not self.deck and self.items:
                self._rebuild_deck_locked()

            if not self.deck:
                return {
                    "ok": False,
                    "message": self.last_error or "No studies available.",
                    "study": None,
                    "total_loaded": 0,
                    "remaining_in_deck": 0,
                    "last_refresh_iso": self._last_refresh_iso(),
                }

            study = self.deck.pop()
            return {
                "ok": True,
                "message": self.last_error,
                "study": {
                    "id": study["id"],
                    "title": study["title"],
                    "link": study["link"],
                    "summary": study["summary"],
                    "journal": study["journal"],
                    "published_iso": study["published_iso"],
                    "published_label": study["published_label"],
                    "feed_url": study["feed_url"],
                },
                "total_loaded": len(self.items),
                "remaining_in_deck": len(self.deck),
                "last_refresh_iso": self._last_refresh_iso(),
            }

    def _last_refresh_iso(self) -> str:
        if not self.last_refresh_ts:
            return ""
        return datetime.fromtimestamp(self.last_refresh_ts, tz=timezone.utc).isoformat()

    def get_abstract(self, study_id: str) -> Dict:
        self.maybe_refresh()
        with self.lock:
            study = next((item for item in self.items if item["id"] == study_id), None)
            if study is None:
                return {"ok": False, "message": "Study not found.", "study_id": study_id}

            cached = self.pubmed_cache.get(study_id)
            if cached is not None:
                return {
                    "ok": True,
                    "study_id": study_id,
                    "abstract": cached["abstract"],
                    "source": cached["source"],
                    "message": cached["message"],
                }

            title = study.get("title", "")
            link = study.get("link", "")
            feed_summary = study.get("summary", "")

        lookup_result = self._lookup_pubmed_abstract(title=title, link=link, fallback=feed_summary)

        with self.lock:
            self.pubmed_cache[study_id] = lookup_result

        return {
            "ok": True,
            "study_id": study_id,
            "abstract": lookup_result["abstract"],
            "source": lookup_result["source"],
            "message": lookup_result["message"],
        }

    def _lookup_pubmed_abstract(self, title: str, link: str, fallback: str) -> Dict:
        doi = self._extract_doi(title, link, fallback)
        if doi:
            term = f"{doi}[doi]"
        elif title.strip():
            term = f"\"{title.strip()}\"[Title]"
        else:
            term = ""

        if not term:
            return {
                "abstract": fallback or "No abstract available.",
                "source": "feed",
                "message": "No title/DOI available for PubMed lookup.",
            }

        try:
            query = urlencode(
                {
                    "db": "pubmed",
                    "retmode": "json",
                    "retmax": "1",
                    "sort": "relevance",
                    "term": term,
                    "tool": "doomscroll-studies",
                }
            )
            search_url = f"{PUBMED_ESEARCH_URL}?{query}"
            search_bytes = self.fetch_url(search_url, accept="application/json")
            payload = json.loads(search_bytes.decode("utf-8", errors="replace"))
            id_list = payload.get("esearchresult", {}).get("idlist", [])
            if not id_list:
                return {
                    "abstract": fallback or "No abstract available.",
                    "source": "feed",
                    "message": "PubMed match not found; using feed summary.",
                }

            pmid = str(id_list[0]).strip()
            fetch_query = urlencode(
                {
                    "db": "pubmed",
                    "id": pmid,
                    "retmode": "xml",
                    "tool": "doomscroll-studies",
                }
            )
            fetch_url = f"{PUBMED_EFETCH_URL}?{fetch_query}"
            fetch_bytes = self.fetch_url(fetch_url, accept="application/xml,text/xml;q=0.9,*/*;q=0.1")
            abstract_text = self._extract_abstract_from_pubmed_xml(fetch_bytes)
            if abstract_text:
                return {
                    "abstract": abstract_text,
                    "source": "pubmed",
                    "message": f"Loaded from PubMed PMID {pmid}.",
                }

            return {
                "abstract": fallback or "No abstract available.",
                "source": "feed",
                "message": f"PubMed PMID {pmid} has no abstract text; using feed summary.",
            }
        except (URLError, TimeoutError, ET.ParseError, ValueError, json.JSONDecodeError) as exc:
            return {
                "abstract": fallback or "No abstract available.",
                "source": "feed",
                "message": f"PubMed lookup failed ({exc}); using feed summary.",
            }

    def _extract_doi(self, *values: str) -> str:
        for raw in values:
            if not raw:
                continue
            text = unquote(raw)
            match = DOI_RE.search(text)
            if match:
                return match.group(0)
        return ""

    def _extract_abstract_from_pubmed_xml(self, xml_bytes: bytes) -> str:
        root = ET.fromstring(xml_bytes)
        chunks: List[str] = []
        for node in root.findall(".//Abstract/AbstractText"):
            text = "".join(node.itertext()).strip()
            if not text:
                continue
            label = (node.attrib.get("Label") or "").strip()
            if label:
                chunks.append(f"{label}: {text}")
            else:
                chunks.append(text)
        combined = "\n\n".join(chunks).strip()
        return combined if len(combined) <= MAX_ABSTRACT_LEN else combined[:MAX_ABSTRACT_LEN].rstrip() + "..."


app = Flask(__name__)
deck = StudyDeck(FEEDS_CSV_PATH)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/next")
def api_next():
    return jsonify(deck.get_next())


@app.get("/api/feeds")
def api_feeds():
    return jsonify({"feeds": deck.load_feeds()})


@app.post("/api/refresh")
def api_refresh():
    deck.force_refresh()
    return jsonify(
        {
            "ok": True,
            "message": deck.last_error,
            "total_loaded": len(deck.items),
            "last_refresh_iso": deck._last_refresh_iso(),
        }
    )


@app.get("/api/abstract/<study_id>")
def api_abstract(study_id: str):
    return jsonify(deck.get_abstract(study_id))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
