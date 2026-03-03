# TMScroll Studies

Python web app for "TikTok-like" doom scrolling through scientific studies from RSS feeds.

Default feed is the latest `Transfusion` RSS feed:

- `https://onlinelibrary.wiley.com/feed/15372995/most-recent`

## Features

- Full-screen, mobile-first swipe UI (swipe up/down on the study card).
- User accounts (signup/login/logout) with personal archived studies.
- Built-in usage tracking (event log in SQLite) for app opens, navigation, archive saves, and copy actions.
- Swipe right saves current study to your personal archive.
- Archive button opens your saved list; copy buttons support current study and full archive list.
- Tap-to-flip card: back side fetches abstract text from PubMed (falls back to feed summary if no match).
- Randomized study ordering from your configured feeds.
- Additional PubMed stream via `pubmed-sieve`: pulls studies matching `transfusion`, `transfused`, or `transfusing` in title/abstract (`[tiab]`) from the last 1 year.
- Feed list managed via `feeds.csv` (no code changes needed to add more journals).
- RSS/Atom feed items are only kept if title or abstract/summary contains one of: `transfusion`, `transfused`, `transfusing`.
- Runtime starts from persisted cache (`data/studies_cache.json`) for fast initial load.
- Runtime performs at most one external update check per week; if new studies are found from the last 7 days, they are appended to the end of the in-memory deck.
- If the last update check was within the last week, runtime skips the updater check.
- Study cache is saved in-repo at `data/studies_cache.json` so you can still update offline and push to GitHub manually.
- Offline updater can fetch at most weekly by default; pass `--force` to fetch immediately.
- Studies are kept for at least 1 year from when they were first pulled.

## Setup (React + Flask)

```bash
python3 -m pip install -r requirements.txt
cd frontend
npm install
npm run build
cd ..
python3 app.py
```

Then open:

- `http://127.0.0.1:5000`

If you change React code in `frontend/src`, rebuild before running Flask:

```bash
npm --prefix frontend run build
```

## Offline Update Workflow

Update the cached study database manually (outside app runtime):

```bash
python3 scripts/update_studies_cache.py
```

This writes:

- `data/studies_cache.json`

Then commit/push the updated JSON file whenever you want:

```bash
git add data/studies_cache.json
git commit -m "Update cached studies"
git push
```

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

After editing `feeds.csv`, run `python3 scripts/update_studies_cache.py` and then click **Reload cache** in the app (or restart app).

## Hostinger Auto-Update (Safe Pulls)

If your server writes to tracked cache files (like `data/studies_cache.json`), `git pull` can fail.
Use `scripts/auto_update_from_github.sh` for timer-based updates; it safely resets runtime-mutated tracked files before pulling.

One-time setup on server:

```bash
cd /opt/doomscroller
chmod +x scripts/auto_update_from_github.sh
```

If your service/timer already calls this path, restart timer/service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart doomscroller-autoupdate.timer
sudo systemctl start doomscroller-autoupdate.service
```

## PubMed Sieve Integration

This app vendors code from [pubmed-sieve](https://github.com/hbhargava7/pubmed-sieve) under `third_party/pubmed_sieve`.
During offline cache update, it adds PubMed studies matching:

- `(("transfusion"[tiab]) OR ("transfused"[tiab]) OR ("transfusing"[tiab])) AND ("last 1 year"[dp])`
