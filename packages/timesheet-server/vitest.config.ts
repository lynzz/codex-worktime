import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // 共享同一个 Neon 测试库:文件间必须串行,避免互相清场
    fileParallelism: false,
    // 集成测试走跨境链路,偶发网络突发时整测重试
    retry: 2,
  },
});
