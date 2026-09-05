import { useState } from "react";
import { Button, Input, Modal } from "@heroui/react";
import type { Project } from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";

export function ProjectsPanel({
  projects,
  isOpen,
  onClose,
  onChanged,
}: {
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const actives = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const row = (p: Project, isArchived: boolean) => (
    <div key={p.id} className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: projectColor(p.id) }}
      />
      <Input
        aria-label="项目名"
        className="w-48"
        defaultValue={p.name}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== p.name) run(() => api.patchProject(p.id, { name }));
        }}
      />
      <Button
        size="sm"
        variant="tertiary"
        onPress={() => run(() => api.patchProject(p.id, { archived: !isArchived }))}
      >
        {isArchived ? "恢复" : "归档"}
      </Button>
      <Button
        size="sm"
        variant="danger-soft"
        onPress={() => run(() => api.deleteProject(p.id))}
      >
        删除
      </Button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>项目管理</Modal.Header>
            <Modal.Body>
              <div className="flex gap-2">
                <Input
                  placeholder="新项目名"
                  className="w-48"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      e.preventDefault();
                      run(async () => {
                        await api.createProject({ name: newName });
                        setNewName("");
                      });
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={!newName.trim()}
                  onPress={() =>
                    run(async () => {
                      await api.createProject({ name: newName });
                      setNewName("");
                    })
                  }
                >
                  添加
                </Button>
              </div>
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
              <div className="mt-3 flex flex-col gap-2">
                {actives.length === 0 && archived.length === 0 && (
                  <p className="text-sm text-gray-400">还没有项目</p>
                )}
                {actives.map((p) => row(p, false))}
                {archived.length > 0 && (
                  <p className="mt-2 text-xs text-gray-400">已归档</p>
                )}
                {archived.map((p) => row(p, true))}
              </div>
            </Modal.Body>
            <Modal.Footer>
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
