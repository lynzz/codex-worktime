import { createAPIFileRoute } from "@tanstack/react-start/api";

// 页面已用内联 SVG 图标;此路由消掉浏览器对 /favicon.ico 的 404 探测
export const APIRoute = createAPIFileRoute("/favicon.ico")({
  GET: () => new Response(null, { status: 204 }),
});
