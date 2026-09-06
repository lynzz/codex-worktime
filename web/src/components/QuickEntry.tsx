import { useState } from "react";
import { Button, Input, Spinner, TextArea } from "~/components/ui";
import {
  parseDurationInput,
  todayKey,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { HeroSelect } from "~/components/HeroSelect";

// AI 对话式快速记录:上方大输入框(Enter 发送),下方一行 项目/时长/日期/发送
export function QuickEntry({
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
  const [targetDate, setTargetDate] = useState(todayKey());

  async function add() {
    const minutes = parseDurationInput(duration);
    if (!title.trim()) return setError("请填写任务标题");
    if (minutes === null || Number.isNaN(minutes) || minutes <= 0)
      return setError("请填写时长(支持 1.5 / 1:30 / 90m)");
    setBusy(true);
    setError("");
    try {
      await api.createEntry({
        date: targetDate || todayKey(),
        projectId,
        title: title.replace(/\s+/g, " ").trim(),
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
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors focus-within:border-blue-400">
      <TextArea
        aria-label="任务标题"
        placeholder="记一笔工时:在做什么…(Enter 发送)"
        className="w-full resize-none border-none bg-transparent text-sm"
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
        }}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        <HeroSelect
          ariaLabel="快速记录项目"
          className="w-32"
          items={active.map((p) => ({ id: p.id, name: p.name }))}
          selectedKey={projectId}
          onSelectionChange={setProjectId}
        />
        <Input
          placeholder="时长 1.5 / 1:30 / 90m"
          className="w-40"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Input
          type="date"
          aria-label="记录日期"
          className="w-36"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
        {targetDate !== todayKey() && (
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => setTargetDate(todayKey())}
          >
            今天
          </Button>
        )}
        <Button
          className="ml-auto"
          size="sm"
          variant="primary"
          isDisabled={busy}
          onPress={() => void add()}
        >
          {busy ? <Spinner size="sm" /> : "发送 ↵"}
        </Button>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
