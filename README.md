# Turnstile Observer

A small Cloudflare Worker for inspecting and testing Turnstile's managed, non-interactive, and invisible modes.

It renders a test widget, validates its response through Siteverify, and shows the result alongside selected request and Cloudflare metadata for the current visitor.

## What it does

- Serves test pages at `/managed`, `/non-interactive`, and `/invisible`.
- Verifies a Turnstile response server-side and checks its action and hostname.
- Bounds each Siteverify call to 30 seconds and rejects validation request bodies over 4 KiB.
- Shows the current visitor's request details, including IP address, network information, and approximate location, only in that visitor's browser.
- Includes a copy action for the current response token and Siteverify response to aid testing.

This is a diagnostic tool, not an authentication system. Do not use it as a substitute for server-side application authorization.

## Run it locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the local configuration template and fill in the three Turnstile site keys and secret keys:

   ```sh
   cp .dev.vars.example .dev.vars
   ```

3. Start the Worker:

   ```sh
   npm run dev
   ```

4. Visit one of the three mode paths shown above.

## Deploy

Deploy your own copy, then configure its route or custom domain in the Cloudflare dashboard. This repository intentionally does not name a deployment domain.

Add the three site keys and three secret keys in the Worker settings. The repository uses `keep_vars` so later deploys preserve those remote values instead of replacing them from `wrangler.jsonc`.

### Site keys

In **Workers & Pages** → **your Worker** → **Settings** → **Variables and Secrets**, add these as plain-text variables using the site keys from your three Turnstile widgets:

- `TURNSTILE_MANAGED_SITEKEY`
- `TURNSTILE_NON_INTERACTIVE_SITEKEY`
- `TURNSTILE_INVISIBLE_SITEKEY`

Site keys are sent to the browser at runtime, but are kept out of the repository so each deployment can use its own widgets.

### Secret keys

You can set the secret keys with Wrangler, one per widget mode:

```sh
npx wrangler secret put TURNSTILE_MANAGED_SECRET
npx wrangler secret put TURNSTILE_NON_INTERACTIVE_SECRET
npx wrangler secret put TURNSTILE_INVISIBLE_SECRET
```

Then deploy:

```sh
npm run deploy
```

Site keys are necessarily sent to browsers at runtime, but this repository deliberately does not publish this Worker's site keys. Create widgets registered for your own hostname. Never commit `.dev.vars` or a Turnstile secret key.

### Rate limiting

If this Worker is exposed publicly, configure a rate-limiting rule in the Cloudflare dashboard (WAF → Rate limiting rules). That protection is intentionally managed at the Cloudflare edge rather than implemented in Worker code, so its threshold and response can be changed without a deployment.

## Data handling

The test page displays selected request metadata to the visitor making the request and sends that visitor's Turnstile token to Cloudflare's Siteverify endpoint for validation. It does not store application data itself.

Worker invocation logs are enabled and persisted in Cloudflare. Query strings are redacted before they are retained. Review Cloudflare's log retention and access controls before using the Worker with production traffic.

## Development

```sh
npm run check
```

Keep credentials out of the working tree and explain any change that affects request metadata, logging, or validation behavior.
