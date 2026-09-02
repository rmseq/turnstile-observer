# Turnstile Observer

## Checks

- Run `npm run check` after changing code or configuration.
- Add or update a Worker test in `test/` when changing request handling, validation, or static-asset routing.

## Guardrails

- Never commit `.dev.vars`, Turnstile secrets, or deployment-specific site keys.
- Keep `keep_vars: true` in `wrangler.jsonc`; production values stay in Cloudflare.
- Keep query-string redaction enabled for persisted Worker logs.
- Deploy only when explicitly asked.

## Project layout

- Worker request handling lives in `src/index.ts`.
- Browser UI assets live in `public/` and must be routed through the `ASSETS` binding when `run_worker_first` is enabled.
