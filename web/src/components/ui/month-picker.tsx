import * as React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { todayKey } from "@codex-worktime/timesheet-core";
import { cn } from "~/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

// 与 DatePicker 同构的月份选择:触发按钮 + 年份翻页 + 12 月网格
export function MonthPicker({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string; // YYYY-MM
  onChange: (month: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(Number(value.slice(0, 4)));

  React.useEffect(() => {
    if (open) setViewYear(Number(value.slice(0, 4)));
  }, [open, value]);

  const thisMonth = todayKey().slice(0, 7);

  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-36 items-center justify-between gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 outline-none transition-colors hover:border-zinc-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100",
          className,
        )}
      >
        <span className={value ? "" : "text-zinc-400"}>{value || "选择月份"}</span>
        <CalendarIcon className="h-3.5 w-3.5 text-zinc-400" />
      </BasePopover.Trigger>
      {/* Portal + z-[70] 原因同 DatePicker */}
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={6} className="z-[70] outline-none">
          <BasePopover.Popup className="w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg animate-zoom-in">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="上一年"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
                onClick={() => setViewYear((y) => y - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">{viewYear} 年</span>
              <button
                type="button"
                aria-label="下一年"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
                onClick={() => setViewYear((y) => y + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {MONTHS.map((mm) => {
                const month = `${viewYear}-${mm}`;
                return (
                  <button
                    key={mm}
                    type="button"
                    onClick={() => {
                      onChange(month);
                      setOpen(false);
                    }}
                    className={cn(
                      "h-9 rounded-md text-sm transition-colors",
                      "hover:bg-zinc-100",
                      month === value && "bg-brand-600 font-medium text-white hover:bg-brand-600",
                      month === thisMonth && month !== value && "text-brand-600 font-medium",
                      month !== value && month !== thisMonth && "text-zinc-700",
                    )}
                  >
                    {Number(mm)} 月
                  </button>
                );
              })}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
