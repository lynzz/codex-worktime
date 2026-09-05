import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { entries, projects, tasks } from "./schema.js";

// 导入 EQA 任务清单模板 XLSX(与导出模板同构):
// 列 序号|项目|任务|优先级|备注|评估工时(人时)|人力成本(元)。
// 模板无日期列 → 条目记到指定日期(调用方传入,缺省今天);
// 项目/任务行按名称不存在则建,任务行自动关联;人力成本列为导出公式,忽略。
// 幂等护栏:同 项目+任务+日期+分钟 的条目已存在则跳过(防手滑双导)。
export type TaskListImportResult = {
  projects: { created: number; existing: number };
  tasks: { created: number; existing: number };
  entries: { inserted: number; skipped: number };
};

const EXPECTED_HEADERS = ["项目", "任务", "备注", "评估工时(人时)"] as const;

export async function importTaskListWorkbook(
  data: ArrayBuffer | Uint8Array | Buffer,
  targetDate: string,
): Promise<TaskListImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("任务清单") ?? wb.worksheets[0];
  if (!ws) throw new Error("未找到工作表(任务清单)");

  // 表头列定位(按名称,容忍列顺序变化)
  const header = ws.getRow(1);
  const colOf: Record<string, number> = {};
  header.eachCell((cell, col) => {
    const text = String(cell.value ?? "").trim();
    if (text) colOf[text] = col;
  });
  for (const h of EXPECTED_HEADERS) {
    if (!colOf[h]) throw new Error(`缺少列「${h}」:不是任务清单模板文件`);
  }

  type Row = { projectName: string; title: string; note: string; minutes: number };
  const rows: Row[] = [];
  ws.eachRow((row, number) => {
    if (number === 1) return;
    const projectName = String(row.getCell(colOf["项目"]!).value ?? "").trim();
    const title = String(row.getCell(colOf["任务"]!).value ?? "").trim();
    if (!projectName || !title) return; // 汇总/说明/空行
    const hoursCell = row.getCell(colOf["评估工时(人时)"]!).value;
    const hours =
      typeof hoursCell === "number"
        ? hoursCell
        : typeof hoursCell === "string"
          ? Number(hoursCell.trim())
          : NaN;
    const minutes = Math.round(hours * 60);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const note = String(row.getCell(colOf["备注"]!).value ?? "").trim();
    rows.push({ projectName, title, note, minutes });
  });
  if (rows.length === 0) throw new Error("表格里没有可导入的任务行");

  const db = getDb();
  const result: TaskListImportResult = {
    projects: { created: 0, existing: 0 },
    tasks: { created: 0, existing: 0 },
    entries: { inserted: 0, skipped: 0 },
  };

  const allProjects = await db.select().from(projects);
  for (const row of rows) {
    let project = allProjects.find((p) => p.name === row.projectName);
    if (!project) {
      const inserted = await db
        .insert(projects)
        .values({ id: crypto.randomUUID(), name: row.projectName, archived: false })
        .returning();
      project = inserted[0]!;
      allProjects.push(project);
      result.projects.created++;
    } else {
      result.projects.existing++;
    }

    let task = (
      await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, project.id), eq(tasks.title, row.title)))
    )[0];
    if (!task) {
      const inserted = await db
        .insert(tasks)
        .values({ id: crypto.randomUUID(), projectId: project.id, title: row.title })
        .returning();
      task = inserted[0]!;
      result.tasks.created++;
    } else {
      result.tasks.existing++;
    }

    const duplicate = (
      await db
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.date, targetDate),
            eq(entries.projectId, project.id),
            eq(entries.title, row.title),
            eq(entries.minutes, row.minutes),
          ),
        )
    )[0];
    if (duplicate) {
      result.entries.skipped++;
      continue;
    }

    await db.insert(entries).values({
      id: crypto.randomUUID(),
      date: targetDate,
      projectId: project.id,
      title: row.title,
      minutes: row.minutes,
      taskId: task.id,
      category: null,
      note: row.note || null,
    });
    result.entries.inserted++;
  }
  return result;
}
