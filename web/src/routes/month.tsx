import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MonthCalendar } from "~/components/MonthCalendar";
import { TimesheetShell } from "~/components/timesheet-shell";
import { loadTimesheet, searchSchema } from "~/lib/timesheet-route";

export const Route = createFileRoute("/month")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: MonthPage,
});

function MonthPage() {
  const data = Route.useLoaderData();
  const { date } = Route.useSearch();
  const router = useRouter();

  return (
    <TimesheetShell data={data}>
      <MonthCalendar
        date={date}
        projects={data.projects}
        entries={data.entries}
        onDateChange={(d) =>
          void router.navigate({ to: "/month", search: { date: d } })
        }
        onGotoDay={(d) =>
          void router.navigate({ to: "/day", search: { date: d } })
        }
        onChanged={() => void router.invalidate()}
      />
    </TimesheetShell>
  );
}
