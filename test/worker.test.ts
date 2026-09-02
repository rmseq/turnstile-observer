import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type WorkerEnvironment = Parameters<typeof worker.fetch>[1];
type WorkerRequest = Parameters<typeof worker.fetch>[0];

const defaultAssets: WorkerEnvironment["ASSETS"] = {
  fetch: async () => new Response("asset not configured", { status: 404 }),
  connect: () => {
    throw new Error("asset connect is not configured for this test");
  },
};

function testEnvironment(
  overrides: Partial<WorkerEnvironment> = {},
): WorkerEnvironment {
  return {
    ASSETS: defaultAssets,
    ...overrides,
  };
}

async function fetchWorker(request: Request, env = testEnvironment()) {
  // The Workers runtime distinguishes incoming requests from constructed ones.
  return worker.fetch(request as WorkerRequest, env);
}

afterEach(() => vi.unstubAllGlobals());

describe("Turnstile Observer Worker", () => {
  it("serves a mode page with its browser protections", async () => {
    const response = await fetchWorker(
      new Request("https://observer.test/managed"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    await expect(response.text()).resolves.toContain("Managed");
  });

  it("routes GET and HEAD asset requests through the ASSETS binding", async () => {
    const assetFetch = vi.fn(
      async () =>
        new Response("<svg />", {
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    const env = testEnvironment({
      ASSETS: { ...defaultAssets, fetch: assetFetch },
    });

    for (const method of ["GET", "HEAD"]) {
      const response = await fetchWorker(
        new Request("https://observer.test/favicon.svg", { method }),
        env,
      );
      expect(response.status).toBe(200);
    }

    expect(assetFetch).toHaveBeenCalledTimes(2);
  });

  it("serves a mode page to HEAD requests without a response body", async () => {
    const response = await fetchWorker(
      new Request("https://observer.test/managed", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toBe("");
  });

  it("rejects a validation request without a Turnstile response", async () => {
    const response = await fetchWorker(
      new Request("https://observer.test/managed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      testEnvironment({ TURNSTILE_MANAGED_SECRET: "test-secret" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("rejects oversized validation request bodies before calling Siteverify", async () => {
    const siteverify = vi.fn();
    vi.stubGlobal("fetch", siteverify);

    const response = await fetchWorker(
      new Request("https://observer.test/managed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "x".repeat(4_096) }),
      }),
      testEnvironment({ TURNSTILE_MANAGED_SECRET: "test-secret" }),
    );

    expect(response.status).toBe(413);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies even when Content-Length is incorrect", async () => {
    const siteverify = vi.fn();
    vi.stubGlobal("fetch", siteverify);

    const response = await fetchWorker(
      new Request("https://observer.test/managed", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "1",
        },
        body: JSON.stringify({ token: "x".repeat(4_096) }),
      }),
      testEnvironment({ TURNSTILE_MANAGED_SECRET: "test-secret" }),
    );

    expect(response.status).toBe(413);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("accepts a matching Siteverify response", async () => {
    const siteverify = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            action: "turnstile-managed",
            hostname: "observer.test",
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", siteverify);

    const response = await fetchWorker(
      new Request("https://observer.test/managed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "test-token" }),
      }),
      testEnvironment({ TURNSTILE_MANAGED_SECRET: "test-secret" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(siteverify).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    [
      "action",
      { action: "turnstile-invisible", hostname: "observer.test" },
      "Turnstile action did not match this mode.",
    ],
    [
      "hostname",
      { action: "turnstile-managed", hostname: "other.test" },
      "Turnstile hostname did not match this request.",
    ],
  ])(
    "rejects a Siteverify response with the wrong %s",
    async (_field, result, expectedError) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                success: true,
                ...result,
              }),
              {
                headers: { "content-type": "application/json" },
              },
            ),
        ),
      );

      const response = await fetchWorker(
        new Request("https://observer.test/managed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "test-token" }),
        }),
        testEnvironment({ TURNSTILE_MANAGED_SECRET: "test-secret" }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        errors: expect.arrayContaining([expectedError]),
      });
    },
  );
});
