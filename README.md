# DoomScroll Studies

Python web app for "TikTok-like" doom scrolling through scientific studies from RSS feeds.

Default feed is the latest `Transfusion` RSS feed:

- `https://onlinelibrary.wiley.com/feed/15372995/most-recent`

## Features

- Full-screen, mobile-first swipe UI (swipe up/down on the study card).
- Tap-to-flip card: back side fetches abstract text from PubMed (falls back to feed summary if no match).
- Randomized study ordering from your configured feeds.
- Feed list managed via `feeds.csv` (no code changes needed to add more journals).
- Server-side refresh cache (auto refresh every 15 minutes, plus manual refresh button).

## Setup

```bash
python3 -m pip install -r requirements.txt
python3 app.py
```

Then open:

- `http://127.0.0.1:5000`

## Add More RSS Feeds

Edit `feeds.csv` and add rows:

```csv
name,url,enabled
Transfusion (Wiley),https://onlinelibrary.wiley.com/feed/15372995/most-recent,1
Blood Journal,https://ashpublications.org/blood/rss/site_1000001/0.xml,1
```

Notes:

- `enabled` values accepted as off: `0`, `false`, `no`, `off`
- Any other value means enabled

After editing `feeds.csv`, click **Refresh feeds** in the app.
