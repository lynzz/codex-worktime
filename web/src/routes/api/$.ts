import { createFileRoute } from "@tanstack/react-router";
import { api } from "~/server/api";

// catch-all:把 /api/* 原样转交给 Hono 应用(spec #11:REST 契约由 Hono 承载)
const handle = ({ request }: { request: Request }) => api.fetch(request);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      PUT: handle,
      DELETE: handle,
    },
  },
});
