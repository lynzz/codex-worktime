import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Nitro 预设由部署目标决定:DEPLOY_TARGET=cloudflare → cloudflare_module,
// 否则默认 node(manual serve 直接 node 启动,PORT 生效)
const nitroPreset =
  process.env.DEPLOY_TARGET === "cloudflare" ? "cloudflare_module" : undefined;

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro(nitroPreset ? { preset: nitroPreset } : undefined),
    viteReact(),
  ],
  resolve: {
    alias: {
      "~": path.resolve(dirname, "src"),
    },
  },
});
