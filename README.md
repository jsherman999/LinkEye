# LinkEye

Local web, API, and CLI app for archiving public LinkedIn profile snapshots and comparing changes over time.

LinkEye stores profiles and immutable captures in SQLite. The monitor command checks active profiles and saves a new version only when normalized public content changes. It does not log in to LinkedIn, bypass restrictions, or automate private access; blocked or restricted responses are recorded as capture metadata.

LinkedIn sometimes returns `HTTP 999` with an authwall redirect script to unauthenticated server-side requests, even when the profile exists publicly in a normal browser or search result. LinkEye classifies that as `LinkedIn authwall blocked public fetch` and keeps the last successful archived version rather than treating the blocked response as a profile version.

## Run

```bash
npm install
cp .env.example .env.local
npm start
```

Open [http://127.0.0.1:3766](http://127.0.0.1:3766).

## CLI

```bash
npm run cli -- add https://www.linkedin.com/in/example-profile/ --label "Example Profile"
npm run cli -- list
npm run cli -- capture 1
npm run cli -- versions 1
npm run cli -- diff 1
npm run monitor
```

## API

- `GET /api/profiles`
- `GET /api/discover?q=name` for public web discovery of LinkedIn profile URLs
- `POST /api/profiles` with `{ "url": "...", "label": "...", "capture": true }`
- `POST /api/profiles/:id/capture`
- `GET /api/profiles/:id/versions`
- `GET /api/profiles/:id/diff?from=1&to=2`
- `POST /api/monitor/run`

## launchd

Generate LaunchAgent plists for the web server and daily monitor:

```bash
npm run launchd:install
launchctl load ~/Library/LaunchAgents/local.linkeye.server.plist
launchctl load ~/Library/LaunchAgents/local.linkeye.monitor.plist
```

The daily monitor time is controlled by `LINKEYE_DAILY_HOUR` and `LINKEYE_DAILY_MINUTE` in `.env.local`.

To remove the generated plist files:

```bash
npm run launchd:uninstall
```

## Data

By default, LinkEye writes SQLite data to `data/linkeye.sqlite`. Override it with `LINKEYE_DB_PATH`.
