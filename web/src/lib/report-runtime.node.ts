import { createApi, startReportCollection, type ReportCollection } from "@codex-worktime/timesheet-server";
import { createLocalReportCollector } from "@codex-worktime/analyzer/report-collector";

// The build target selects this file; the Worker graph never imports the analyzer.
type ReportRuntime = { api: ReturnType<typeof createApi>; close(): Promise<void> };
// Nitro eagerly loads a startup plugin; SSR loads lazily in a separate bundle.
// Both must share one host incarnation and one collector loop in this process.
const host = globalThis as typeof globalThis & { __codexWorktimeReportRuntime?: Promise<ReportRuntime> };
const initialization = host.__codexWorktimeReportRuntime ??= createReportRuntime();

async function createReportRuntime(): Promise<ReportRuntime> {
  const reportCollector = await createLocalReportCollector();
  let collection: ReportCollection | undefined;
  try {
    if (reportCollector) collection = await startReportCollection(reportCollector);
  } catch {
    await reportCollector?.close().catch(() => {});
    delete host.__codexWorktimeReportRuntime;
    throw new Error("REPORT_COLLECTOR_UNAVAILABLE");
  }
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    try { await collection?.close(); }
    finally {
      await reportCollector?.close();
      if (host.__codexWorktimeReportRuntime === initialization) delete host.__codexWorktimeReportRuntime;
    }
  })();
  function interrupt() { void close().then(() => process.exit(130), () => process.exit(1)); }
  function terminate() { void close().then(() => process.exit(143), () => process.exit(1)); }
  if (reportCollector) {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
  }
  return { api: createApi({ reportCollector }), close };
}

export async function closeReportRuntime(): Promise<void> {
  await (await initialization).close();
}
import.meta.hot?.dispose(closeReportRuntime);
export const runtimeApi = (await initialization).api;
