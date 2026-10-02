import { useCallback } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ReportsWorkspace } from "~/components/ReportsWorkspace";
import { Button } from "~/components/ui";
import { loadReports, reportSearchSchema } from "~/lib/report-route";
import type { ReportSearch } from "~/lib/report-route";

export const Route = createFileRoute("/reports")({
  validateSearch: (search) => reportSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadReports({ data: deps }),
  pendingComponent: () => <p role="status" className="p-4 text-sm text-zinc-500">正在加载报告与当前账号数据…</p>,
  errorComponent: ({ error }) => <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-200 p-6">
    <h2 className="font-semibold">报告页面加载失败</h2>
    <p className="mt-2 text-sm text-zinc-500">{error.message}</p>
    <Button className="mt-4" onPress={() => location.reload()}>保留项目、月份和版本重试</Button>
  </div>,
  component: ReportsPage,
});

function ReportsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const navigate = useCallback(async (next: ReportSearch, replace = false) => {
    await router.navigate({ to: "/reports", search: next, replace });
  }, [router]);
  const refresh = useCallback(async () => { await router.invalidate(); }, [router]);
  return <ReportsWorkspace key={`${data.user.username}:${data.profileId ?? ""}:${search.month}`}
    data={data} search={search} navigate={navigate} refresh={refresh} />;
}
