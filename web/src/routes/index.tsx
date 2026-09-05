import { createFileRoute } from "@tanstack/react-router";
import { Button, Chip } from "@heroui/react";

export const Route = createFileRoute("/")({
  component: AppShell,
});

function AppShell() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold">工时速记</h1>
          <span className="text-sm text-gray-500">手工登记外包项目投入</span>
        </div>
        <Chip color="accent" variant="soft" size="sm">
          总工时 0h
        </Chip>
      </header>
      <nav className="mt-6 flex gap-2">
        <Button variant="ghost" size="sm">
          周网格
        </Button>
        <Button variant="ghost" size="sm">
          日清单
        </Button>
        <Button variant="ghost" size="sm">
          月日历
        </Button>
      </nav>
      <section className="mt-6 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
        三视图建设中 —— 自 T2 起逐票点亮
      </section>
    </main>
  );
}
