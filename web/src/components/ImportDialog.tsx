import { useRef, useState } from "react";
import { Button, Input, Modal, Spinner } from "@heroui/react";
import { todayKey } from "@codex-worktime/timesheet-core";

type Count = { inserted?: number; skipped?: number; created?: number; existing?: number };

// 导入:JSON(原型/本应用导出,按 id 幂等)或 任务清单模板 XLSX(导出→改→导回)
export function ImportDialog({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [jsonPayload, setJsonPayload] = useState("");
  const [preview, setPreview] = useState<{
    projects: number;
    tasks: number;
    entries: number;
  } | null>(null);
  const [targetDate, setTargetDate] = useState(todayKey());
  const [result, setResult] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isExcel = file?.name.toLowerCase().endsWith(".xlsx") ?? false;

  function reset() {
    setFile(null);
    setJsonPayload("");
    setPreview(null);
    setResult(null);
    setError("");
  }

  async function pick(f: File) {
    reset();
    setFile(f);
    if (f.name.toLowerCase().endsWith(".xlsx")) return; // 解析在服务端
    try {
      const text = await f.text();
      const data = JSON.parse(text) as Record<string, unknown[] | undefined>;
      setJsonPayload(text);
      setPreview({
        projects: data.projects?.length ?? 0,
        tasks: data.tasks?.length ?? 0,
        entries: data.entries?.length ?? 0,
      });
    } catch {
      setError("不是有效的 JSON 文件");
    }
  }

  async function doImport() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (isExcel) {
        res = await fetch(
          `/api/import/xlsx?date=${targetDate}`,
          await file.arrayBuffer().then((buf) => ({
            method: "POST",
            headers: {
              "content-type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
            body: buf,
          })),
        );
      } else {
        res = await fetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: jsonPayload,
        });
      }
      const body = (await res.json()) as Record<string, Count> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `导入失败(${res.status})`);
      setResult(
        (Object.entries(body) as [string, Count][])
          .filter(([, v]) => typeof v === "object" && v !== null)
          .map(([k, v]) => {
            const parts = [
              v.created !== undefined ? `新建 ${v.created}` : null,
              v.existing !== undefined ? `已存在 ${v.existing}` : null,
              v.inserted !== undefined ? `新增 ${v.inserted}` : null,
              v.skipped !== undefined ? `跳过 ${v.skipped}` : null,
            ].filter(Boolean);
            const label = k === "projects" ? "项目" : k === "tasks" ? "任务行" : "条目";
            return `${label}:${parts.join(" / ")}`;
          }),
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>导入</Modal.Header>
            <Modal.Body>
              <input
                ref={inputRef}
                type="file"
                accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pick(f);
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => inputRef.current?.click()}
                >
                  选择文件…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    window.location.href = "/api/import/template";
                  }}
                >
                  下载模板
                </Button>
              </div>

              {file && <p className="mt-2 text-sm text-gray-500">{file.name}</p>}
              {isExcel && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-gray-500">工时记到</span>
                  <Input
                    type="date"
                    aria-label="目标日期"
                    className="w-40"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>
              )}
              {preview && !result && (
                <p className="mt-1 text-sm">
                  将导入:项目 {preview.projects}、任务行 {preview.tasks}、
                  条目 {preview.entries}(已存在的按 id 跳过)
                </p>
              )}
              {result && (
                <div className="mt-2 text-sm">
                  {result.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
              <p className="mt-2 text-xs text-gray-400">
                支持 JSON(原型数据 / 本应用导出,按 id 幂等)与 任务清单模板
                XLSX(按 项目+任务 建档;行内日期列填了用行内日期,留空记到所选日期;重复导入同数值会跳过)
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  reset();
                  onClose();
                }}
              >
                关闭
              </Button>
              <Button
                size="sm"
                variant="primary"
                isDisabled={!file || busy}
                onPress={() => void doImport()}
              >
                {busy ? <Spinner size="sm" /> : "导入"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
