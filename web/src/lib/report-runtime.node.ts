import { createApi } from "@codex-worktime/timesheet-server";
import { createLocalReportCollector } from "@codex-worktime/analyzer/report-collector";

// The build target selects this file; the Worker graph never imports the analyzer.
const reportCollector = await createLocalReportCollector();
export const runtimeApi = createApi({ reportCollector });
