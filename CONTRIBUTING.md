# Contributing

This is a personal project in its proof-of-concept phase. Issues and small
pull requests are welcome; larger changes are best discussed first.

Rules the repository enforces:

- `npm run check` must pass. It refuses API keys, secret assignments and em
  dashes (write a hyphen or restructure the sentence instead).
- `npm run typecheck`, `npm test` and `npm run build` must pass.
- Data files are produced only by the pipeline in `tools/`, never edited by hand.
- Every new data source goes into NOTICE.md with its licence before any derived
  file is committed. No paid data or metered APIs.
