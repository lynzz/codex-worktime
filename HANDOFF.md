# Codex Worktime Handoff

> 状态：需求拷问中，尚未批准实现  
> 交接日期：2026-08-22（Asia/Shanghai）  
> 目标目录：`/Users/lzz/github/codex-worktime`

## 1. 目标

开发一个独立的本地工具，统计指定项目中 Codex 的可验证使用时长，并按最终交付功能汇总，帮助外包项目复盘和形成可审计的客户报告。

当前首个项目是 EQA Platform。它在本机有三个固定工作目录。Git commit 只用于识别最终交付功能和提供交付证据，**不得用于反推 AI 使用时长**。

建议的数据流：

```text
Codex 历史会话 / 生命周期 Hooks
        -> 本地事件存储
        -> 时段计算、去重和项目归一
        -> commit/票据辅助功能归类
        -> 独立 HTML 报告
```

## 2. 已确认的成功标准

1. 能把三个 EQA 工作目录归一为同一个项目。
2. 能从保留的 Codex 历史会话回算已有投入；缺失日志必须显示为“无数据”，不能算作 0 小时。
3. 能通过 Codex 生命周期 Hooks 持续采集未来事件，不要求用户每次手工启动计时器。
4. 分开展示以下口径，不能合并成一个虚假的精确数字：
   - 可验证的 AI 活跃时长；
   - AI 运行/等待时长；
   - 推算的人工投入区间（算法与是否纳入第一版仍待确认）。
5. 并行会话、fork、resume、compact 和三个目录之间的重叠时段必须去重。
6. commit 历史只负责生成最终功能、交付记录和功能演进证据。
7. 第一版是本地采集器/分析器加独立 HTML，不接入 EQA Platform 正式前后端。
8. 原始对话、prompt、工具参数和工具输出不得进入统计库或报告。
9. 每项时长和功能归因都应保留数据来源与可信度，允许发现模糊项而不是强行平摊。

## 3. 已完成的事实探索

### 3.1 目标项目状态

- `/Users/lzz/github/codex-worktime` 当前为空目录。
- 尚未初始化 Git。
- 尚无 `AGENTS.md`、技术栈、依赖或代码。
- 本轮没有修改 EQA Platform 代码。

### 3.2 EQA Git 历史

探索时的仓库统计：

- 全历史约 2,465 个 commit。
- 其中约 345 个 merge commit。
- author date 范围约为 2026-07-01 至 2026-08-21。
- 约 2,460 条 subject 符合 Conventional Commit 或 Merge 风格，可辅助分类，但 scope 是技术域，不等同于最终功能。
- 约 217 条记录的 author timestamp 与 committer timestamp 不同。
- Git 只记录提交时间，不记录工作开始、结束或 AI 活跃时长。

历史作者存在多身份，需要后续确认当前用户对应哪些 Git identity：

- `zhizhonglin`
- `林志忠`
- `zhengheng`
- `郑恒`

### 3.3 三个所谓 worktree 的实际状态

三个目录实际上是三个**不共享 Git common-dir 的独立 Git 工作副本**，不能依赖 linked-worktree 元数据自动聚合：

| 目录 | 分支 | 探索时 HEAD |
| --- | --- | --- |
| `/Users/lzz/lianlai/eqa-platform-worktree1` | `feat/score` | `327bf577...` |
| `/Users/lzz/lianlai/eqa-platform-worktree2` | `feat/data-chart` | `47f7d473...` |
| `/Users/lzz/lianlai/eqa-platform-worktree3` | `feat/workhours-stats` | `42d186466...` |

因此项目识别应由显式配置维护，例如一个 project profile 包含多个 root，而不是依赖 `git worktree list`。

### 3.4 Codex 历史数据

本机历史会话位于 Codex 的 `sessions` 与 `archived_sessions` 数据目录。JSONL 中存在：

- top-level `timestamp`；
- `session_meta.payload.cwd`；
- `turn_context.payload.cwd`；
- session/thread id；
- parent/fork lineage；
- Git 和模型相关元数据；
- 对话及工具调用正文（敏感，禁止进入统计输出）。

按 `session_meta.payload.cwd` 探索到的 EQA 记录数：

| 工作目录 | session metadata 记录数 | turn context 记录数 |
| --- | ---: | ---: |
| worktree1 | 370 | 399 |
| worktree2 | 1,100 | 1,294 |
| worktree3 | 96 | 112 |
| 旧的 `eqa-platform` 根目录 | 12 | 12 |

这些是 metadata 记录数，不是严格去重后的 thread 数；fork、恢复或其他生命周期事件可能重复。

本机全部 Codex 历史探索到约 2,768 个 active session 文件、55 个 archived session 文件，metadata 时间范围约为 2026-02-07 至 2026-08-21。后续必须重新计算 EQA 专属的去重 thread 数和有效覆盖区间。

### 3.5 Codex 扩展能力

官方 Codex Hooks 支持生命周期事件，包括：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse` / `PostToolUse`
- `Stop`
- `SessionEnd`

公共输入包含 `session_id`、`transcript_path`、`cwd`、事件名和模型；turn 级事件还包含 `turn_id`。Hooks 可以把事件写入自定义日志/分析程序。

注意：`SessionEnd` 可能在会话不再打开且空闲约 30 分钟后才触发，因此 `SessionStart -> SessionEnd` 的墙钟跨度不能直接当作活跃时长。

Skill 适合封装重复执行的导入、分析和报告脚本，但不是常驻后台计时器。推荐由 Hooks 采集、CLI 分析、Skill 编排。

## 4. 功能归因的现有证据

EQA 仓库中可利用的归因证据按推荐优先级排列：

1. `.scratch/<feature>/PRD.md`、`issues/`、`EXECUTION.md`、`HANDOFF.md` 中显式记录的 commit hash（高可信）。
2. merge subject 和 `feat/<feature>` 分支名（中高可信，但包含同步/merge 噪声）。
3. Conventional Commit 的 scope、subject 和改动路径（中低可信）。
4. 语义推断或路径聚类（低可信，只能作为待确认建议）。
5. 人工确认覆盖自动结果，并保留原始推断用于审计。

已知风险：

- 一个阶段 commit 可能覆盖多张 ticket。
- 一张 ticket 也可能横跨多个 commit 和多个子工程。
- merge commit 不能视作独立功能。
- 当前各副本的主分支基线可能不同。
- `.scratch`、Codex Taskboard 和 Linear 不是完整、统一的结构化映射。

## 5. 建议的项目边界

建议另建本地工具，而不是写入 EQA Platform：

```text
codex-worktime/
├── hooks/          # Codex 生命周期事件采集
├── importer/       # 历史 JSONL 导入
├── analyzer/       # 时段计算、重叠去重、功能归因
├── report/         # 独立 HTML 报告
├── skill/          # 刷新和查看报告的 Codex Skill
└── projects.*      # 本机项目 roots 配置；是否提交需再决定
```

建议本地数据库放在用户级应用数据目录，不放入被分析的 Git 仓库。数据库只保存最小统计字段，例如：

- 项目标识；
- 事件时间戳和事件类型；
- cwd 匹配后的 project root id；
- session/turn 的不可逆映射或本地内部 id；
- 计算后的时间区间；
- 功能归因、来源和可信度。

## 6. 未完成与未决决策

需求拷问尚未结束，**下一会话不得直接开始编码**。先逐项确认：

1. 实现技术栈：Python、TypeScript、Rust 或其他。
2. 交付形态：普通 CLI + Skill，还是个人 Codex plugin（可同时打包 Hook 和 Skill）。
3. “AI 活跃时长”的精确算法和 idle gap 上限。
4. “AI 运行/等待时长”的起止事件和异常中断处理。
5. 多个并行会话的时间是取并集，还是同时保留机器并行总时长。
6. fork/resume/compact 的 lineage 去重规则。
7. 历史数据是否纳入旧的 `/Users/lzz/lianlai/eqa-platform` 根目录记录。
8. 是否统计 subagent 时间；若统计，是并行机器时长还是折叠进主会话墙钟时长。
9. 是否采集 token；token 只表示模型消耗，不能换算人工时长。
10. 是否加入人工补录，以覆盖读需求、沟通、验收和未使用 Codex 的手工工作。
11. 内部报告与客户报告展示哪些字段；客户是否直接看到 AI 使用时长。
12. 当前用户对应哪些 Git identity。
13. 功能分类的人工纠正如何保存、版本化和撤销。
14. 报告的日期范围、时区、日/周/功能聚合方式。
15. 本地数据库保存周期、备份方式与删除能力。
16. 三个 EQA root 是写入个人配置，还是提供可迁移的 profile 模板。

## 7. 约束与隐私边界

- 不读取 Git commit 间隔来推算工时。
- 不把一次 session 的完整跨度直接算作活跃时长。
- 不把缺失日志解释为 0 小时。
- 不在 EQA Platform 仓库写入个人会话、个人配置或工时数据库。
- 不在统计库和报告中保存或输出：
  - prompt 与 assistant 回复；
  - 命令参数和命令输出；
  - API key、token 或其他密钥；
  - 完整 transcript；
  - Git remote；
  - 面向客户报告中的完整本机路径。
- 内部数据也应遵循最小化原则，原始 JSONL 只读、按需扫描。
- 项目当前没有自己的 `AGENTS.md`。创建后应补充本项目规则，再实施。
- EQA Platform 的 `AGENTS.md` 只约束对 EQA 仓库的读取和未来可能的变更；本工具不得复制其业务实现代码。

## 8. 建议的下一步

1. 在新会话中以本文为上下文继续需求拷问，关闭第 6 节所有影响第一版的决策。
2. 形成一份简短规格，冻结数据模型、计时公式、隐私策略和报告字段。
3. 初始化独立 Git 仓库并添加最小 `AGENTS.md`（需要用户明确确认后执行）。
4. 做一个 tracer bullet：
   - 只读导入少量脱敏 JSONL fixture；
   - 按 project roots 过滤；
   - 计算一个确定的 turn 时段；
   - 输出一个最小 HTML 汇总；
   - 全流程不保存正文。
5. 用三个 EQA 目录的真实历史做只读验证，再加入 Hooks 增量采集。
6. 最后才增加 commit 到功能的归因和客户视图。

## 9. 验证要求

技术栈尚未确定，因此目前没有可执行的 `mvn test` 或 `cargo check`。实施后至少需要：

- importer fixture 测试：相同 JSONL 重复导入必须幂等；
- project-root 测试：三个 EQA roots 必须归一成同一 project id；
- lineage 测试：fork/resume/compact 不重复累计；
- interval 测试：重叠会话取并集的结果确定且可解释；
- privacy 测试：数据库和 HTML 不出现 prompt、assistant 正文、工具输出、Git remote 或完整本机路径；
- timezone 测试：UTC 事件在 Asia/Shanghai 的日界线正确；
- report smoke test：生成的 HTML 可离线打开，空数据和缺失历史有明确状态；
- 用小型脱敏 fixture 验证后，才允许对真实 `sessions` 数据目录执行只读导入。

## 10. 术语

本独立项目尚无 `CONTEXT.md`。建议后续固定以下术语：

- **Project Profile**：一个逻辑项目及其多个本机工作目录。
- **Session**：Codex 主会话；不等同于连续工作时段。
- **Turn**：从用户提交到 Codex 停止本轮工作的事件序列。
- **Active Interval**：根据已确认规则计算的有效活动时间段。
- **Run Interval**：模型或工具执行产生的运行/等待时间段。
- **Human-declared Interval**：用户人工补录且与实测 AI 时段分离的时间段。
- **Feature**：面向交付的最终功能，不等同于 commit scope。
- **Attribution Evidence**：将时段或 commit 归入功能的证据。
- **Confidence**：功能归因的高/中/低可信等级。

EQA 业务 glossary 当前不影响本工具核心数据模型；只有生成最终功能名称时才需要读取 EQA 上下文。

## 11. 延后修复

Repair ledger: none
