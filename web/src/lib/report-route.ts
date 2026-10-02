import { z } from "zod";
import { isRedirect, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { reportMonthSchema } from "@codex-worktime/report-core";
import { todayKey } from "@codex-worktime/timesheet-core";
import { runtimeApi as honoApi } from "#report-runtime";
import { loadTimesheet, type TimesheetData } from "~/lib/timesheet-route";
import { readReportResponse, type ReportCapabilities, type ReportProfiles, type ReportVersions, type SavedReport } from "~/lib/report-api";

export const reportSearchSchema = z.object({
  month: reportMonthSchema.catch(todayKey().slice(0, 7)),
  profileId: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional().catch(undefined),
  snapshotId: z.string().min(1).max(200).optional().catch(undefined),
});
export type ReportSearch = z.infer<typeof reportSearchSchema>;

export interface ReportPageData extends TimesheetData {
  capabilities: ReportCapabilities | null;
  profiles: ReportProfiles;
  profileId: string | undefined;
  versions: ReportVersions;
  selected: SavedReport | null;
  reportError: string | null;
}

export const loadReports = createServerFn({ method: "GET" })
  .validator((data: ReportSearch) => reportSearchSchema.parse(data))
  .handler(async ({ data }): Promise<ReportPageData> => {
    // Use the browser's normal session for both manual shell data and reports.
    const cookie = getRequestHeaders().get("cookie") ?? "";
    const manual = await loadTimesheet({ data: { date: `${data.month}-01` } });
    const request = async <T,>(path: string): Promise<T> => {
      const response = await honoApi.request(path, { headers: { cookie } });
      if (response.status === 401) throw redirect({ to: "/login" });
      return readReportResponse<T>(response);
    };
    // A report-only failure must not remove owned manual insights or the account controls.
    const result: {
      capabilities: ReportCapabilities | null; profiles: ReportProfiles;
      profileId: string | undefined; versions: ReportVersions;
      selected: SavedReport | null; reportError: string | null;
    } = {
      capabilities: null, profiles: { profiles: [], availableProfiles: [] },
      profileId: data.profileId, versions: { currentId: null, versions: [] },
      selected: null, reportError: null,
    };
    try {
      [result.capabilities, result.profiles] = await Promise.all([
        request<ReportCapabilities>("/api/reports/capabilities"),
        request<ReportProfiles>("/api/report-profiles"),
      ]);
      result.profileId ??= result.profiles.profiles[0]?.profileId;
      if (result.profileId) {
        if (!result.profiles.profiles.some((profile) => profile.profileId === result.profileId)) {
          throw new Error("该 Profile 尚未关联到你的人工项目,请先登记映射");
        }
        const query = new URLSearchParams({ profileId: result.profileId, month: data.month });
        result.versions = await request<ReportVersions>(`/api/reports?${query}`);
        const selectedId = data.snapshotId ?? result.versions.currentId;
        if (selectedId) {
          if (!result.versions.versions.some((version) => version.id === selectedId)) {
            throw new Error("所选版本不存在或不属于此项目月份。请选择可用版本");
          }
          result.selected = await request<SavedReport>(`/api/reports/${encodeURIComponent(selectedId)}`);
        }
      }
    } catch (error) {
      // Redirects are control flow, not a recoverable report error.
      if (isRedirect(error)) throw error;
      result.reportError = error instanceof Error ? error.message : "加载报告失败,请重试";
    }
    return { ...manual, ...result };
  });
