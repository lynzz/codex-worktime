import { createFileRoute, useRouter } from "@tanstack/react-router";
import { WeekGrid } from "~/components/WeekGrid";
import { TimesheetShell } from "~/components/timesheet-shell";
import { loadTimesheet, searchSchema } from "~/lib/timesheet-route";

export const Route = createFileRoute("/week")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: WeekPage,
});

function WeekPage() {
  const data = Route.useLoaderData();
  const { date } = Route.useSearch();
  const router = useRouter();

  return (
    <TimesheetShell data={data}>
      <WeekGrid
        date={date}
        projects={data.projects}
        tasks={data.tasks}
        entries={data.entries}
        onDateChange={(d) =>
          void router.navigate({ to: "/week", search: { date: d } })
        }
        onGotoDay={(d) =>
          void router.navigate({ to: "/day", search: { date: d } })
        }
        onChanged={() => void router.invalidate()}
      />
    </TimesheetShell>
  );
}
