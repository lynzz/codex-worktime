import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // 集成测试走跨境链路,偶发网络突发时整测重试
    retry: 2,
  },
});
