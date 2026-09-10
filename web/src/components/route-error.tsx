import { useRouterState } from "@tanstack/react-router";
import { Button } from "~/components/ui";

// 视图路由错误兜底:网络抖动时给中文提示 + 一键重试,替代默认英文白屏
export function RouteErrorBoundary({ error }: { error: Error }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <p className="text-base font-semibold">页面加载失败</p>
      <p className="mt-2 text-sm text-gray-500">
        {error.message.includes("fetch") || error.message.includes("加载数据")
          ? "连接数据库超时(跨境网络抖动),数据没有丢失。"
          : error.message}
      </p>
      <Button
        className="mt-5"
        variant="primary"
        onPress={() => location.assign(pathname)}
      >
        重试
      </Button>
    </div>
  );
}
