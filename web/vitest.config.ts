import { defineConfig } from "vitest/config";

// Unit tests do not start TanStack/Nitro's application SSR module runner.
export default defineConfig({
  test: { environment: "node" },
});
