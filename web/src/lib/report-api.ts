import type { ReportDetail, ReportSummary, ReportRun } from "@codex-worktime/timesheet-server";
export type { ReportSummary, ReportRun } from "@codex-worktime/timesheet-server";
export type SavedReport = ReportDetail;

export type ReportCapabilities = { localGenerate: boolean; import: true; query: true; export: true };
export type ReportProfiles = {
  profiles: { profileId: string; projectId: string; displayName: string }[];
  availableProfiles: { profileId: string; displayName: string }[];
};
export type ReportVersions = { currentId: string | null; versions: ReportSummary[] };

const reportErrors: Record<string, string> = {
  REPORT_STORAGE_FAILED: "数据库暂时不可用,已有报告不会丢失。请重试。",
  REPORT_TOO_LARGE: "报告 JSON 不能超过 2 MiB",
  INVALID_REPORT_JSON: "文件不是有效的报告 JSON",
  INVALID_REPORT_SNAPSHOT: "报告契约无效：请使用受支持版本的完整月份脱敏 JSON,日期不可缺失或重复。",
  REPORT_DIGEST_MISMATCH: "报告内容摘要不匹配,请重新从本机导出,不要修改统计字段。",
  INVALID_REPORT_MAPPING: "项目关联无效,请检查 Profile ID 和展示名称；不能包含私有路径或敏感信息。",
  PROJECT_NOT_FOUND: "人工项目不存在或不属于当前账号",
  PROJECT_ALREADY_MAPPED: "该人工项目已关联另一个 Profile。一个人工项目只能关联一个 Profile。",
  REPORT_PROFILE_NOT_FOUND: "该 Profile 尚未关联当前账号的项目,或本机没有授权使用此 Profile。",
  INVALID_REPORT_SELECTION: "请选择合法月份与已关联 Profile",
  LOCAL_GENERATION_UNSUPPORTED: "当前环境不支持本机生成,请导入本机导出的报告 JSON。",
  REPORT_RUN_NOT_FOUND: "生成运行不存在或不属于当前账号",
  REPORT_NOT_FOUND: "报告版本不存在或不属于当前账号",
  INVALID_REPORT_EXPORT_FORMAT: "不支持该下载格式,请选择 JSON 或 HTML",
};

export async function readReportResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    if (typeof window !== "undefined") window.location.replace("/login");
    throw new Error("登录已失效,请重新登录");
  }
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ? reportErrors[body.error] ?? body.error : `报告请求失败 (${response.status})`);
  if (body === null) throw new Error("报告响应无效,请重试");
  return body;
}

async function request<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  return readReportResponse<T>(await fetch(path, {
    ...init, signal, headers: { "content-type": "application/json" },
  }));
}

export const reportApi = {
  saveMapping: (profileId: string, input: { projectId: string; displayName: string }, signal?: AbortSignal) =>
    request(`/api/report-profiles/${encodeURIComponent(profileId)}`, signal, { method: "PUT", body: JSON.stringify(input) }),
  import: (snapshot: unknown, signal?: AbortSignal) =>
    request<SavedReport>("/api/reports/import", signal, { method: "POST", body: JSON.stringify(snapshot) }),
  generate: (profileId: string, month: string, signal?: AbortSignal) =>
    request<{ runId: string }>("/api/reports/generate", signal, { method: "POST", body: JSON.stringify({ profileId, month }) }),
  run: (id: string, signal?: AbortSignal) => request<ReportRun>(`/api/report-runs/${encodeURIComponent(id)}`, signal),
  download: async (report: ReportSummary, format: "json" | "html", signal?: AbortSignal) => {
    const response = await fetch(`/api/reports/${encodeURIComponent(report.id)}/export?format=${format}`, { signal });
    if (!response.ok) { await readReportResponse(response); return; }
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mime !== (format === "json" ? "application/json" : "text/html")) {
      throw new Error("下载内容类型无效,未保存文件。请重试");
    }
    const blob = await response.blob();
    if (signal?.aborted) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `report-${report.profileId}-${report.month}-${report.id}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
