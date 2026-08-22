# Codex Worktime

Generate privacy-safe, offline Codex worktime report foundations for a configured Project Profile.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Tracer bullet

The current tracer bullet accepts a Project Profile JSON file and a sanitized events JSON file, then writes a local SQLite event store and an offline HTML report:

```sh
npm start -- report \
  --profile profile.json \
  --events events.json \
  --database /path/to/application-data/analytics.sqlite \
  --output report.html
```

`profile.json` contains a stable project id, display name, and configured root ids/paths. Each sanitized event contains only an id, timestamp, Hook event type, current working directory, and optional session/turn ids. Extra fields are ignored and are never stored or rendered.
