import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button, Card } from "~/components/ui";
import { ImportForm } from "~/components/ImportDialog";
import { ExportForm } from "~/components/ExportDialog";
import { api } from "~/lib/api";
import { loadTimesheet, searchSchema } from "~/lib/timesheet-route";

export const Route = createFileRoute("/data")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: DataPage,
});

function DataPage() {
  const router = useRouter();
  const refresh = () => void router.invalidate();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Card>
        <Card.Header className="px-5 pt-4 text-sm font-semibold">导入</Card.Header>
        <Card.Content className="p-5 pt-3">
          <ImportForm onChanged={refresh} />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header className="px-5 pt-4 text-sm font-semibold">导出</Card.Header>
        <Card.Content className="p-5 pt-3">
          <ExportForm />
          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
            <span className="text-xs text-gray-400">原始数据</span>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => void exportJson()}
            >
              导出 JSON(全量)
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

async function exportJson() {
  const [entries, projects, tasks] = await Promise.all([
    api.listEntries(),
    api.listProjects(),
    api.listTasks(),
  ]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), projects, tasks, entries },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  a.download = `工时数据_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
