import { describe, expect, it } from "vitest";
import { api } from "../src/server/api";

describe("GET /api/health", () => {
  it("返回 ok 与数据库心跳(未配置 DATABASE_URL 时为 not-configured)", async () => {
    const res = await api.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(["up", "not-configured"]).toContain(body.db);
  });
});
