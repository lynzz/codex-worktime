import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // nitro(node preset)让构建产物自带监听(manual serve 直接 node 启动,PORT 生效)
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
  resolve: {
    alias: {
      "~": path.resolve(dirname, "src"),
    },
  },
});
