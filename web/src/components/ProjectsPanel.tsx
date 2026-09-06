import { useState } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Input, Modal } from "~/components/ui";
import type { Project, Task } from "@codex-worktime/timesheet-core";
import { api } from "~/lib/api";
import { HeroSelect } from "~/components/HeroSelect";
import { projectColor } from "~/lib/colors";

export function ProjectsPanel({
  projects,
  tasks,
  isOpen,
  onClose,
  onChanged,
}: {
  projects: Project[];
  tasks: Task[];
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
            <Modal.Header>项目与任务行</Modal.Header>
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

              {actives.length > 0 && (
                <TaskRowsSection
                  actives={actives}
                  tasks={tasks}
                  run={run}
                />
              )}

              <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="max-w-52 text-xs text-gray-400">
                  清空全部项目、任务行与工时记录(不可恢复,请先导出)
                </span>
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={() => {
                    if (
                      window.confirm("确定清空全部人工工时数据?") &&
                      window.confirm("再次确认:清空后不可恢复(除非已导出)。")
                    ) {
                      void run(() => api.resetManualData());
                    }
                  }}
                >
                  清空
                </Button>
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

function TaskRowsSection({
  actives,
  tasks,
  run,
}: {
  actives: Project[];
  tasks: Task[];
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(actives[0]?.id ?? "");
  const [title, setTitle] = useState("");

  function add() {
    if (!title.trim()) return;
    void run(async () => {
      await api.createTask({ projectId, title });
      setTitle("");
    });
  }

  return (
    <div className="mt-5 border-t border-gray-100 pt-3">
      <p className="text-sm font-semibold">任务行(周网格常驻行)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <HeroSelect
          ariaLabel="任务行项目"
          className="w-36"
          items={actives.map((p) => ({ id: p.id, name: p.name }))}
          selectedKey={projectId}
          onSelectionChange={setProjectId}
        />
        <Input
          placeholder="任务标题,如:登录页联调"
          className="w-48"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="primary" isDisabled={!title.trim()} onPress={add}>
          ＋ 添加任务行
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {tasks.length === 0 && (
          <p className="text-sm text-gray-400">
            还没有任务行;日清单里输入同名标题会自动关联
          </p>
        )}
        <SortableTaskList
          tasks={tasks}
          actives={actives}
          run={run}
        />
      </div>
    </div>
  );
}

// 拖动排序(dnd-kit):拖左侧把手调整任务行顺序,落定即保存
function SortableTaskList({
  tasks,
  actives,
  run,
}: {
  tasks: Task[];
  actives: Project[];
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [order, setOrder] = useState<Task[] | null>(null);
  const items = order ?? tasks;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((t) => t.id === active.id);
    const newIndex = items.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setOrder(next); // 乐观更新
    void run(async () => {
      await api.reorderTasks(next.map((t) => t.id));
      setOrder(null); // 以服务器数据为准
    });
  }

  return (
    <DndContext
      sensors={useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor),
      )}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {items.map((t) => (
          <SortableTaskRow key={t.id} task={t} actives={actives} run={run} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableTaskRow({
  task,
  actives,
  run,
}: {
  task: Task;
  actives: Project[];
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm ${isDragging ? "z-10 bg-blue-50/80 shadow-md" : "bg-transparent"}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        aria-label="拖动排序"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: projectColor(task.projectId) }}
      />
      <span className="text-gray-500">
        {actives.find((p) => p.id === task.projectId)?.name ?? "?"}
      </span>
      <Input
        aria-label="任务行标题"
        className="min-w-40 flex-1"
        defaultValue={task.title}
        onBlur={(e) => {
          const title = e.target.value.trim();
          if (title && title !== task.title) {
            void run(() => api.patchTask(task.id, { title }));
          }
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        onPress={() => run(() => api.deleteTask(task.id))}
      >
        删除
      </Button>
    </div>
  );
}
