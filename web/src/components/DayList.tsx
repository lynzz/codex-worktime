import { useMemo, useState } from "react";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import {
  CATEGORIES,
  addDays,
  dayOfWeekCN,
  formatHours,
  parseDurationInput,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";
import { HeroSelect } from "~/components/HeroSelect";

export function DayList({
  date,
  projects,
  tasks,
  entries,
  onDateChange,
  onChanged,
}: {
  date: string;
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  onDateChange: (date: string) => void;
  onChanged: () => void;
}) {
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(active[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [category, setCategory] = useState<string>("开发");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const dayEntries = useMemo(
    () =>
      entries
        .filter((e) => e.date === date)
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, "zh")),
    [entries, date],
  );
  const dayTotal = dayEntries.reduce((s, e) => s + e.minutes, 0);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add() {
    const minutes = parseDurationInput(duration);
    if (!title.trim()) return setError("请填写任务标题");
    if (minutes === null || Number.isNaN(minutes) || minutes <= 0)
      return setError("请填写时长(支持 1.5 / 1:30 / 90m / 1h30)");
    setBusy(true);
    try {
      await run(async () => {
        await api.createEntry({
          date,
          projectId,
          title,
          minutes,
          category: CATEGORIES.includes(category as never)
            ? (category as (typeof CATEGORIES)[number])
            : undefined,
          note: note.trim() || undefined,
        });
        setTitle("");
        setDuration("");
        setNote("");
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onPress={() => onDateChange(addDays(date, -1))}>
          ← 前一天
        </Button>
        <Input
          type="date"
          aria-label="日期"
          className="w-40"
          value={date}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
        />
        <Button size="sm" variant="ghost" onPress={() => onDateChange(addDays(date, 1))}>
          后一天 →
        </Button>
        {date !== todayKey() && (
          <Button size="sm" variant="tertiary" onPress={() => onDateChange(todayKey())}>
            今天
          </Button>
        )}
        <span className="ml-auto text-sm font-semibold">
          {date} {dayOfWeekCN(date)} · 合计 {formatHours(dayTotal)}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <HeroSelect
          ariaLabel="项目"
          className="w-40"
          items={active.map((p) => ({ id: p.id, name: p.name }))}
          selectedKey={projectId}
          onSelectionChange={setProjectId}
        />
        <Input
          placeholder="任务标题,如:登录页联调"
          className="w-52"
          list="task-options"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <datalist id="task-options">
          {tasks
            .filter((t) => t.projectId === projectId)
            .map((t) => (
              <option key={t.id} value={t.title}>
                {projects.find((p) => p.id === t.projectId)?.name}
              </option>
            ))}
        </datalist>
        <Input
          placeholder="时长:1.5 / 1:30 / 90m"
          className="w-36"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <HeroSelect
          ariaLabel="类别"
          className="w-28"
          items={CATEGORIES.map((c) => ({ id: c, name: c }))}
          selectedKey={category}
          onSelectionChange={setCategory}
        />
        <Input
          placeholder="备注(可选)"
          className="w-40"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button size="sm" variant="primary" isDisabled={busy} onPress={() => void add()}>
          {busy ? <Spinner size="sm" /> : "添加"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table
        aria-label="当日条目"
        className="w-full rounded-xl bg-white text-sm"
      >
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-400">
            <th className="py-1.5 pr-2">项目</th>
            <th className="py-1.5 pr-2">任务标题</th>
            <th className="py-1.5 pr-2">时长</th>
            <th className="py-1.5 pr-2">类别</th>
            <th className="py-1.5 pr-2">备注</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {dayEntries.map((e) => (
            <tr key={e.id} className="border-b border-gray-100">
              <td className="py-1.5 pr-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: projectColor(e.projectId) }}
                  />
                  {projects.find((p) => p.id === e.projectId)?.name ?? "(已删除项目)"}
                </span>
              </td>
              <td className="py-1 pr-2">
                <Input
                  aria-label="任务标题"
                  className="w-full min-w-40"
                  defaultValue={e.title}
                  onBlur={(ev) => {
                    const t = ev.target.value.trim();
                    if (t && t !== e.title) run(() => api.patchEntry(e.id, { title: t }));
                  }}
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  aria-label="时长(小时)"
                  className="w-16 text-center font-semibold"
                  inputMode="decimal"
                  defaultValue={
                    Math.round((e.minutes / 60) * 100) / 100 || ""
                  }
                  title="支持 1.5 / 1:30 / 90m,失焦保存"
                  onBlur={(ev) => {
                    const raw = ev.target.value.trim();
                    if (raw === "" || raw === String(Math.round((e.minutes / 60) * 100) / 100)) {
                      if (raw === "") onChanged(); // 清空视为误触,回显
                      return;
                    }
                    const minutes = parseDurationInput(raw);
                    if (minutes === null || Number.isNaN(minutes) || minutes <= 0) {
                      setError("时长格式:1.5 / 1:30 / 90m");
                      onChanged(); // 回显服务器值
                      return;
                    }
                    setError("");
                    run(() => api.patchEntry(e.id, { minutes }));
                  }}
                />
              </td>
              <td className="py-1.5 pr-2">
                {e.category ? (
                  <Chip size="sm" variant="soft">
                    {e.category}
                  </Chip>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-1.5 pr-2">
                <span className="block max-w-40 truncate text-gray-500">{e.note ?? ""}</span>
              </td>
              <td className="py-1.5 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => run(() => api.deleteEntry(e.id))}
                >
                  删除
                </Button>
              </td>
            </tr>
          ))}
          {dayEntries.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-400">
                这一天还没有记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
