import ExcelJS from "exceljs";
import type { Entry, Project } from "@codex-worktime/timesheet-core";

// EQA 平台任务清单模板(/Users/lzz/lianlai/money-docs/EQA平台任务清单_模板.xlsx)复刻:
// 表头 序号|项目|任务|日期|备注|评估工时(人时)|人力成本(元);D9E1F2 表头底纹、
// 微软雅黑、细边框;底部 合计(总工时 + 总金额) + 说明(1200 元/人天 = 150 元/人时)。
const HEADERS = [
  "序号",
  "项目",
  "任务",
  "日期",
  "备注",
  "评估工时(人时)",
  "人力成本(元)",
] as const;
const FONT = "Microsoft YaHei";
const HEADER_FILL = "FFD9E1F2";
const RATE_PER_HOUR = 150; // 模板说明:成本按 1200 元/人天(8 小时)

const thin = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

export type TaskListRow = {
  date: string; // fillDates=false 时为空串
  projectName: string;
  title: string;
  note: string;
  minutes: number;
};

// 聚合口径:
// - fillDates=true:按 日期+项目+任务标题 合并,日期列填当天;
// - fillDates=false:按 项目+任务标题 合并,日期列留空(多日无法填单一日期)。
// 两种口径都按(最早)日期升序,同日按项目/标题排序。
export function aggregateTaskRows(
  projects: Project[],
  entries: Entry[],
  { fillDates }: { fillDates: boolean },
): TaskListRow[] {
  const name = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "(已删除项目)";
  const map = new Map<string, TaskListRow & { firstDate: string; notes: string[] }>();
  for (const e of entries) {
    const key = fillDates ? `${e.date}|${e.projectId}|${e.title}` : `${e.projectId}|${e.title}`;
    const row = map.get(key) ?? {
      date: fillDates ? e.date : "",
      firstDate: e.date,
      projectName: name(e.projectId),
      title: e.title,
      note: "",
      minutes: 0,
      notes: [],
    };
    if (e.date < row.firstDate) row.firstDate = e.date;
    row.minutes += e.minutes;
    if (e.note && !row.notes.includes(e.note)) row.notes.push(e.note);
    map.set(key, row);
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        a.firstDate.localeCompare(b.firstDate) ||
        a.projectName.localeCompare(b.projectName, "zh") ||
        a.title.localeCompare(b.title, "zh"),
    )
    .map(({ notes, firstDate: _firstDate, ...row }) => ({ ...row, note: notes.join(" / ") }));
}

export async function buildTaskListWorkbook(
  rows: TaskListRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "codex-worktime";
  const ws = wb.addWorksheet("任务清单");
  ws.columns = [
    { width: 8 },
    { width: 14 },
    { width: 48 }, // 任务
    { width: 12 },
    { width: 58 },
    { width: 16 },
    { width: 16 },
  ];

  // 表头
  const headerRow = ws.addRow([...HEADERS]);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF111827" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // 数据行
  rows.forEach((row, i) => {
    const r = i + 2;
    const dataRow = ws.addRow([
      i + 1,
      row.projectName,
      row.title,
      row.date,
      row.note,
      Math.round((row.minutes / 60) * 100) / 100,
      { formula: `F${r}*${RATE_PER_HOUR}` },
    ]);
    dataRow.height = 24;
    dataRow.eachCell((cell, col) => {
      cell.font = { name: FONT, size: 11, color: { argb: "FF1F2937" } };
      cell.border = BORDER;
      // 任务(C)/备注(E) 为长文本,左对齐;其余列居中
      const horizontal = col === 3 || col === 5 ? "left" : "center";
      cell.alignment = { horizontal, vertical: "middle", wrapText: true };
    });
  });

  const first = 2;
  const last = Math.max(rows.length + 1, 2); // 空表也给出合法区间

  ws.addRow([]); // 空一行
  const totalRow = ws.addRow([
    undefined,
    undefined,
    undefined,
    undefined,
    "合计",
    { formula: `SUM(F${first}:F${last})` },
    { formula: `SUM(G${first}:G${last})` },
  ]);
  totalRow.height = 23;
  for (const idx of [5, 6, 7]) {
    const cell = totalRow.getCell(idx);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // 说明行(与模板一致,合并 B..G)
  ws.addRow([]); // 空一行
  const noteRow = ws.addRow([undefined, `说明：成本按1200元/人天。红≥4h，黄=3h，蓝=2h，绿≤1.5h。日期列留空时,导入记到所选默认日期。`]);
  noteRow.height = 24;
  ws.mergeCells(`B${noteRow.number}:G${noteRow.number}`);
  const noteCell = noteRow.getCell(2);
  noteCell.font = { name: FONT, size: 11, color: { argb: "FF1F2937" } };
  noteCell.alignment = { vertical: "middle" };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
