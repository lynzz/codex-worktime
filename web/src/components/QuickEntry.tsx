import { useState } from "react";
import { Button, Input } from "@heroui/react";
import {
  parseDurationInput,
  todayKey,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { HeroSelect } from "~/components/HeroSelect";

// 快速记录一行:项目 + 任务标题 + 时长,记到当前所选日期
export function QuickEntry({
  date,
  projects,
  tasks,
  onChanged,
}: {
  date: string;
  projects: Project[];
  tasks: Task[];
  onChanged: () => void;
}) {
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(active[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const minutes = parseDurationInput(duration);
    if (!title.trim()) return setError("请填写任务标题");
    if (minutes === null || Number.isNaN(minutes) || minutes <= 0)
      return setError("请填写时长(支持 1.5 / 1:30 / 90m)");
    setBusy(true);
    setError("");
    try {
      await api.createEntry({
        date: date || todayKey(),
        projectId,
        title,
        minutes,
      });
      setTitle("");
      setDuration("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
      <span className="text-xs text-gray-400">快速记录</span>
      <HeroSelect
        ariaLabel="快速记录项目"
        className="w-36"
        items={active.map((p) => ({ id: p.id, name: p.name }))}
        selectedKey={projectId}
        onSelectionChange={setProjectId}
      />
      <Input
        placeholder="任务标题"
        className="w-48"
        list="quick-entry-tasks"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
      />
      <datalist id="quick-entry-tasks">
        {tasks
          .filter((t) => t.projectId === projectId)
          .map((t) => (
            <option key={t.id} value={t.title} />
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
      <Button size="sm" variant="primary" isDisabled={busy} onPress={() => void add()}>
        添加
      </Button>
      <span className="text-xs text-gray-400">→ {date || todayKey()}</span>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
