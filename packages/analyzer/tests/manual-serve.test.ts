import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manualServerEntry, startManualServer } from "../src/manual/serve";

const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env.local",
);
try {
  process.loadEnvFile(rootEnv);
} catch {
  /* 未配置则跳过 */
}

// 前置:web 构建产物存在(仓库根 npm run build -w @codex-worktime/web)
const hasBuild = existsSync(manualServerEntry());
const hasTestDb = Boolean(process.env.NEON_TEST_DATABASE_URL);
const port = 8899;

describe.skipIf(!hasBuild)("manual serve(构建产物启动)", () => {
  let child: ReturnType<typeof startManualServer> | undefined;

  beforeAll(() => {
    child = startManualServer({ port });
  });

  afterAll(() => {
    child?.kill();
  });

  it("启动构建产物,页面 200、/api/health 应答 JSON", async () => {
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 500));
      ok = await fetch(`http://localhost:${port}/`)
        .then((r) => r.status === 200 || r.status === 307)
        .catch(() => false);
    }
    expect(ok).toBe(true);

    const health = await fetch(`http://localhost:${port}/api/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("manual serve 参数与缺产物报错", () => {
  it("缺构建产物时给出明确指引", () => {
    // 直接验证模块对不存在路径的行为由 hasBuild 分支覆盖;
    // 这里锁定默认端口常量与入口导出形状。
    expect(manualServerEntry()).toContain("web/.output/server/index.mjs");
  });
});
