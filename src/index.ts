type Mode = "managed" | "non-interactive" | "invisible";

interface TurnstileBindings {
  TURNSTILE_MANAGED_SITEKEY?: string;
  TURNSTILE_NON_INTERACTIVE_SITEKEY?: string;
  TURNSTILE_INVISIBLE_SITEKEY?: string;
  TURNSTILE_MANAGED_SECRET?: string;
  TURNSTILE_NON_INTERACTIVE_SECRET?: string;
  TURNSTILE_INVISIBLE_SECRET?: string;
}

type TurnstileEnv = Env & TurnstileBindings;

interface TurnstileResult {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  metadata?: {
    ephemeral_id?: string;
  };
  "error-codes"?: string[];
}

const MODES: Record<Mode, { label: string }> = {
  managed: { label: "Managed" },
  "non-interactive": { label: "Non-interactive" },
  invisible: { label: "Invisible" },
};

const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "cf-ipcountry",
  "cf-visitor",
  "dnt",
  "priority",
  "sec-ch-ua",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-mobile",
  "sec-ch-ua-model",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-wow64",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent",
]);

const MAX_VALIDATION_REQUEST_BYTES = 4_096;
const SITEVERIFY_TIMEOUT_MS = 30_000;
const MODE_VARIABLES: Record<
  Mode,
  { sitekey: keyof TurnstileBindings; secret: keyof TurnstileBindings }
> = {
  managed: {
    sitekey: "TURNSTILE_MANAGED_SITEKEY",
    secret: "TURNSTILE_MANAGED_SECRET",
  },
  "non-interactive": {
    sitekey: "TURNSTILE_NON_INTERACTIVE_SITEKEY",
    secret: "TURNSTILE_NON_INTERACTIVE_SECRET",
  },
  invisible: {
    sitekey: "TURNSTILE_INVISIBLE_SITEKEY",
    secret: "TURNSTILE_INVISIBLE_SECRET",
  },
};
const HTML_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function modeFromPath(pathname: string): Mode | null {
  const name = pathname.slice(1);
  return name === "managed" ||
    name === "non-interactive" ||
    name === "invisible"
    ? name
    : null;
}

function valuesFor(mode: Mode, env: TurnstileEnv) {
  const { sitekey: sitekeyName, secret: secretName } = MODE_VARIABLES[mode];
  const sitekey = env[sitekeyName];
  const secret = env[secretName];
  return {
    sitekey: typeof sitekey === "string" ? sitekey : "",
    secret: typeof secret === "string" ? secret : "",
  };
}

type JsonBody = { value: unknown } | { error: "invalid" | "too-large" };

async function readJsonBody(request: Request): Promise<JsonBody> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isSafeInteger(contentLength) &&
    contentLength > MAX_VALIDATION_REQUEST_BYTES
  ) {
    return { error: "too-large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: "invalid" };

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_VALIDATION_REQUEST_BYTES) {
        await reader.cancel();
        return { error: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "invalid" };
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { error: "invalid" };
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function html(value: string) {
  return new Response(value, {
    headers: HTML_HEADERS,
  });
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function hasCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return (request.headers.get("Cookie") ?? "")
    .split(";")
    .some((cookie) => cookie.trim().startsWith(prefix));
}

function safeHeaders(request: Request): string[][] {
  return Array.from(request.headers)
    .filter(([name]) => SAFE_REQUEST_HEADERS.has(name))
    .sort(([left], [right]) => left.localeCompare(right));
}

function requestSnapshot(request: Request) {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const value = (field: string) =>
    typeof cf[field] === "string" || typeof cf[field] === "number"
      ? String(cf[field])
      : "Not supplied";
  const city = value("city");
  const country = request.headers.get("CF-IPCountry") ?? "Not supplied";
  const location =
    [
      city !== "Not supplied" ? city : "",
      country !== "Not supplied" ? country : "",
    ]
      .filter(Boolean)
      .join(", ") || "Not supplied";
  return {
    edge: [
      ["Ray ID", request.headers.get("CF-Ray") ?? "Not supplied"],
      ["Cloudflare colo", value("colo")],
      [
        "HTTP / TLS",
        [value("httpProtocol"), value("tlsVersion")]
          .filter((item) => item !== "Not supplied")
          .join(" / ") || "Not supplied",
      ],
      [
        "TCP RTT",
        typeof cf.clientTcpRtt === "number"
          ? `${cf.clientTcpRtt} ms`
          : "Not supplied",
      ],
    ],
    visitor: [
      ["IP address", request.headers.get("CF-Connecting-IP") ?? "Not supplied"],
      ["Network", value("asOrganization")],
      ["ASN", value("asn")],
      ["Approx. location", location],
      ["Network timezone", value("timezone")],
      [
        "CF clearance cookie",
        hasCookie(request, "cf_clearance") ? "Present" : "Not present",
      ],
    ],
    request: safeHeaders(request),
  };
}

function page(mode: Mode, env: TurnstileEnv, request: Request) {
  const meta = MODES[mode];
  const { sitekey } = valuesFor(mode, env);
  const snapshot = requestSnapshot(request);
  const list = (items: string[][], valueIds: Record<string, string> = {}) =>
    items
      .map(
        ([label, value]) =>
          `<div class="datum"><dt>${escapeHtml(label)}</dt><dd${valueIds[label] ? ` id="${escapeHtml(valueIds[label])}"` : ""}>${escapeHtml(value)}</dd></div>`,
      )
      .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#12110f" media="(prefers-color-scheme: dark)">
    <meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Turnstile Observer">
    <title>${meta.label} — Turnstile observer</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/styles.css">
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
    <script type="module" src="/app.js"></script>
  </head>
  <body data-mode="${mode}" data-action="turnstile-${mode}" data-sitekey="${escapeHtml(sitekey)}" data-configured="${Boolean(sitekey)}" data-worker-time="${Date.now()}">
    <main>
      <div class="stage">
        <section class="mode" aria-label="${meta.label} Turnstile mode">
          <div class="masthead">
            <h1>${meta.label}<br>mode.</h1>
            <aside class="signal-wrap"><pre id="signal" data-state="waiting" aria-hidden="true"></pre></aside>
            <div class="widget-wrap">
              <div id="widget"></div>
              ${mode === "invisible" && sitekey ? `<p class="invisible-placeholder">Invisible challenge runs automatically.</p>` : ""}
              <p class="note" id="configuration-note">${sitekey ? "" : "Sitekey not configured."}</p>
            </div>
          </div>
          <section class="trace" aria-label="Verification trace">
            <h2>Timeline</h2>
            <ol class="trace-grid">
              <li class="trace-item" data-state="pending"><span class="trace-rail" aria-hidden="true"><span class="trace-marker">○</span></span><span class="trace-label">Widget</span><span class="trace-value"><span id="trace-widget">Waiting to render</span><span class="trace-meta" id="trace-widget-meta"></span></span></li>
              <li class="trace-item" data-state="pending"><span class="trace-rail" aria-hidden="true"><span class="trace-marker">○</span></span><span class="trace-label">Challenge</span><span class="trace-value"><span id="trace-token">Awaiting response</span><span class="trace-meta" id="trace-token-meta"></span></span></li>
              <li class="trace-item" data-state="pending"><span class="trace-rail" aria-hidden="true"><span class="trace-marker">○</span></span><span class="trace-label">Siteverify</span><span class="trace-value trace-action"><span class="trace-detail"><span id="trace-verify">Not requested</span><span class="trace-meta" id="trace-verify-meta"></span></span><button id="run" type="button" data-visible="false">Validate</button></span></li>
            </ol>
            <section class="evidence" aria-label="Verification evidence">
              <section class="evidence-item" aria-label="Challenge token">
                <div class="evidence-heading">Challenge token <span id="token-evidence-status">Awaiting response</span></div>
                <button class="copy-action" id="copy-token" type="button" disabled>Copy token</button>
                <p class="evidence-note">Tokens expire after five minutes and can be validated once.</p>
              </section>
              <section class="evidence-item siteverify-evidence" aria-label="Siteverify response">
                <div class="evidence-heading">Siteverify response <span id="siteverify-evidence-status">Not requested</span></div>
                <pre class="evidence-value" id="siteverify-response" hidden></pre>
                <button class="copy-action" id="copy-siteverify" type="button" disabled>Copy response</button>
              </section>
            </section>
          </section>
        </section>
      </div>
      <details class="snapshot snapshot-details" aria-label="Cloudflare request"><summary>Cloudflare request</summary><div class="data-grid"><div class="group">${list(snapshot.edge)}</div><div class="group">${list(snapshot.visitor, { "CF clearance cookie": "clearance-cookie" })}</div></div></details>
      <details class="snapshot snapshot-details" id="browser-environment" aria-label="Browser environment"><summary>Browser environment</summary><div class="data-grid" id="browser-data"><div class="group"><div class="datum"><dt>Browser context</dt><dd>Open to inspect.</dd></div></div></div></details>
      ${snapshot.request.length ? `<details class="request-details"><summary>Safe request headers</summary><div class="group">${list(snapshot.request)}</div></details>` : ""}
    </main>
  </body>
</html>`;
}

async function validate(request: Request, mode: Mode, env: TurnstileEnv) {
  const rayId = request.headers.get("CF-Ray") ?? undefined;
  const clearanceCookie = hasCookie(request, "cf_clearance");
  const { secret } = valuesFor(mode, env);
  if (!secret)
    return json(
      {
        success: false,
        errors: ["This mode has no server secret configured."],
        ray_id: rayId,
        clearance_cookie: clearanceCookie,
      },
      503,
    );

  const body = await readJsonBody(request);
  if ("error" in body) {
    return json(
      {
        success: false,
        errors: [
          body.error === "too-large"
            ? "Validation request body is too large."
            : "Invalid request body.",
        ],
        ray_id: rayId,
        clearance_cookie: clearanceCookie,
      },
      body.error === "too-large" ? 413 : 400,
    );
  }
  const token =
    typeof body.value === "object" &&
    body.value !== null &&
    "token" in body.value &&
    typeof body.value.token === "string"
      ? body.value.token
      : "";
  if (!token || token.length > 2048)
    return json(
      {
        success: false,
        errors: ["Missing or invalid Turnstile response."],
        ray_id: rayId,
        clearance_cookie: clearanceCookie,
      },
      400,
    );

  const validationStarted = Date.now();
  let result: TurnstileResult;
  let verificationMs: number;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") ?? "",
        }),
      },
    );
    result = await response.json<TurnstileResult>();
    verificationMs = Date.now() - validationStarted;
    if (!response.ok) {
      return json(
        {
          success: false,
          errors: [`Siteverify returned HTTP ${response.status}.`],
          verification_ms: verificationMs,
          ray_id: rayId,
          clearance_cookie: clearanceCookie,
          siteverify: result,
        },
        502,
      );
    }
  } catch {
    return json(
      {
        success: false,
        errors: ["Siteverify was unavailable."],
        verification_ms: Date.now() - validationStarted,
        ray_id: rayId,
        clearance_cookie: clearanceCookie,
      },
      502,
    );
  }
  const expectedAction = `turnstile-${mode}`;
  const expectedHostname = new URL(request.url).hostname.toLowerCase();
  const returnedHostname = result.hostname?.toLowerCase();
  const failures = [
    ...(!result.success
      ? (result["error-codes"] ?? ["Siteverify rejected the response."])
      : []),
    ...(result.action !== expectedAction
      ? ["Turnstile action did not match this mode."]
      : []),
    ...(returnedHostname !== expectedHostname
      ? ["Turnstile hostname did not match this request."]
      : []),
  ];
  if (failures.length) {
    return json(
      {
        success: false,
        errors: failures,
        verification_ms: verificationMs,
        challenge_ts: result.challenge_ts,
        hostname: result.hostname,
        action: result.action,
        ray_id: rayId,
        clearance_cookie: clearanceCookie,
        siteverify: result,
      },
      403,
    );
  }
  return json({
    success: true,
    challenge_ts: result.challenge_ts,
    hostname: result.hostname,
    action: result.action,
    verification_ms: verificationMs,
    ray_id: rayId,
    clearance_cookie: clearanceCookie,
    siteverify: result,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/app.js" ||
        url.pathname === "/signal.js" ||
        url.pathname === "/styles.css" ||
        url.pathname === "/favicon.svg")
    ) {
      return env.ASSETS.fetch(request);
    }
    if (url.pathname === "/")
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    const mode = modeFromPath(url.pathname);
    if (!mode) return new Response("Not found", { status: 404 });
    if (request.method === "GET") return html(page(mode, env, request));
    if (request.method === "HEAD")
      return new Response(null, { headers: HTML_HEADERS });
    if (request.method === "POST") return validate(request, mode, env);
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, POST" },
    });
  },
} satisfies ExportedHandler<TurnstileEnv>;
