import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Manual CLI integration files share the same isolated Neon test branch.
    fileParallelism: false,
  },
});
