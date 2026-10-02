import { definePlugin } from "nitro";
import { closeReportRuntime } from "./report-runtime.node";

// Static import starts the collector before listening, not on first local HTTP request.
export default definePlugin((app) => {
  app.hooks.hook("close", closeReportRuntime);
});
