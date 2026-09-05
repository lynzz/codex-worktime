import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

const hookEventSchema = z.object({
  hook_event_name: z.enum([
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop"
  ]),
  session_id: z.string().min(1),
  turn_id: z.string().min(1).optional(),
  tool_use_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
  trigger: z.enum(["manual", "auto"]).optional(),
  cwd: z.string().min(1)
}).superRefine((hook, context) => {
  const requireField = (field: "turn_id" | "tool_use_id" | "agent_id" | "source" | "trigger"): void => {
    if (!hook[field]) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for ${hook.hook_event_name} Hook events`
      });
    }
  };

  if (["UserPromptSubmit", "Stop"].includes(hook.hook_event_name)) {
    requireField("turn_id");
  }
  if (["PreToolUse", "PostToolUse"].includes(hook.hook_event_name)) {
    requireField("turn_id");
    requireField("tool_use_id");
  }
  if (["PreCompact", "PostCompact"].includes(hook.hook_event_name)) {
    requireField("turn_id");
    requireField("trigger");
  }
  if (["SubagentStart", "SubagentStop"].includes(hook.hook_event_name)) {
    requireField("turn_id");
    requireField("agent_id");
  }
  if (hook.hook_event_name === "SessionStart") {
    requireField("source");
  }
});

export type SanitizedHookEvent = {
  id: string;
  occurredAt: string;
  type: z.output<typeof hookEventSchema>["hook_event_name"];
  cwd: string;
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  agentId?: string;
  source: "hook";
};

export function sanitizeHookEvent(payload: unknown, occurredAt: string): SanitizedHookEvent {
  const hook = hookEventSchema.parse(payload);
  const normalizedTimestamp = Temporal.Instant.from(occurredAt).toString();
  const identity = JSON.stringify({
    event: hook.hook_event_name,
    session: hook.session_id,
    turn: hook.turn_id,
    cwd: hook.cwd,
    toolUse: hook.tool_use_id,
    agent: hook.agent_id,
    source: hook.source,
    trigger: hook.trigger
  });

  return {
    id: createHash("sha256").update(identity).digest("hex"),
    occurredAt: normalizedTimestamp,
    type: hook.hook_event_name,
    cwd: hook.cwd,
    sessionId: hook.session_id,
    ...(hook.turn_id ? { turnId: hook.turn_id } : {}),
    ...(hook.tool_use_id ? { toolUseId: hook.tool_use_id } : {}),
    ...(hook.agent_id ? { agentId: hook.agent_id } : {}),
    source: "hook"
  };
}
