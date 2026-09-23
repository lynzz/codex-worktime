import { useMemo, useState } from "react";
import { Button, Chip, DatePicker, Input, Modal, Spinner } from "~/components/ui";
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
    <div className="mt-6 flex min-h-0 flex-1 flex-col gap-2">
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
          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
            ¥{Math.round((monthTotal / 60 / 8) * 1200).toLocaleString()}
          </span>
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

      {/* Teams 风格:日历占满剩余视口高度,行高自动拉伸;星期行+日格同一边框 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200">
        <div className="grid shrink-0 grid-cols-7 border-b border-gray-200 bg-gray-50">
          {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
            <div key={d} className="py-1.5 text-center text-xs font-medium text-gray-400">
              {d}
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-gray-200">
          {grid.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="bg-gray-50" />;
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
                className={`flex min-h-0 flex-col overflow-hidden p-1.5 text-left text-xs transition-colors ${
                  day === selected
                    ? "bg-blue-50 ring-2 ring-inset ring-blue-500"
                    : isWeekend(day)
                      ? "bg-gray-50 hover:bg-blue-50/50"
                      : "bg-white hover:bg-blue-50/50"
                }`}
              >
                <div className="flex shrink-0 items-baseline justify-between">
                  <span
                    className={
                      day === today
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-bold text-white"
                        : "text-gray-500"
                    }
                  >
                    {parseInt(day.slice(8), 10)}
                  </span>
                  {total > 0 && (
                    <span className="text-[11px] font-bold text-gray-600">
                      {formatHours(total)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
                  {dayEntries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-1 truncate rounded px-0.5 leading-4.5"
                      style={{ background: `${projectColor(e.projectId)}15` }}
                    >
                      <span
                        className="h-1 w-1 shrink-0 rounded-full"
                        style={{ background: projectColor(e.projectId) }}
                      />
                      <span className="truncate text-[11px] text-gray-700">{e.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                        {formatHours(e.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
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
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const dayEntries = entries.filter((e) => e.date === date);
  const dayTotal = dayEntries.reduce((s, e) => s + e.minutes, 0);

  // 实时解析(与主页 Composer 同逻辑)
  const parsed = useMemo(() => {
    let text = title.trim();
    let minutes = 0;
    let pid = active[0]?.id ?? "";
    const durMatch = text.match(/(\d+(?:\.\d+)?h|\d+m|\d+:\d{2})(?=\s|$)/i);
    if (durMatch) {
      minutes = parseDurationInput(durMatch[1]) ?? 0;
      text = text.replace(durMatch[0], "").trim();
    }
    const tagMatch = text.match(/#(\S+)/);
    if (tagMatch) {
      const lower = tagMatch[1]!.toLowerCase();
      const found = active.find(
        (p) =>
          p.name === tagMatch[1] ||
          p.name.toLowerCase() === lower ||
          p.name.toLowerCase().startsWith(lower) ||
          p.name.toLowerCase().includes(lower),
      );
      if (found) {
        pid = found.id;
        text = text.replace(tagMatch[0], "").trim();
      }
    }
    return { title: text, minutes, projectId: pid };
  }, [title, active]);

  async function add() {
    if (!parsed.title.trim()) return setError("写点任务内容…");
    if (!parsed.minutes) return setError("带上时长,如:1.5h / 90m / 1:30");
    setBusy(true);
    setError("");
    try {
      await api.createEntry({
        date,
        projectId: parsed.projectId,
        title: parsed.title,
        minutes: parsed.minutes,
      });
      setTitle("");
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
              {/* 记一笔同款紧凑输入:单行 + 行内时长 + #项目 + 实时回显 */}
              <div className="flex items-start gap-2 rounded-2xl border-2 border-blue-400 bg-white px-3 py-2">
                <textarea
                  rows={1}
                  value={title}
                  placeholder={`任务… 1.5h #项目(可选)`}
                  className="mt-0.5 min-h-[28px] w-full flex-1 resize-none border-none bg-transparent text-sm leading-7 outline-none placeholder:text-gray-400"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 60)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void add();
                    }
                  }}
                />
                <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                  <Button size="sm" variant="primary" isDisabled={busy} onPress={() => void add()}>
                    {busy ? <Spinner size="sm" /> : "记 ↵"}
                  </Button>
                  <div className="flex items-center gap-1 text-[11px] leading-none">
                    <span className="text-gray-400">
                      {active.find((p) => p.id === parsed.projectId)?.name ?? "…"}
                    </span>
                    {parsed.minutes > 0 && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-600">
                        {formatHours(parsed.minutes)}
                      </span>
                    )}
                    {error && <span className="text-red-500">{error}</span>}
                  </div>
                </div>
              </div>

              {dayEntries.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {dayEntries.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: projectColor(e.projectId) }}
                      />
                      <input
                        aria-label="任务标题"
                        className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-sm hover:border-gray-200 focus:border-blue-500 focus:bg-white focus:outline-none"
                        defaultValue={e.title}
                        onBlur={(ev) => {
                          const t = ev.target.value.trim();
                          if (t && t !== e.title) {
                            void api.patchEntry(e.id, { title: t }).then(onChanged);
                          }
                        }}
                      />
                      <input
                        aria-label="时长(小时)"
                        className="w-14 rounded-md border border-transparent px-1 py-0.5 text-center text-sm font-semibold tabular-nums hover:border-gray-200 focus:border-blue-500 focus:bg-white focus:outline-none"
                        inputMode="decimal"
                        defaultValue={Math.round((e.minutes / 60) * 100) / 100 || ""}
                        title="支持 1.5 / 1:30 / 90m"
                        onBlur={(ev) => {
                          const raw = ev.target.value.trim();
                          if (!raw) return;
                          const mins = parseDurationInput(raw);
                          if (mins && mins > 0 && mins !== e.minutes) {
                            void api.patchEntry(e.id, { minutes: mins }).then(onChanged);
                          }
                        }}
                      />
                      <DatePicker
                        ariaLabel="改日期"
                        className="h-6 w-28 text-[11px]"
                        value={e.date}
                        onChange={(newDate) => {
                          if (newDate && newDate !== e.date) {
                            void api.patchEntry(e.id, { date: newDate }).then(onChanged);
                          }
                        }}
                      />
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
