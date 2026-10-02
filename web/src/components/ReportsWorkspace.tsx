import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Button, MonthPicker } from "~/components/ui";
import { ReportSnapshotView, reportTime } from "~/components/ReportSnapshotView";
import { reportApi } from "~/lib/report-api";
import type { ReportRun } from "~/lib/report-api";
import type { ReportPageData, ReportSearch } from "~/lib/report-route";

const fieldClass = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const runLabels = { queued: "等待本机采集", running: "正在采集、计算并保存", succeeded: "报告已保存到数据库", failed: "生成失败,已有版本未被覆盖" };
const runErrors: Record<string, string> = {
  COLLECT_FAILED: "本机采集失败。请检查本机 Profile 和来源配置后重试。",
  SAVE_FAILED: "报告保存失败。请检查数据库连接后重试。",
  INTERRUPTED: "本机服务在完成前中断。请重新生成。",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "报告操作失败,请重试";

export function ReportsWorkspace({ data, search, navigate, refresh }: {
  data: ReportPageData; search: ReportSearch;
  navigate: (search: ReportSearch, replace?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const loading = useRouterState({ select: (state) => state.status === "pending" });
  const [busy, setBusy] = useState<"mapping" | "import" | "generate" | "json" | "html" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedTarget, setSavedTarget] = useState<{ id: string; profileId: string; month: string } | null>(null);
  const [run, setRun] = useState<ReportRun | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [pollError, setPollError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const [profileInput, setProfileInput] = useState(data.profileId ?? "");
  const [projectInput, setProjectInput] = useState("");
  const [displayInput, setDisplayInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const latest = useRef({ data, search, navigate, refresh });
  const navigationRevision = useRef(0);
  const runRevision = useRef(0);
  latest.current = { data, search, navigate, refresh };

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); lifetime.current = null; };
  }, []);

  function chooseReport(selection: ReportSearch) {
    navigationRevision.current++;
    return navigate(selection);
  }

  // Persist the initial current choice, but never replace an explicitly selected old version.
  useEffect(() => {
    if (!loading && !data.reportError && (data.profileId !== search.profileId || (!search.snapshotId && data.selected))) {
      void navigate({ ...search, profileId: data.profileId, snapshotId: data.selected?.id }, true);
    }
  }, [loading, data.profileId, data.selected?.id, data.reportError, search.profileId, search.snapshotId, search.month, navigate]);

  async function openSaved(id: string, profileId: string, month: string, revision: number) {
    if (revision !== navigationRevision.current) return;
    const current = latest.current;
    if (profileId !== current.data.profileId || month !== current.search.month ||
      !current.data.selected || current.data.selected.id === current.data.versions.currentId) {
      await current.navigate({ profileId, month, snapshotId: id });
    } else {
      // A user reading an old version keeps it; the new saved version has an explicit link.
      await current.refresh();
    }
  }

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        const value = await reportApi.run(runId!, controller.signal);
        if (controller.signal.aborted) return;
        setRun(value);
        setPollError("");
        if (value.status === "succeeded") {
          if (!value.snapshotId) throw new Error("运行成功但缺少已保存快照标识,请重新查询");
          setSavedTarget({ id: value.snapshotId, profileId: value.profileId, month: value.month });
          setNotice("生成完成,报告已保存到数据库。");
          await openSaved(value.snapshotId, value.profileId, value.month, runRevision.current);
        } else if (value.status !== "failed") {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setPollError(`${errorText(failure)}。可重试查询,此前已保存版本不受影响。`);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, pollRetry]);

  async function operate(kind: NonNullable<typeof busy>, action: (signal: AbortSignal) => Promise<void>) {
    if (busy || !lifetime.current) return;
    const controller = lifetime.current;
    setBusy(kind); setError(""); setNotice("");
    try { await action(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(errorText(failure)); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }

  function mapProfile(event: FormEvent) {
    event.preventDefault();
    void operate("mapping", async (signal) => {
      await reportApi.saveMapping(profileInput.trim(), { projectId: projectInput, displayName: displayInput.trim() }, signal);
      if (signal.aborted) return;
      setNotice("项目关联已保存。不会创建人工项目或任务,也不保存本机目录。");
      await navigate({ month: search.month, profileId: profileInput.trim() });
    });
  }

  function importFile() {
    if (!file) return;
    const revision = navigationRevision.current;
    void operate("import", async (signal) => {
      if (file.size > 2 * 1024 * 1024) throw new Error("报告 JSON 不能超过 2 MiB");
      let snapshot: unknown;
      try { snapshot = JSON.parse(await file.text()); } catch { throw new Error("文件不是有效的 JSON。请选择本机导出的报告 JSON,不支持 HTML 导入"); }
      if (signal.aborted) return;
      const result = await reportApi.import(snapshot, signal);
      if (signal.aborted) return;
      setSavedTarget(result);
      setNotice("导入完成,报告已保存到数据库；相同输入不会生成重复版本。");
      await openSaved(result.id, result.profileId, result.month, revision);
    });
  }

  function generate() {
    if (!data.profileId) return;
    runRevision.current = navigationRevision.current;
    void operate("generate", async (signal) => {
      const result = await reportApi.generate(data.profileId!, search.month, signal);
      if (signal.aborted) return;
      setRun(null); setRunId(result.runId); setPollError(""); setSavedTarget(null);
    });
  }

  const generating = Boolean(runId && (!run || run.status === "queued" || run.status === "running"));
  const disabled = busy !== null;
  const selected = data.selected;
  const selectedProfileAvailable = data.profiles.availableProfiles.some((profile) => profile.profileId === data.profileId);

  return <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-5">
    <div className="rounded-xl border border-zinc-200 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1 text-xs text-zinc-500">关联项目 / Profile
          <select aria-label="报告项目" className={`${fieldClass} mt-1`} value={data.profileId ?? ""}
            onChange={(event) => void chooseReport({ month: search.month, profileId: event.target.value || undefined })}>
            <option value="">选择已关联项目</option>
            {data.profiles.profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName} · {profile.profileId}</option>)}
          </select>
        </label>
        <div className="space-y-1"><p className="text-xs text-zinc-500">报告月份（上海时区）</p>
          <MonthPicker ariaLabel="报告月份" value={search.month} onChange={(month) => void chooseReport({ profileId: data.profileId, month })} />
        </div>
        <Button variant="secondary" isDisabled={loading} onPress={() => void refresh()}>刷新报告与连接</Button>
        <Button isDisabled={disabled || generating || !data.capabilities?.generate || !selectedProfileAvailable} onPress={generate}>{busy === "generate" ? "正在创建运行…" : generating ? "生成中…" : run?.status === "failed" ? "重试生成" : "生成报告"}</Button>
      </div>
      {data.capabilities && <p role="status" className="mt-3 break-words text-sm text-zinc-500">
        {data.capabilities.generationMode === "offline"
          ? "本机采集服务离线。保持已授权的本机工时速记服务运行后,刷新连接状态即可直接生成。无需执行 CLI 或导入 JSON；已有报告仍可查看和下载。"
          : data.capabilities.generationMode === "connected"
            ? "已连接你的本机采集服务。点击生成将自动采集、计算并保存到数据库,无需执行 CLI 或手动导入。生成期间请保持电脑和采集服务在线。"
            : "本机采集服务已就绪。点击生成将自动采集、计算并保存到数据库,线上登录同一账号即可查看。"}
      </p>}
      {data.capabilities?.generate && data.profileId && !selectedProfileAvailable && <p className="mt-2 text-sm text-amber-700">已连接的采集服务尚未登记此 Profile。请在已授权电脑登记该 Profile,重启本机采集服务后刷新连接状态。</p>}
    </div>

    <details className="rounded-xl border border-zinc-200 p-4" open={data.profiles.profiles.length === 0}>
      <summary className="cursor-pointer text-sm font-semibold">登记 / 更新人工项目与 Profile 的显式关联</summary>
      <p className="mt-2 text-xs text-zinc-500">使用稳定 ID,不根据项目名称猜测。一个人工项目最多关联一个 Profile。人工项目须先在“项目”页创建；不上传本机路径。</p>
      <form onSubmit={mapProfile} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-zinc-500">现有人工项目
          <select required aria-label="映射人工项目" className={`${fieldClass} mt-1`} value={projectInput} onChange={(event) => setProjectInput(event.target.value)}>
            <option value="">请选择项目</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.archived ? "（已归档）" : ""} · {project.id}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-500">Profile 稳定标识
          <input required aria-label="Profile 标识" pattern="[a-z][a-z0-9_-]*" list="local-report-profiles" className={`${fieldClass} mt-1`} value={profileInput}
            onChange={(event) => { setProfileInput(event.target.value); const profile = data.profiles.availableProfiles.find((item) => item.profileId === event.target.value); if (profile) setDisplayInput(profile.displayName); }} placeholder="例如 my-project" />
          <datalist id="local-report-profiles">{data.profiles.availableProfiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName}</option>)}</datalist>
        </label>
        <label className="text-xs text-zinc-500">报告展示名称
          <input required maxLength={1000} aria-label="报告展示名称" className={`${fieldClass} mt-1`} value={displayInput} onChange={(event) => setDisplayInput(event.target.value)} placeholder="例如 客户项目" />
        </label>
        <Button type="submit" className="self-end" isDisabled={disabled || !data.capabilities || !projectInput || !profileInput.trim() || !displayInput.trim()}>{busy === "mapping" ? "正在保存关联…" : "保存关联"}</Button>
      </form>
      {data.profiles.availableProfiles.length > 0 && <p className="mt-2 text-xs text-zinc-500">本机可用 Profile：{data.profiles.availableProfiles.map((profile) => `${profile.displayName} (${profile.profileId})`).join("、")}。可从标识输入框的建议列表选择。</p>}
      {data.profiles.profiles.length > 0 && <ul className="mt-3 space-y-1 text-xs text-zinc-500">{data.profiles.profiles.map((profile) => <li key={profile.profileId} className="flex flex-wrap items-center gap-2">
        {profile.displayName} · {profile.profileId} → {data.projects.find((project) => project.id === profile.projectId)?.name ?? "人工项目"} ({profile.projectId})
        <button type="button" className="rounded text-brand-700 underline focus-visible:outline-2" onClick={() => { setProfileInput(profile.profileId); setProjectInput(profile.projectId); setDisplayInput(profile.displayName); }}>编辑关联</button>
      </li>)}</ul>}
    </details>

    <details aria-label="导入结构化报告" className="rounded-xl border border-zinc-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold">手动导入 JSON（备份迁移,可选）</summary>
      <p className="mt-1 text-xs text-zinc-500">文件内的 Profile 必须已关联你的人工项目。仅接受版本化脱敏快照（最多 2 MiB）,不接受 HTML；导入不会写入人工工时。</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input aria-label="报告 JSON 文件" type="file" accept=".json,application/json" className="max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-zinc-700" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <Button isDisabled={disabled || !file || !data.capabilities || data.profiles.profiles.length === 0} onPress={importFile}>{busy === "import" ? "正在导入并保存…" : "导入并保存"}</Button>
      </div>
    </details>

    {loading && <p role="status" className="text-sm text-zinc-500">正在加载所选报告…</p>}
    {(error || data.reportError) && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || data.reportError}<Button variant="secondary" className="ml-3" onPress={() => void refresh()}>重试查询</Button></div>}
    {notice && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">{notice}</p>}
    {runId && <section aria-label="报告生成运行状态" className="rounded-xl border border-zinc-200 p-4 text-sm">
      <p role="status" className="font-medium">{run ? runLabels[run.status] : "正在查询生成运行…"}</p>
      <p className="mt-1 text-xs text-zinc-500">运行 {runId}{run && ` · 创建 ${reportTime(run.createdAt)}`}{run?.startedAt && ` · 开始 ${reportTime(run.startedAt)}`}{run?.finishedAt && ` · 完成 ${reportTime(run.finishedAt)}`}</p>
      {run?.status === "failed" && <p role="alert" className="mt-2 text-red-700">{run.errorCode ? runErrors[run.errorCode] ?? "生成失败,请重试。" : "生成失败,请重试。"}</p>}
      {pollError && <div role="alert" className="mt-2 text-red-700">{pollError}<Button className="ml-2" variant="secondary" onPress={() => setPollRetry((value) => value + 1)}>重试状态查询</Button></div>}
    </section>}
    {savedTarget && savedTarget.id !== selected?.id && <Button variant="tertiary" onPress={() => void chooseReport({ month: savedTarget.month, profileId: savedTarget.profileId, snapshotId: savedTarget.id })}>查看刚保存的版本</Button>}

    {data.versions.versions.length > 0 && <section aria-label="报告历史版本" className="rounded-xl border border-zinc-200 p-4">
      <label className="text-sm font-semibold">历史版本
        <select aria-label="报告历史版本" className={`${fieldClass} mt-2`} value={search.snapshotId ?? selected?.id ?? ""} onChange={(event) => void chooseReport({ month: search.month, profileId: data.profileId, snapshotId: event.target.value })}>
          {search.snapshotId && !data.versions.versions.some((version) => version.id === search.snapshotId) && <option value={search.snapshotId}>所选版本不可用</option>}
          {data.versions.versions.map((version) => <option key={version.id} value={version.id}>
            {version.id === data.versions.currentId ? "当前成功版本 · " : "历史版本 · "}{reportTime(version.savedAt)} · {version.source === "generated" ? "本机生成" : "JSON 导入"} · schema {version.schemaVersion} · {version.algorithmVersion} · {version.id}
          </option>)}
        </select>
      </label>
      {selected && <p className="mt-2 text-xs text-zinc-500">生成时间 {reportTime(selected.generatedAt)} · 保存时间 {reportTime(selected.savedAt)} · 来源 {selected.source === "generated" ? "本机生成" : "JSON 导入"} · {selected.id === data.versions.currentId ? "当前成功版本" : "历史不可变版本"}</p>}
    </section>}

    {selected ? <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["json", "html"] as const).map((format) => <Button key={format} variant="secondary" isDisabled={disabled} onPress={() => void operate(format, (signal) => reportApi.download(selected, format, signal))}>{busy === format ? "正在下载…" : `下载已保存 ${format.toUpperCase()}`}</Button>)}
      </div>
      <ReportSnapshotView key={selected.id} snapshot={selected.snapshot} />
    </div> : !data.reportError && <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
      {data.profileId ? `${search.month} 尚无已保存报告。${data.capabilities?.generate ? "点击生成报告即可自动采集并保存。" : "连接已授权的本机采集服务后即可直接生成。"}无数据不代表零工时。` : "请先将现有人工项目与 Project Profile 显式关联,再查询或生成月度报告。"}
    </div>}
  </div>;
}
