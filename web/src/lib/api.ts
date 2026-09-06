import type { Project, ProjectCreate, ProjectPatch, Entry, EntryCreate, EntryPatch, Task, TaskCreate, TaskPatch } from "@codex-worktime/timesheet-core";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `请求失败(${res.status})`);
  return body;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (input: ProjectCreate) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchProject: (id: string, patch: ProjectPatch) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  listEntries: (from?: string, to?: string) =>
    request<Entry[]>(
      `/api/entries${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ""}`,
    ),
  createEntry: (input: EntryCreate) =>
    request<Entry>("/api/entries", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchEntry: (id: string, patch: EntryPatch) =>
    request<Entry>(`/api/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteEntry: (id: string) =>
    request<{ ok: boolean }>(`/api/entries/${id}`, { method: "DELETE" }),

  listTasks: () => request<Task[]>("/api/tasks"),
  createTask: (input: TaskCreate) =>
    request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchTask: (id: string, patch: TaskPatch) =>
    request<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
  reorderTasks: (ids: string[]) =>
    request<{ ok: boolean }>("/api/tasks/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  resetManualData: () =>
    request<{ ok: boolean }>("/api/projects/reset", {
      method: "POST",
      body: JSON.stringify({ confirm: "CLEAR_MANUAL_DATA" }),
    }),

  replaceCell: (input: {
    date: string;
    projectId: string;
    taskId: string | null;
    title: string | null;
    minutes: number | null;
  }) =>
    request<{ ok: boolean }>("/api/entries/replace-cell", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
