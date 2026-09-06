import { useState } from "react";
import { Button, DatePicker, Input, Modal, Tabs } from "~/components/ui";
import { monthStart, nextMonthFirst, todayKey } from "@codex-worktime/timesheet-core";

// 导出范围:本月 / 按月份 / 自定义区间
export function ExportDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const t = todayKey();
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(t.slice(0, 7));
  const [from, setFrom] = useState(monthStart(t));
  const [to, setTo] = useState(t);
  const [error, setError] = useState("");

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
    window.location.href = `/api/export/xlsx?${qs}`;
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>导出 XLSX(按模板)</Modal.Header>
            <Modal.Body>
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
                  <Input
                    type="month"
                    aria-label="月份"
                    className="w-40"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
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
                  <span className="text-sm text-gray-400">至</span>
                  <DatePicker ariaLabel="结束日期" value={to} onChange={setTo} />
                </div>
              )}
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
              <p className="mt-2 text-xs text-gray-400">
                聚合口径:项目 + 任务;优先级默认 P1,导出后可在 Excel 中调整
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button size="sm" variant="ghost" onPress={onClose}>
                取消
              </Button>
              <Button size="sm" variant="primary" onPress={download}>
                导出
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
