import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Card } from "~/components/ui";
import { ProjectsContent } from "~/components/ProjectsPanel";
import { loadTimesheet, searchSchema } from "~/lib/timesheet-route";
import { todayKey } from "@codex-worktime/timesheet-core";

export const Route = createFileRoute("/projects")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { projects, tasks } = Route.useLoaderData();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <Card.Content className="p-5">
          <ProjectsContent
            projects={projects}
            tasks={tasks}
            onChanged={() => void router.invalidate()}
          />
        </Card.Content>
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        任务行按住 ⣿ 把手拖动排序;周网格行序按此顺序渲染 · {todayKey()}
      </p>
    </div>
  );
}
