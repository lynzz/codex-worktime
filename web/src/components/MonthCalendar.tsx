import { useMemo, useState } from "react";
import { Button, Chip, Input, Modal, Spinner } from "@heroui/react";
import {
  dayOfWeekCN,
  formatHours,
  isWeekend,
  monthDays,
  monthStart,
  nextMonthFirst,
  parseDurationInput,
  todayKey,
  type Entry,
  type Project,
} from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";
import { HeroSelect } from "~/components/HeroSelect";

function monthLabel(anchor: string): string {
  const [y, m] = anchor.split("-").map(Number);
  return `${y} 年 ${m} 月`;
}

function shiftMonth(anchor: string, delta: number): string {
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function MonthCalendar({
  date,
  projects,
  entries,
  onDateChange,
  onGotoDay,
  onChanged,
}: {
  date: string;
  projects: Project[];
  entries: Entry[];
  onDateChange: (date: string) => void;
  onGotoDay: (date: string) => void;
  onChanged: () => void;
}) {
  const today = todayKey();
  const [selected, setSelected] = useState(date);
  const [modalOpen, setModalOpen] = useState(false);

  const grid = useMemo(() => monthDays(date), [date]);
  const active = projects.filter((p) => !p.archived);
  const monthTotal = entries
    .filter((e) => e.date >= monthStart(date) && e.date < nextMonthFirst(date))
    .reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onPress={() => onDateChange(shiftMonth(date, -1))}>
          ← 上月
        </Button>
        <span className="text-sm font-semibold">{monthLabel(date)}</span>
        <Button size="sm" variant="ghost" onPress={() => onDateChange(shiftMonth(date, 1))}>
          下月 →
        </Button>
        {date.slice(0, 7) !== today.slice(0, 7) && (
          <Button size="sm" variant="tertiary" onPress={() => onDateChange(today)}>
            本月
          </Button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
          本月合计 <b className="text-gray-900">{formatHours(monthTotal)}</b>
          {active.map((p) => {
            const pm = entries
              .filter(
                (e) =>
                  e.projectId === p.id &&
                  e.date >= monthStart(date) &&
                  e.date < nextMonthFirst(date),
              )
              .reduce((s, e) => s + e.minutes, 0);
            return (
              <Chip key={p.id} size="sm" variant="soft">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: projectColor(p.id) }}
                  />
                  {p.name} {formatHours(pm)}
                </span>
              </Chip>
            );
          })}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((d) => (
          <div key={d} className="py-1 text-center text-xs text-gray-400">
            {d}
          </div>
        ))}
        {grid.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;
          const dayEntries = entries.filter((e) => e.date === day);
          const total = dayEntries.reduce((s, e) => s + e.minutes, 0);
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelected(day);
                setModalOpen(true);
              }}
              className={`min-h-20 rounded-lg border p-1.5 text-left align-top text-xs ${
                day === selected
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : "border-gray-200 hover:border-blue-300"
              } ${isWeekend(day) ? "bg-gray-50/60" : "bg-white"} ${day === today ? "border-blue-400" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <span className={day === today ? "font-bold text-blue-600" : "text-gray-400"}>
                  {parseInt(day.slice(8), 10)}日
                </span>
                {total > 0 && (
                  <span className="text-xs font-bold">{formatHours(total)}</span>
                )}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {dayEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-1 truncate">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: projectColor(e.projectId) }}
                    />
                    <span className="truncate">{e.title}</span>
                    <span className="ml-auto shrink-0 text-gray-400">
                      {formatHours(e.minutes)}
                    </span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <DayEntryModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        date={selected}
        projects={projects}
        entries={entries}
        onChanged={onChanged}
        onGotoDay={(d) => {
          setModalOpen(false);
          onGotoDay(d);
        }}
      />
    </div>
  );
}

function DayEntryModal({
  isOpen,
  onClose,
  date,
  projects,
  entries,
  onChanged,
  onGotoDay,
}: {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  projects: Project[];
  entries: Entry[];
  onChanged: () => void;
  onGotoDay: (date: string) => void;
}) {
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(active[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const dayEntries = entries.filter((e) => e.date === date);
  const dayTotal = dayEntries.reduce((s, e) => s + e.minutes, 0);

  async function add() {
    const minutes = parseDurationInput(duration);
    if (!title.trim()) return setError("请填写任务标题");
    if (minutes === null || Number.isNaN(minutes) || minutes <= 0)
      return setError("请填写时长(支持 1.5 / 1:30 / 90m)");
    setBusy(true);
    setError("");
    try {
      await api.createEntry({ date, projectId, title, minutes });
      setTitle("");
      setDuration("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              {date} {dayOfWeekCN(date)} · 已登记 {formatHours(dayTotal)}
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-wrap items-end gap-2">
                <HeroSelect
                  ariaLabel="补录项目"
                  className="w-36"
                  items={active.map((p) => ({ id: p.id, name: p.name }))}
                  selectedKey={projectId}
                  onSelectionChange={setProjectId}
                />
                <Input
                  placeholder="任务标题"
                  className="w-44"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void add();
                    }
                  }}
                />
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
                  {busy ? <Spinner size="sm" /> : "添加"}
                </Button>
              </div>
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

              {dayEntries.length > 0 && (
                <div className="mt-3 flex flex-col gap-1">
                  {dayEntries.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: projectColor(e.projectId) }}
                      />
                      <span className="flex-1 truncate">{e.title}</span>
                      <span className="font-semibold">{formatHours(e.minutes)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          void api.deleteEntry(e.id).then(onChanged);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button size="sm" variant="ghost" onPress={() => onGotoDay(date)}>
                日清单 →
              </Button>
              <Button size="sm" variant="ghost" onPress={onClose}>
                关闭
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
