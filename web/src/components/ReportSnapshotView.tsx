import { useState } from "react";
import type { ReportSnapshot } from "@codex-worktime/report-core";

const coverageLabels = {
  available: "可用：观察到匹配的元数据",
  "no-data": "无数据：来源可读,但没有匹配记录（不代表零工时）",
  unknown: "未知：无法确认该日期的覆盖情况",
};
const sourceLabels = {
  fixture: "受控导入", history: "Codex 历史", hook: "Codex Hook",
  "claude-history": "Claude Code", "cursor-history": "Cursor", git: "Git 提交历史",
};
const integrityLabels = {
  "invalid-timestamp": "时间戳无效", "missing-turn-stop": "缺少回合结束事件",
  "missing-tool-post": "缺少工具结束事件", "unmatched-tool-post": "工具结束事件缺少对应开始",
  "out-of-order-tool-event": "工具事件顺序异常", "negative-tool-interval": "工具区间时间倒置",
  "out-of-order-turn-event": "回合事件顺序异常",
};
const evidenceLabels = {
  "explicit-ticket": "明确工单关联", "planning-reference": "计划引用", branch: "分支关联",
  "merge-subject": "合并标题", "commit-subject": "提交标题", path: "文件路径线索", semantic: "语义线索",
};
const confidenceLabels = { high: "高", medium: "中", low: "低" };

export const reportHours = (value: number | null) => value === null ? "—" : `${(value / 3_600_000).toFixed(2)} 小时`;
const money = (cents: number | null) => cents === null ? "—" : `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const reportTime = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));

function CommitMessages({ messages, date }: { messages: ReportSnapshot["days"][number]["commitMessages"]; date: string }) {
  const [expanded, setExpanded] = useState(false);
  if (messages.length === 0) return <span className="text-zinc-400">—</span>;
  return <div>
    <ul id={`messages-${date}`} className="space-y-1 break-words">
      {(expanded ? messages : messages.slice(0, 3)).map((message, index) =>
        <li key={index}>{message.title}{message.count > 1 && <span className="ml-1 text-zinc-500">×{message.count}</span>}</li>,
      )}
    </ul>
    {messages.length > 3 && <button type="button" className="mt-2 rounded text-brand-700 underline focus-visible:outline-2 focus-visible:outline-brand-500"
      aria-expanded={expanded} aria-controls={`messages-${date}`} onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起" : `展开全部 ${messages.length} 条标题`}
    </button>}
  </div>;
}

export function ReportSnapshotView({ snapshot }: { snapshot: ReportSnapshot }) {
  const git = snapshot.sources.find((source) => source.source === "git");
  const estimate = snapshot.totals.commitEstimateMs;
  return <article className="space-y-6">
    <header>
      <h2 className="text-xl font-semibold">{snapshot.project.displayName} · {snapshot.period.month} 月度报告</h2>
      <p className="mt-1 break-words text-xs text-zinc-500">{snapshot.period.from} 至 {snapshot.period.to} · 上海时区 · schema {snapshot.schemaVersion} · {snapshot.algorithmVersion}</p>
    </header>
    <section aria-label="非核验提交节奏估算" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-semibold text-amber-900">提交节奏推测 · 非核验</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Metric label="推测总时长" value={reportHours(estimate)} />
        <Metric label="推测人天" value={estimate === null ? "—" : `${(estimate / 3_600_000 / snapshot.rate.hoursPerDay).toFixed(2)} 人天`} />
        <Metric label="估算费用（已保存金额）" value={money(snapshot.totals.estimatedCostCents)} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-amber-900">快照费率：{money(snapshot.rate.dayRateCents)} / 人天,{snapshot.rate.hoursPerDay} 小时 / 人天。相邻同 scope 提交间隔每段最多 1 小时；费用从精确时长计算,仅最终金额四舍五入至分。不是核验工时,也不包含人工登记工时。</p>
    </section>
    <section aria-label="已核验 AI 活动" className="rounded-xl border border-zinc-200 p-4">
      <h3 className="font-semibold">已核验 AI 活动（独立口径）</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active Interval · 完整回合并集" value={reportHours(snapshot.totals.activeMs)} />
        <Metric label="Run Interval · 工具运行并集" value={reportHours(snapshot.totals.runMs)} />
        <Metric label="并行 Active" value={reportHours(snapshot.totals.parallelActiveMs)} />
        <Metric label="并行 Run" value={reportHours(snapshot.totals.parallelRunMs)} />
      </div>
      <p className="mt-3 text-xs text-zinc-500">Active 与 Run 不相加,不等于人工投入；缺少完整事件边界显示“—”,已核验的零值显示 0.00 小时。</p>
    </section>
    <section aria-labelledby="daily-report-title">
      <h3 id="daily-report-title" className="mb-2 font-semibold">完整月份日表</h3>
      <p className="mb-2 text-xs text-zinc-500">窄屏可横向滚动。Git scope 是提交分组,不是实际 Feature。</p>
      <div className="overflow-x-auto rounded-xl border border-zinc-200" role="region" aria-label="月度每日报告,可横向滚动" tabIndex={0}>
        <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
          <thead className="bg-zinc-50"><tr>
            {["日期", "已核验活跃", "提交历史汇总", "当天 Commit Message", "提交节奏推测（非核验）", "无数据与覆盖情况"].map((title) => <th key={title} scope="col" className="border-b border-zinc-200 px-3 py-3 font-semibold">{title}</th>)}
          </tr></thead>
          <tbody>{snapshot.days.map((day) => <tr key={day.date} className="border-b border-zinc-100 align-top last:border-0">
            <th scope="row" className="whitespace-nowrap px-3 py-3 font-medium">{day.date}</th>
            <td className="whitespace-nowrap px-3 py-3"><div>Active {reportHours(day.activeMs)}</div><div className="mt-1 text-zinc-500">Run {reportHours(day.runMs)}</div></td>
            <td className="min-w-40 px-3 py-3"><div>{(!git || git.status === "unknown") && day.commitCount === 0 ? "—（Git 来源不可确认）" : `${day.commitCount} 次去重提交`}</div>
              {day.commitGroups.map((group, i) => <div key={i} className="mt-1 break-words text-zinc-500">scope / 分组：{group.label} · {group.commitCount} 次</div>)}
            </td>
            <td className="min-w-64 max-w-lg px-3 py-3"><CommitMessages messages={day.commitMessages} date={day.date} /></td>
            <td className="min-w-44 px-3 py-3"><div className="whitespace-nowrap font-medium">{reportHours(day.commitEstimateMs)}</div>
              {day.commitGroups.map((group, i) => <div key={i} className="mt-1 break-words text-zinc-500">{group.label}：{reportHours(group.estimatedMs)}</div>)}
            </td>
            <td className="min-w-52 px-3 py-3">{coverageLabels[day.coverage]}{(day.activeMs === null || day.runMs === null) && <p className="mt-1 text-zinc-500">没有足够完整事件边界支持对应核验时长</p>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section aria-label="按周 AI 活动汇总">
      <h3 className="mb-2 font-semibold">按周 AI 活动汇总（已保存,仅本月范围）</h3>
      <div className="overflow-x-auto rounded-xl border border-zinc-200"><table className="w-full text-left text-sm">
        <thead className="bg-zinc-50"><tr><th scope="col" className="p-3">ISO 周</th><th scope="col" className="p-3">Active</th><th scope="col" className="p-3">Run</th></tr></thead>
        <tbody>{snapshot.weekly.map((week) => <tr key={week.week} className="border-t border-zinc-100"><th scope="row" className="p-3 font-normal">{week.week}</th><td className="p-3">{reportHours(week.activeMs)}</td><td className="p-3">{reportHours(week.runMs)}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section aria-label="Feature 归因证据" className="rounded-xl border border-zinc-200 p-4">
      <h3 className="font-semibold">Feature Attribution Evidence / Confidence（已保存）</h3>
      <p className="mt-2 text-xs text-zinc-500">提交 scope 不冒充 Feature；线索或建议不是已核验的 Feature 时长。</p>
      {snapshot.featureAttributions.length === 0 ? <p className="mt-3 text-sm text-zinc-500">没有已保存的 Feature 归因证据,不主张 Feature 时长。</p> : <ul className="mt-3 space-y-2 text-sm">
        {snapshot.featureAttributions.map((item, index) => <li key={index}>{item.featureName} · {evidenceLabels[item.evidence]} · 置信度{confidenceLabels[item.confidence]} · {item.suggested ? "建议归因（未确认）" : "已记录归因"}</li>)}
      </ul>}
      {snapshot.featureTotalsUnavailableForRange && <p className="mt-3 text-sm text-amber-800">当前月份没有可用的 Feature 核验时长汇总；不能从提交分组推算。</p>}
      {!snapshot.featureTotalsUnavailableForRange && snapshot.featureIntervalTotals.map((item) => <p key={item.featureId} className="mt-3 text-sm">
        {snapshot.featureAttributions.find((evidence) => evidence.featureId === item.featureId)?.featureName ?? item.featureId}：Active {reportHours(item.activeMs)} · Run {reportHours(item.runMs)} · {item.evidenceCount} 条明确关联证据
      </p>)}
    </section>
    <section aria-label="来源与完整性" className="rounded-xl border border-zinc-200 p-4">
      <h3 className="font-semibold">来源与事件完整性</h3>
      <ul className="mt-3 space-y-2 text-sm">{snapshot.sources.map((source) => <li key={source.source}>
        {sourceLabels[source.source]}：{coverageLabels[source.status]} · 本月记录 {source.status === "unknown" ? "—" : source.eventCount}
      </li>)}
        {(["history", "hook", "claude-history", "cursor-history", "git"] as const)
          .filter((name) => !snapshot.sources.some((source) => source.source === name))
          .map((name) => <li key={name}>{sourceLabels[name]}：未知（快照未保存此来源的覆盖信息） · 本月记录 —</li>)}
      </ul>
      <p className="mt-3 text-sm text-zinc-500">来源未知可能是未配置、缺失或不可读；来源有记录也不表示所有事件都有完整边界。</p>
      {snapshot.integrity.length === 0 ? <p className="mt-3 text-sm text-zinc-500">已保存的完整性诊断没有异常项；不保证缺失来源已覆盖。</p> : <ul className="mt-3 space-y-1 text-sm text-amber-800">{snapshot.integrity.map((item) => <li key={item.reason}>{integrityLabels[item.reason]}：{item.count} 次；不补造核验区间。</li>)}</ul>}
      <div className="mt-4 border-t border-zinc-100 pt-3 text-sm">
        <h4 className="font-medium">无时间戳 Cursor 累计统计（非月度）</h4>
        <p className="mt-1 text-xs text-zinc-500">scope: {snapshot.cursorUndated.scope} · 无法归属本月,不增加任何时长。</p>
        <p className="mt-2">会话 {snapshot.cursorUndated.sessionCount} · 提示 {snapshot.cursorUndated.promptCount} · 完成回合 {snapshot.cursorUndated.completedTurnCount} · 缺少时间戳 {snapshot.cursorUndated.missingTimestampCount}</p>
      </div>
    </section>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;
}
