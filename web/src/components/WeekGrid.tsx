import { useMemo } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  addDays,
  buildWeekRows,
  dayOfWeekCN,
  entriesForRow,
  formatHours,
  parseDurationInput,
  startOfWeek,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";

const cellInputCls =
  "w-16 rounded border border-transparent bg-transparent text-center text-sm outline-none hover:border-gray-200 focus:border-blue-500 focus:bg-white";

function hoursInputValue(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}

function describeEntry(e: Entry): string {
  return `${e.title} ${formatHours(e.minutes)}${e.category ? ` [${e.category}]` : ""}${e.note ? ` ${e.note}` : ""}`;
}

export function WeekGrid({
  date,
  projects,
  tasks,
  entries,
  onDateChange,
  onGotoDay,
  onChanged,
}: {
  date: string;
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  onDateChange: (date: string) => void;
  onGotoDay: (date: string) => void;
  onChanged: () => void;
}) {
  const weekStart = startOfWeek(date);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = days[6]!;
  const weekEntries = useMemo(
    () => entries.filter((e) => e.date >= weekStart && e.date <= weekEnd),
    [entries, weekStart, weekEnd],
  );
  const rows = useMemo(
    () => buildWeekRows(projects, tasks, weekEntries),
    [projects, tasks, weekEntries],
  );
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const today = todayKey();
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "(已删除项目)";

  async function commitCell(
    row: (typeof rows)[number],
    day: string,
    raw: string,
  ) {
    const trimmed = raw.trim();
    const minutes = parseDurationInput(trimmed);
    if (trimmed !== "" && (minutes === null || Number.isNaN(minutes) || minutes <= 0)) {
      onChanged(); // 非法输入:重置回服务器状态
      return;
    }
    try {
      await api.replaceCell({
        date: day,
        projectId: row.projectId,
        taskId: row.taskId,
        title: row.title,
        minutes: trimmed === "" ? null : minutes,
      });
    } finally {
      onChanged();
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onPress={() => onDateChange(addDays(weekStart, -7))}>
          ← 上一周
        </Button>
        <span className="text-sm font-semibold">
          {weekStart} ~ {weekEnd}
        </span>
        <Button size="sm" variant="ghost" onPress={() => onDateChange(addDays(weekStart, 7))}>
          下一周 →
        </Button>
        {weekStart !== startOfWeek(today) && (
          <Button size="sm" variant="tertiary" onPress={() => onDateChange(today)}>
            本周
          </Button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          格子敲小时数(1.5 / 1:30 / 90m),回车或 Tab 跳格,清空即删除
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white">
        <table className="min-w-[840px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-32 border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500">
                项目
              </th>
              <th className="w-44 border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500">
                任务
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`cursor-pointer border border-gray-200 px-1 py-1 text-xs font-semibold text-gray-500 hover:text-blue-600 ${d === today ? "bg-blue-50" : "bg-gray-50"}`}
                  onClick={() => onGotoDay(d)}
                  title={`在日清单中查看 ${d}`}
                >
                  {dayOfWeekCN(d)}
                  <br />
                  {d.slice(5)}
                  {d === today ? " ·今天" : ""}
                </th>
              ))}
              <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500">
                周合计
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowTotal = days.reduce((s, d) => {
                return (
                  s +
                  entriesForRow(row, d, entries, taskIds).reduce(
                    (x, e) => x + e.minutes,
                    0,
                  )
                );
              }, 0);
              return (
                <tr key={`${row.projectId}|${row.taskId ?? row.title ?? ""}`} className={row.adhoc ? "text-gray-400" : ""}>
                  <td className="border border-gray-200 px-2 py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: projectColor(row.projectId) }}
                      />
                      {projectName(row.projectId)}
                    </span>
                  </td>
                  <td className="border border-gray-200 px-2 py-1">
                    {row.adhoc ? (
                      <span>
                        {row.title ?? "(未命名)"}{" "}
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">散录</span>
                      </span>
                    ) : (
                      row.title
                    )}
                  </td>
                  {days.map((d) => {
                    const cellEntries = entriesForRow(row, d, entries, taskIds);
                    const total = cellEntries.reduce((s, e) => s + e.minutes, 0);
                    return (
                      <td
                        key={d}
                        className={`border border-gray-200 p-0.5 text-center ${d === today ? "bg-blue-50/60" : ""}`}
                      >
                        <input
                          className={cellInputCls}
                          inputMode="decimal"
                          placeholder="·"
                          defaultValue={total ? hoursInputValue(total) : ""}
                          key={`${row.taskId ?? row.title}-${d}-${total}`}
                          title={cellEntries.map(describeEntry).join("\n")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") {
                              const el = e.target as HTMLInputElement;
                              el.value = el.defaultValue;
                              el.blur();
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value !== e.target.defaultValue) {
                              void commitCell(row, d, e.target.value);
                            }
                          }}
                        />
                        {cellEntries.length > 1 && (
                          <Tooltip>
                            <Tooltip.Trigger>
                              <button
                                type="button"
                                tabIndex={-1}
                                className="ml-0.5 align-super text-[10px] text-gray-400"
                              >
                                ×{cellEntries.length}
                              </button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <span className="whitespace-pre-wrap text-xs">
                                {cellEntries.map(describeEntry).join("\n")}
                              </span>
                            </Tooltip.Content>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                  <td className="border border-gray-200 px-2 py-1 text-center font-semibold">
                    {rowTotal ? formatHours(rowTotal) : ""}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="border border-gray-200 py-6 text-center text-gray-400">
                  还没有任务行,在「项目 ⚙」里添加;未挂任务行的记录会以散录行出现
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2} className="border border-gray-200 bg-gray-50 px-2 py-1 text-left text-xs font-semibold text-gray-500">
                日合计
              </th>
              {days.map((d) => {
                const t = entries
                  .filter((e) => e.date === d)
                  .reduce((s, e) => s + e.minutes, 0);
                return (
                  <td key={d} className="border border-gray-200 px-1 py-1 text-center text-xs font-semibold">
                    {t ? formatHours(t) : ""}
                  </td>
                );
              })}
              <td className="border border-gray-200 bg-gray-50 px-2 py-1 text-center text-xs font-bold">
                {formatHours(
                  days.reduce(
                    (s, d) =>
                      s + entries.filter((e) => e.date === d).reduce((x, e) => x + e.minutes, 0),
                    0,
                  ),
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
