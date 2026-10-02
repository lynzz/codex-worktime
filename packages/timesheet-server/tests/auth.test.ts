import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { authMiddleware, loginHandler, logoutHandler, meHandler, type AppEnv } from "../src/auth";
import { addUser, findUserByUsername, resetUserPassword } from "../src/accounts";

const SECRET = "test-session-signing-key";
const PASSWORD = "auth-test-password";
const USERNAME = "auth-test";
const TTL = 30 * 24 * 3600 * 1000;
const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);

function buildApp() {
  const app = new Hono<AppEnv>();
  app.post("/api/auth/login", loginHandler);
  app.use("*", authMiddleware());
  app.get("/api/auth/me", meHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.get("/api/projects", (c) => c.json({ owner: c.get("userId") }));
  return app;
}

async function signedToken(userId: string, expiry: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = `${userId}.${expiry}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

let savedSecret: string | undefined;
let savedLegacyPassword: string | undefined;
beforeEach(() => {
  savedSecret = process.env.SESSION_SECRET;
  savedLegacyPassword = process.env.ACCESS_PASSWORD;
  process.env.SESSION_SECRET = SECRET;
  process.env.ACCESS_PASSWORD = "legacy-password-must-not-enable-auth";
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  if (savedLegacyPassword === undefined) delete process.env.ACCESS_PASSWORD;
  else process.env.ACCESS_PASSWORD = savedLegacyPassword;
});

describe("session security (without a database)", () => {
  it("rejects requests without a cookie and never bypasses with x-internal-key", async () => {
    const app = buildApp();
    expect((await app.request("/api/projects")).status).toBe(401);
    expect((await app.request("/api/projects", { headers: { "x-internal-key": SECRET } })).status).toBe(401);
    expect((await app.request("/api/projects", { headers: { "x-internal-key": process.env.ACCESS_PASSWORD! } })).status).toBe(401);
  });

  it("fails closed without SESSION_SECRET even when ACCESS_PASSWORD is configured", async () => {
    delete process.env.SESSION_SECRET;
    const app = buildApp();
    expect((await app.request("/api/projects")).status).toBe(503);
    expect((await app.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: process.env.ACCESS_PASSWORD }),
    })).status).toBe(503);
  });

  it("rejects signed expired sessions, beyond-TTL sessions, and ambiguous IDs", async () => {
    for (const [id, expiry] of [
      ["auth-test-user", String(Date.now() - 1)],
      ["auth-test-user", String(Date.now() + TTL + 60_000)],
      ["auth.test.user", String(Date.now() + 60_000)],
      ["auth-test-user\n", String(Date.now() + 60_000)],
      ["auth-test-user", `0${Date.now() + 60_000}`],
      ["auth-test-user", `${Date.now() + 60_000}\n`],
    ]) {
      const token = await signedToken(id!, expiry!);
      expect((await buildApp().request("/api/projects", {
        headers: { cookie: `gongshi_auth=${encodeURIComponent(token)}` },
      })).status).toBe(401);
    }
  });

  it("rejects legacy, malformed, and tampered cookies", async () => {
    const expiry = String(Date.now() + 60_000);
    const token = await signedToken("auth-test-user", expiry);
    const changed = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    for (const cookie of [
      `${expiry}.${"a".repeat(64)}`, `${token}.extra`, `.${expiry}.${"a".repeat(64)}`,
      `auth-test-user.1e15.${"a".repeat(64)}`, `${token}\n`, changed,
    ]) {
      expect((await buildApp().request("/api/projects", {
        headers: { cookie: `gongshi_auth=${encodeURIComponent(cookie)}` },
      })).status).toBe(401);
    }
  });

  it("invalid credentials get the generic error without establishing a session", async () => {
    const response = await buildApp().request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "INVALID", password: PASSWORD }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "用户名或口令不正确" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe.skipIf(!hasTestDb)("account login (Neon test branch)", () => {
  let savedUrl: string | undefined;
  let ownerId: string;
  beforeAll(async () => {
    savedUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.NEON_TEST_DATABASE_URL;
    const existing = await findUserByUsername(USERNAME);
    if (existing) {
      ownerId = existing.id;
      await resetUserPassword(USERNAME, PASSWORD);
    } else {
      ownerId = (await addUser(USERNAME, PASSWORD)).id;
    }
  });
  afterAll(() => {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it("login establishes the session owner, /me identity, and authenticated logout", async () => {
    const app = buildApp();
    const login = await app.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD, userId: "another-user" }),
    });
    expect(login.status).toBe(200);
    const header = login.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    const cookie = header.split(";")[0]!;
    const projects = await app.request("/api/projects", { headers: { cookie } });
    expect(projects.status).toBe(200);
    expect(await projects.json()).toEqual({ owner: ownerId });
    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(await me.json()).toEqual({ username: USERNAME });
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await app.request("/api/auth/logout", { method: "POST" })).status).toBe(401);
  });

  it("nonexistent username and wrong password give the identical 401 response", async () => {
    const app = buildApp();
    const responses = [];
    for (const username of [USERNAME, "missing-auth-user"]) {
      const response = await app.request("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "incorrect-password" }),
      });
      expect(response.status).toBe(401);
      responses.push(await response.json());
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(responses).toEqual([{ error: "用户名或口令不正确" }, { error: "用户名或口令不正确" }]);
  });

  it("a valid signature for a nonexistent user is not authenticated", async () => {
    const token = await signedToken("absent-session-user", String(Date.now() + 60_000));
    const response = await buildApp().request("/api/projects", { headers: { cookie: `gongshi_auth=${token}` } });
    expect(response.status).toBe(401);
  });
});
