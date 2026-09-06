import { createFileRoute, useRouter } from "@tanstack/react-router";
import { DayList } from "~/components/DayList";
import { TimesheetShell } from "~/components/timesheet-shell";
import { loadTimesheet, searchSchema } from "~/lib/timesheet-route";

export const Route = createFileRoute("/day")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: DayPage,
});

function DayPage() {
  const data = Route.useLoaderData();
  const { date } = Route.useSearch();
  const router = useRouter();

  return (
    <TimesheetShell data={data}>
      <DayList
        date={date}
        projects={data.projects}
        entries={data.entries}
        onDateChange={(d) =>
          void router.navigate({ to: "/day", search: { date: d } })
        }
        onChanged={() => void router.invalidate()}
      />
    </TimesheetShell>
  );
}
