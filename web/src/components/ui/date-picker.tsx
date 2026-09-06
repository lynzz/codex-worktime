import * as React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { addDays, monthDays, todayKey } from "@codex-worktime/timesheet-core";
import { cn } from "~/lib/utils";

const DOW = ["一", "二", "三", "四", "五", "六", "日"];

// shadcn 风格日期选择:触发按钮 + 日历弹层(周一为首列)
export function DatePicker({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(value.slice(0, 7));

  React.useEffect(() => {
    if (open) setViewMonth(value.slice(0, 7));
  }, [open, value]);

  const today = todayKey();
  const grid = monthDays(`${viewMonth}-15`);
  const label = `${viewMonth}-01`;
  const [y, m] = viewMonth.split("-").map(Number);

  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-36 items-center justify-between gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
          className,
        )}
      >
        <span className={value ? "" : "text-gray-400"}>{value || "选择日期"}</span>
        <CalendarIcon className="h-3.5 w-3.5 text-gray-400" />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={6} className="z-50 outline-none">
          <BasePopover.Popup className="w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg animate-zoom-in">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="上个月"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  const d = new Date(y!, (m ?? 1) - 2, 1);
                  setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">
                {y} 年 {m} 月
              </span>
              <button
                type="button"
                aria-label="下个月"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  const d = new Date(y!, m ?? 1, 1);
                  setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {DOW.map((d) => (
                <div key={d} className="py-1 text-xs text-gray-400">
                  {d}
                </div>
              ))}
              {grid.map((day, i) =>
                day ? (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                    className={cn(
                      "h-8 rounded-md text-sm transition-colors",
                      "hover:bg-gray-100",
                      day === value && "bg-blue-600 font-medium text-white hover:bg-blue-600",
                      day === today && day !== value && "text-blue-600 font-medium",
                      day !== value && day !== today && "text-gray-700",
                    )}
                  >
                    {parseInt(day.slice(8), 10)}
                  </button>
                ) : (
                  <div key={`e${i}`} />
                ),
              )}
            </div>
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                onClick={() => {
                  onChange(today);
                  setOpen(false);
                }}
              >
                今天
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  onChange(addDays(today, -1));
                  setOpen(false);
                }}
              >
                昨天
              </button>
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
