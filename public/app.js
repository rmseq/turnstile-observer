import { createSignal } from "/signal.js";

const config = {
  mode: document.body.dataset.mode,
  action: document.body.dataset.action,
  sitekey: document.body.dataset.sitekey,
  configured: document.body.dataset.configured === "true",
};

const run = document.querySelector("#run");
const signal = document.querySelector("#signal");
const traceWidget = document.querySelector("#trace-widget");
const traceToken = document.querySelector("#trace-token");
const traceVerify = document.querySelector("#trace-verify");
const traceWidgetMeta = document.querySelector("#trace-widget-meta");
const traceTokenMeta = document.querySelector("#trace-token-meta");
const traceVerifyMeta = document.querySelector("#trace-verify-meta");
const clearanceCookie = document.querySelector("#clearance-cookie");
const tokenEvidenceStatus = document.querySelector("#token-evidence-status");
const copyToken = document.querySelector("#copy-token");
const siteverifyEvidenceStatus = document.querySelector(
  "#siteverify-evidence-status",
);
const siteverifyResponse = document.querySelector("#siteverify-response");
const copySiteverify = document.querySelector("#copy-siteverify");
const browserEnvironment = document.querySelector("#browser-environment");
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const INTERACTION_NOTICE_DELAY_MS = 350;
const MIN_CHECKING_MS = 420;
const MIN_CHALLENGE_SIGNAL_MS = 420;
let widgetId;
let token = "";
let siteverifyPayload = "";
let challengeStartedAt;
let challengeStartedWallTime;
let verificationInFlight = false;
let interactionNoticeTimer;
let challengeSignalTimer;
const turnstileLoadStartedAt = performance.now();
const setSignal = createSignal(signal);
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

const setRun = (enabled, label, visible = enabled) => {
  if (!run) return;
  run.disabled = !enabled;
  run.dataset.visible = String(visible);
  if (label) run.textContent = label;
};

const state = (name) => setSignal(name);

const formatDuration = (milliseconds) =>
  milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${Math.round(milliseconds)} ms`;

const setTraceMeta = (element, timestamp = Date.now(), duration) => {
  if (!element) return;
  element.textContent = [
    clockFormatter.format(new Date(timestamp)),
    typeof duration === "number" ? formatDuration(duration) : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

const clearTraceMeta = (element) => {
  if (element) element.textContent = "";
};

const setTrace = (element, text, timelineState) => {
  element.textContent = text;
  const item = element.closest(".trace-item");
  if (timelineState && item) item.dataset.state = timelineState;
};

const setTokenEvidence = (nextToken = "") => {
  if (!tokenEvidenceStatus || !copyToken) return;
  const hasToken = Boolean(nextToken);
  tokenEvidenceStatus.textContent = hasToken
    ? `Ready · ${nextToken.length} characters`
    : "Awaiting response";
  copyToken.disabled = !hasToken;
};

const setClearanceCookie = (present) => {
  if (!clearanceCookie || typeof present !== "boolean") return;
  clearanceCookie.textContent = present ? "Present" : "Not present";
};

const setSiteverifyEvidence = (result, status = "Not requested") => {
  if (!siteverifyEvidenceStatus || !siteverifyResponse || !copySiteverify)
    return;
  siteverifyPayload = result ? JSON.stringify(result, null, 2) : "";
  siteverifyEvidenceStatus.textContent = status;
  copySiteverify.disabled = !siteverifyPayload;
  siteverifyResponse.textContent = siteverifyPayload;
  siteverifyResponse.hidden = !siteverifyPayload;
};

const clearInteractionNotice = () => {
  clearTimeout(interactionNoticeTimer);
  interactionNoticeTimer = undefined;
};

const clearChallengeSignalTimer = () => {
  clearTimeout(challengeSignalTimer);
  challengeSignalTimer = undefined;
};

const workerClockDelta = () => {
  const workerTime = Number(document.body.dataset.workerTime);
  if (!Number.isFinite(workerTime)) return "Not supplied";
  const difference = Date.now() - workerTime;
  if (Math.abs(difference) < 1_000) return "Within 1 s";
  return `${difference < 0 ? "−" : "+"}${formatDuration(Math.abs(difference))}`;
};

const beginChallenge = (label = "Waiting for response") => {
  clearChallengeSignalTimer();
  challengeStartedAt = performance.now();
  challengeStartedWallTime = Date.now();
  state("checking");
  setTrace(traceToken, label, "active");
  setTrace(traceVerify, "Not requested", "pending");
  setTraceMeta(traceTokenMeta, challengeStartedWallTime);
  clearTraceMeta(traceVerifyMeta);
  setSiteverifyEvidence();
};

const settleChallengeSignal = () => {
  const elapsed =
    typeof challengeStartedAt === "number"
      ? performance.now() - challengeStartedAt
      : MIN_CHALLENGE_SIGNAL_MS;
  const remaining = MIN_CHALLENGE_SIGNAL_MS - elapsed;
  clearChallengeSignalTimer();
  if (remaining <= 0) {
    state("waiting");
    return;
  }
  challengeSignalTimer = setTimeout(() => {
    if (token && !verificationInFlight) state("waiting");
  }, remaining);
};

const finishFailure = (kind, message, body = {}) => {
  clearChallengeSignalTimer();
  state(kind);
  setTrace(traceVerify, message, kind);
  if (body.siteverify)
    setSiteverifyEvidence(body.siteverify, "Returned · rejected");
  setRun(Boolean(token), "Re-validate");
};

const renderBrowserData = () => {
  const browserData = document.querySelector("#browser-data");
  if (!browserData || browserData.dataset.rendered === "true") return;

  const groups = [
    [
      ["Secure context", window.isSecureContext ? "Yes" : "No"],
      ["Automation", navigator.webdriver ? "Detected" : "Not detected"],
      ["Clock delta to Worker", workerClockDelta()],
    ],
    [
      ["Viewport", `${window.innerWidth} × ${window.innerHeight}`],
      ["Screen", `${screen.width} × ${screen.height}`],
      ["Pixel ratio", String(window.devicePixelRatio || 1)],
      [
        "Color scheme",
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "Dark"
          : "Light",
      ],
      [
        "Language",
        navigator.languages?.join(", ") || navigator.language || "Not supplied",
      ],
      [
        "Timezone",
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Not supplied",
      ],
      ["Touch points", String(navigator.maxTouchPoints ?? 0)],
    ],
  ];
  browserData.replaceChildren(
    ...groups.map((details) => {
      const group = document.createElement("div");
      group.className = "group";
      details.forEach(([key, value]) => {
        const datum = document.createElement("div");
        const label = document.createElement("dt");
        const content = document.createElement("dd");
        datum.className = "datum";
        label.textContent = key;
        content.textContent = value;
        datum.append(label, content);
        group.append(datum);
      });
      return group;
    }),
  );
  browserData.dataset.rendered = "true";
};

const verify = async () => {
  if (!token || verificationInFlight) return;

  verificationInFlight = true;
  setRun(false, "Verifying response");
  state("checking");
  setTrace(traceVerify, "In progress", "active");
  setTraceMeta(traceVerifyMeta);
  const requestStartedAt = performance.now();
  const holdChecking = () => {
    const remaining = MIN_CHECKING_MS - (performance.now() - requestStartedAt);
    return remaining > 0
      ? new Promise((resolve) => setTimeout(resolve, remaining))
      : Promise.resolve();
  };
  try {
    const response = await fetch(location.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    await holdChecking();
    const completedAt = Date.now();
    const verificationDuration =
      typeof body.verification_ms === "number"
        ? body.verification_ms
        : performance.now() - requestStartedAt;
    setTraceMeta(traceVerifyMeta, completedAt, verificationDuration);
    setClearanceCookie(body.clearance_cookie);
    if (body.siteverify) {
      setSiteverifyEvidence(
        body.siteverify,
        `Returned · ${body.siteverify.success ? "accepted" : "rejected"}`,
      );
    }
    if (!response.ok || !body.success) {
      const message = (body.errors || ["Validation failed"]).join(", ");
      finishFailure(
        response.status === 403 ? "failed" : "error",
        message,
        body,
      );
      return;
    }
    clearChallengeSignalTimer();
    state("verified");
    setRun(true, "Re-validate");
    setTrace(traceVerify, "Completed", "complete");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Validation failed";
    await holdChecking();
    setTraceMeta(
      traceVerifyMeta,
      Date.now(),
      performance.now() - requestStartedAt,
    );
    finishFailure("error", `Unavailable · ${message}`);
  } finally {
    verificationInFlight = false;
  }
};

const mount = () => {
  if (!config.configured || !window.turnstile) {
    if (!config.configured) {
      setRun(false);
      setTrace(traceWidget, "Sitekey unavailable", "pending");
      setTrace(traceToken, "Unavailable", "pending");
      setTrace(traceVerify, "Unavailable", "pending");
    }
    return;
  }
  if (config.mode === "invisible")
    setTrace(traceToken, "Waiting to run", "pending");
  try {
    widgetId = window.turnstile.render("#widget", {
      sitekey: config.sitekey,
      action: config.action,
      size: config.mode === "invisible" ? "invisible" : "flexible",
      execution: config.mode === "invisible" ? "execute" : "render",
      appearance: config.mode === "invisible" ? "execute" : "always",
      callback: (nextToken) => {
        clearInteractionNotice();
        token = nextToken;
        setTokenEvidence(token);
        setSiteverifyEvidence();
        setTraceMeta(
          traceTokenMeta,
          Date.now(),
          typeof challengeStartedAt === "number"
            ? performance.now() - challengeStartedAt
            : undefined,
        );
        setTrace(traceToken, "Completed", "complete");
        setTrace(traceVerify, "Response ready", "active");
        setRun(true, "Validate");
        settleChallengeSignal();
      },
      "before-interactive-callback": () => {
        clearInteractionNotice();
        interactionNoticeTimer = setTimeout(() => {
          if (!token && !verificationInFlight) {
            setTrace(traceToken, "Interaction required", "active");
            setTraceMeta(traceTokenMeta);
          }
        }, INTERACTION_NOTICE_DELAY_MS);
      },
      "after-interactive-callback": () => {
        clearInteractionNotice();
        if (!token && !verificationInFlight) {
          setTrace(
            traceToken,
            "Interaction complete · waiting response",
            "active",
          );
          setTraceMeta(traceTokenMeta);
        }
      },
      "error-callback": (code) => {
        clearInteractionNotice();
        token = "";
        setTokenEvidence();
        state("error");
        setTrace(traceToken, `Widget error · ${code}`, "error");
        setTraceMeta(traceTokenMeta);
        setTrace(traceVerify, "Not sent", "pending");
        setRun(false, "Validate");
      },
      "expired-callback": () => {
        clearInteractionNotice();
        clearChallengeSignalTimer();
        token = "";
        setTokenEvidence();
        state("failed");
        setTrace(traceToken, "Expired", "failed");
        setTraceMeta(
          traceTokenMeta,
          Date.now(),
          typeof challengeStartedAt === "number"
            ? performance.now() - challengeStartedAt
            : undefined,
        );
        setTrace(traceVerify, "Not sent", "pending");
        setRun(false, "Validate");
      },
      "timeout-callback": () => {
        clearInteractionNotice();
        clearChallengeSignalTimer();
        token = "";
        setTokenEvidence();
        state("failed");
        setTrace(traceToken, "Timed out", "failed");
        setTraceMeta(
          traceTokenMeta,
          Date.now(),
          typeof challengeStartedAt === "number"
            ? performance.now() - challengeStartedAt
            : undefined,
        );
        setTrace(traceVerify, "Not sent", "pending");
        setRun(false, "Validate");
      },
      "unsupported-callback": () => {
        clearInteractionNotice();
        token = "";
        setTokenEvidence();
        state("error");
        setTrace(traceToken, "Unsupported", "error");
        setTraceMeta(traceTokenMeta);
        setTrace(traceVerify, "Not sent", "pending");
        setRun(false, "Validate");
      },
    });
    setTrace(traceWidget, "Rendered", "complete");
    setTraceMeta(
      traceWidgetMeta,
      Date.now(),
      performance.now() - turnstileLoadStartedAt,
    );
    beginChallenge(
      config.mode === "invisible" ? "Running" : "Waiting for response",
    );
    if (config.mode === "invisible") window.turnstile.execute(widgetId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Turnstile could not render.";
    state("error");
    setTrace(traceWidget, `Render failed · ${message}`, "error");
    setTrace(traceToken, "Unavailable", "pending");
    setTrace(traceVerify, "Not requested", "pending");
  }
};

const waitForTurnstile = () => {
  if (!config.configured) {
    mount();
    return;
  }
  if (window.turnstile) mount();
  else if (
    performance.now() - turnstileLoadStartedAt >=
    TURNSTILE_LOAD_TIMEOUT_MS
  ) {
    setRun(false);
    state("error");
    setTrace(traceWidget, "Script unavailable", "error");
    setTrace(traceToken, "Unavailable", "pending");
    setTrace(traceVerify, "Not requested", "pending");
  } else setTimeout(waitForTurnstile, 30);
};

setSignal("waiting");
setRun(false, "Validate");
waitForTurnstile();
browserEnvironment?.addEventListener("toggle", () => {
  if (browserEnvironment.open) renderBrowserData();
});
run?.addEventListener("click", () => {
  void verify();
});
copyToken?.addEventListener("click", async () => {
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    copyToken.textContent = "Copied";
    setTimeout(() => {
      copyToken.textContent = "Copy token";
    }, 1_500);
  } catch {
    copyToken.textContent = "Copy unavailable";
  }
});
copySiteverify?.addEventListener("click", async () => {
  if (!siteverifyPayload) return;
  try {
    await navigator.clipboard.writeText(siteverifyPayload);
    copySiteverify.textContent = "Copied";
    setTimeout(() => {
      copySiteverify.textContent = "Copy response";
    }, 1_500);
  } catch {
    copySiteverify.textContent = "Copy unavailable";
  }
});
