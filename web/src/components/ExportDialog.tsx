import { useState } from "react";
import { Button, DatePicker, MonthPicker, Switch, Tabs } from "~/components/ui";
import { monthStart, nextMonthFirst, todayKey } from "@codex-worktime/timesheet-core";

// 导出范围:本月 / 按月份 / 自定义区间
export function ExportForm() {
  const t = todayKey();
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(t.slice(0, 7));
  const [from, setFrom] = useState(monthStart(t));
  const [to, setTo] = useState(t);
  const [error, setError] = useState("");
  const [fillDates, setFillDates] = useState(true);

  function download() {
    setError("");
    const qs =
      mode === "month"
        ? `month=${month}`
        : `from=${from}&to=${to}`;
    if (mode === "month" && !/^\d{4}-\d{2}$/.test(month)) {
      return setError("请选择月份");
    }
    if (mode === "range" && (!from || !to)) {
      return setError("请提供起止日期");
    }
    window.location.href = `/api/export/xlsx?${qs}&fillDates=${fillDates ? 1 : 0}`;
  }

  return (
    <div className="flex flex-col gap-3">
              <Tabs
                aria-label="导出范围"
                selectedKey={mode}
                onSelectionChange={(k) => setMode(k as "month" | "range")}
              >
                <Tabs.ListContainer>
                  <Tabs.List>
                    <Tabs.Tab id="month">
                      按月份
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="range">
                      时间范围
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>

              {mode === "month" ? (
                <div className="mt-3 flex items-center gap-2">
                  <MonthPicker ariaLabel="月份" value={month} onChange={setMonth} />
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => setMonth(t.slice(0, 7))}
                  >
                    本月
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => setMonth(monthStart(nextMonthFirst(t)).slice(0, 7))}
                  >
                    上月
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <DatePicker ariaLabel="开始日期" value={from} onChange={setFrom} />
                  <span className="text-sm text-zinc-400">至</span>
                  <DatePicker ariaLabel="结束日期" value={to} onChange={setTo} />
                </div>
              )}
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
              <Switch checked={fillDates} onCheckedChange={setFillDates}>
                日期列填入日期
              </Switch>
              <p className="text-xs text-zinc-400">
                {fillDates
                  ? "聚合口径:日期 + 项目 + 任务;按日期升序,底部合计总工时与总金额"
                  : "聚合口径:项目 + 任务,日期列留空;按最早日期升序,底部合计总工时与总金额"}
              </p>
      <Button size="sm" variant="primary" className="self-start" onPress={download}>
        导出 XLSX
      </Button>
    </div>
  );
}
