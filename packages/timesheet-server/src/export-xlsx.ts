import ExcelJS from "exceljs";
import type { Entry, Project } from "@codex-worktime/timesheet-core";

// EQA 平台任务清单模板(/Users/lzz/lianlai/money-docs/EQA平台任务清单_模板.xlsx)复刻:
// 表头 序号|项目|任务|优先级|备注|评估工时(人时)|人力成本(元);D9E1F2 表头底纹、
// 微软雅黑、细边框;底部 P0/P1 统计 + 合计 + 说明(1200 元/人天 = 150 元/人时)。
const HEADERS = [
  "序号",
  "项目",
  "任务",
  "优先级",
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
  projectName: string;
  title: string;
  note: string;
  minutes: number;
};

// 聚合口径:按 项目+任务标题 合并条目(任务清单以任务为单位,非逐日流水)
export function aggregateTaskRows(
  projects: Project[],
  entries: Entry[],
): TaskListRow[] {
  const name = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "(已删除项目)";
  const map = new Map<string, TaskListRow & { notes: string[] }>();
  for (const e of entries) {
    const key = `${e.projectId}|${e.title}`;
    const row = map.get(key) ?? {
      projectName: name(e.projectId),
      title: e.title,
      note: "",
      minutes: 0,
      notes: [],
    };
    row.minutes += e.minutes;
    if (e.note && !row.notes.includes(e.note)) row.notes.push(e.note);
    map.set(key, row);
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        a.projectName.localeCompare(b.projectName, "zh") ||
        a.title.localeCompare(b.title, "zh"),
    )
    .map(({ notes, ...row }) => ({
      ...row,
      note: notes.join(" / ") || (row as { note?: string }).note || "",
    }));
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
    { width: 24 },
    { width: 10 },
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

  // 数据行(优先级默认 P1,统计公式按 P0/P1 汇总,导出后可改)
  rows.forEach((row, i) => {
    const r = i + 2;
    const dataRow = ws.addRow([
      i + 1,
      row.projectName,
      row.title,
      "P1",
      row.note,
      Math.round((row.minutes / 60) * 100) / 100,
      { formula: `F${r}*${RATE_PER_HOUR}` },
    ]);
    dataRow.height = 24;
    dataRow.eachCell((cell) => {
      cell.font = { name: FONT, size: 11, color: { argb: "FF1F2937" } };
      cell.border = BORDER;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
  });

  const first = 2;
  const last = Math.max(rows.length + 1, 2); // 至少覆盖 F2 起的区间

  ws.addRow([]); // 空一行
  const sumRow = (label: string, criteria: string) => {
    const row = ws.addRow([undefined, undefined, undefined, label, undefined, undefined, undefined]);
    row.height = 23;
    row.getCell(5).value = { formula: `COUNTIF(D${first}:D${last},"${criteria}")&"个任务"` };
    row.getCell(6).value = { formula: `SUMIF(D${first}:D${last},"${criteria}",F${first}:F${last})` };
    row.getCell(7).value = { formula: `SUMIF(D${first}:D${last},"${criteria}",G${first}:G${last})` };
    for (const idx of [4, 5, 6, 7]) {
      const cell = row.getCell(idx);
      cell.font = { name: FONT, size: 11, color: { argb: "FF1F2937" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
    return row;
  };
  const p0Row = sumRow("P0 设计", "P0");
  const p1Row = sumRow("P1 高优", "P1");

  const totalRow = ws.addRow([undefined, undefined, undefined, "合计", undefined, undefined, undefined]);
  totalRow.height = 23;
  totalRow.getCell(5).value = { formula: `SUM(E${p0Row.number}:E${p1Row.number})` };
  totalRow.getCell(6).value = { formula: `SUM(F${p0Row.number}:F${p1Row.number})` };
  totalRow.getCell(7).value = { formula: `SUM(G${p0Row.number}:G${p1Row.number})` };
  for (const idx of [4, 5, 6, 7]) {
    const cell = totalRow.getCell(idx);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // 说明行(与模板一致,合并 B..G)
  ws.addRow([]); // 空一行
  const noteRow = ws.addRow([undefined, `说明：成本按1200元/人天。红≥4h，黄=3h，蓝=2h，绿≤1.5h。`, undefined, undefined, undefined, undefined, undefined]);
  noteRow.height = 24;
  ws.mergeCells(`B${noteRow.number}:G${noteRow.number}`);
  const noteCell = noteRow.getCell(2);
  noteCell.font = { name: FONT, size: 11, color: { argb: "FF1F2937" } };
  noteCell.alignment = { vertical: "middle" };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
