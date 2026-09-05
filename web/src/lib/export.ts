import {
  dayOfWeekCN,
  type Entry,
  type Project,
} from "@codex-worktime/timesheet-core";

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// CSV 列(带 BOM,Excel 直接打开中文不乱码):
// 日期/星期/项目/任务标题/类别/分钟/小时/备注
export function buildTimesheetCsv(
  entries: Entry[],
  projects: Project[],
): string {
  const name = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "(已删除项目)";
  const header = ["日期", "星期", "项目", "任务标题", "类别", "分钟", "小时", "备注"];
  const lines = [
    header.map(csvEscape).join(","),
    ...entries
      .slice()
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "zh"),
      )
      .map((e) =>
        [
          e.date,
          dayOfWeekCN(e.date),
          name(e.projectId),
          e.title,
          e.category ?? "",
          String(e.minutes),
          String(Math.round((e.minutes / 60) * 100) / 100),
          e.note ?? "",
        ]
          .map(csvEscape)
          .join(","),
      ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

export function downloadText(
  filename: string,
  text: string,
  type: string,
): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
