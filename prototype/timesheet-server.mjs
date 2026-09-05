#!/usr/bin/env node
// 工时速记 —— PROTOTYPE(丢弃式原型,分支 prototype/manual-time-entry)
//
// 零依赖本地服务:静态页面 + 整包状态读写。
// 数据文件 timesheet.PROTOTYPE-WIPE-ME.json 与本脚本同目录,随时可整文件删除。
// 不触碰 codex-worktime 的 SQLite 数据与报告管线。

import http from "node:http";
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "timesheet.html");
const dataPath = path.join(here, "timesheet.PROTOTYPE-WIPE-ME.json");
const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function emptyState() {
  return { version: 1, projects: [], tasks: [], entries: [], updatedAt: null };
}

function loadState() {
  if (!existsSync(dataPath)) return emptyState();
  try {
    return normalizeState(JSON.parse(readFileSync(dataPath, "utf8")));
  } catch (error) {
    console.error(`[proto] 数据文件解析失败,按空状态启动:${error.message}`);
    return emptyState();
  }
}

// 只做最小形状校验,不做业务校验——原型原则:浏览器端是唯一写入方。
function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const entries = Array.isArray(state.entries) ? state.entries : [];
  return {
    version: 1,
    projects: projects
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({ id: p.id, name: p.name, archived: Boolean(p.archived) })),
    tasks: tasks
      .filter((t) => t && typeof t.id === "string" && typeof t.projectId === "string" && typeof t.title === "string" && t.title.trim())
      .map((t) => ({ id: t.id, projectId: t.projectId, title: t.title.trim() })),
    entries: entries
      .filter(
        (e) =>
          e &&
          typeof e.id === "string" &&
          typeof e.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
          typeof e.projectId === "string" &&
          Number.isFinite(e.minutes) &&
          e.minutes > 0,
      )
      .map((e) => ({
        id: e.id,
        date: e.date,
        projectId: e.projectId,
        minutes: Math.round(e.minutes),
        title: typeof e.title === "string" && e.title.trim() ? e.title.trim() : null,
        taskId: typeof e.taskId === "string" ? e.taskId : null,
        category: typeof e.category === "string" ? e.category : null,
        note: typeof e.note === "string" && e.note.trim() ? e.note.trim() : null,
        start: typeof e.start === "string" ? e.start : null,
        end: typeof e.end === "string" ? e.end : null,
      })),
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
  };
}

function saveState(raw) {
  const state = normalizeState(raw);
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${dataPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, dataPath);
  return state;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      const html = readFileSync(htmlPath, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, loadState());
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/state") {
      const raw = JSON.parse(await readBody(req));
      const saved = saveState(raw);
      sendJson(res, 200, saved);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      const saved = saveState(emptyState());
      sendJson(res, 200, saved);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[proto] 端口 ${PORT} 已被占用。换一个端口:PORT=8788 npm run proto:timesheet`);
    process.exit(1);
  }
  console.error(`[proto] 服务器错误:${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("[proto] 工时速记原型已启动(丢弃式原型,数据可随时删除)");
  console.log(`[proto] 打开 http://${HOST}:${PORT}`);
  console.log(`[proto] 数据文件:${dataPath}`);
});
