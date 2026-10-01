import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { authMiddleware, loginHandler } from "../src/auth";

const SECRET = "test-access-password";

// 口令在中间件构造时读取:每个用例先设 env 再建 app
function buildApp() {
  const app = new Hono();
  app.post("/api/auth/login", loginHandler);
  app.use("*", authMiddleware());
  app.get("/api/projects", (c) => c.json([{ id: "p1" }]));
  return app;
}

describe("authMiddleware(配置了 ACCESS_PASSWORD)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ACCESS_PASSWORD;
    process.env.ACCESS_PASSWORD = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ACCESS_PASSWORD;
    else process.env.ACCESS_PASSWORD = saved;
  });

  it("无会话 cookie → 401", async () => {
    const res = await buildApp().request("/api/projects");
    expect(res.status).toBe(401);
  });

  // 回归:页面 loader 曾用 x-internal-key=口令 直连 Hono,导致未登录也能拿到数据
  it("携带口令的 x-internal-key 头不再放行", async () => {
    const res = await buildApp().request("/api/projects", {
      headers: { "x-internal-key": SECRET },
    });
    expect(res.status).toBe(401);
  });

  it("登录签发的 cookie → 放行;篡改签名 → 401", async () => {
    const app = buildApp();
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: SECRET }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const ok = await app.request("/api/projects", { headers: { cookie } });
    expect(ok.status).toBe(200);

    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
    const bad = await app.request("/api/projects", { headers: { cookie: tampered } });
    expect(bad.status).toBe(401);
  });
});
