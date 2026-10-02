export const reportTemplate = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ displayName }} — Codex Worktime</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #162033; background: #edf2f9; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2rem 1rem 4rem; background: radial-gradient(circle at top right, #dbeafe, transparent 32rem), #edf2f9; }
      main { margin: 0 auto; max-width: 72rem; }
      .hero { padding: 2.5rem; border-radius: 1.5rem; background: linear-gradient(135deg, #102a43, #1e4976); color: #f8fbff; box-shadow: 0 1.5rem 3rem rgba(22, 32, 51, .18); }
      .eyebrow { margin: 0 0 .5rem; color: #b9d5f3; font-size: .78rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.4rem); letter-spacing: -.04em; }
      h2 { margin: 0 0 1rem; font-size: 1.15rem; letter-spacing: -.015em; }
      h3 { margin: 1.5rem 0 .65rem; font-size: .9rem; color: #4a5b72; }
      .hero-copy { max-width: 42rem; margin: 1rem 0 0; color: #d8eafa; }
      .status { display: inline-flex; margin: 1.35rem 0 0; padding: .42rem .72rem; border-radius: 999px; background: rgba(255,255,255,.13); color: #fff; font-size: .85rem; font-weight: 750; }
      .report-range { margin: .65rem 0 0; color: #d8eafa; font-size: .9rem; }
      .estimate-overview { display: grid; grid-template-columns: 1.35fr repeat(2, 1fr); gap: 1px; margin: 1.25rem 0; overflow: hidden; border: 1px solid #c6d9ee; border-radius: 1rem; background: #c6d9ee; box-shadow: 0 .7rem 1.7rem rgba(31, 62, 93, .08); }
      .estimate-overview > div { padding: 1.2rem 1.3rem; background: #f8fbff; }
      .estimate-overview > div:first-child { background: #e7f1ff; }
      .estimate-label { display: block; color: #28557f; font-size: .76rem; font-weight: 800; letter-spacing: .07em; }
      .estimate-value { display: block; margin-top: .45rem; color: #102a43; font-size: clamp(1.35rem, 3vw, 2rem); font-weight: 850; letter-spacing: -.045em; }
      .estimate-note { display: block; margin-top: .35rem; color: #60708a; font-size: .82rem; line-height: 1.4; }
      .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 1.25rem 0; }
      .metric { min-height: 8.75rem; padding: 1.25rem; border: 1px solid #dce6f2; border-radius: 1rem; background: #fff; box-shadow: 0 .5rem 1.5rem rgba(31, 62, 93, .06); }
      .metric-label { display: block; color: #60708a; font-size: .78rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
      .metric-value { display: block; margin-top: .55rem; color: #102a43; font-size: clamp(1.45rem, 3vw, 2.1rem); font-weight: 800; letter-spacing: -.045em; }
      .metric-note { margin: .45rem 0 0; color: #60708a; font-size: .84rem; line-height: 1.45; }
      .panel { margin-top: 1.25rem; padding: 1.4rem; border: 1px solid #dce6f2; border-radius: 1rem; background: rgba(255,255,255,.96); box-shadow: 0 .5rem 1.5rem rgba(31, 62, 93, .05); }
      .panel-note { margin: -.35rem 0 1rem; color: #60708a; font-size: .9rem; line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; border: 1px solid #e3ebf5; border-radius: .8rem; }
      th, td { padding: .78rem .85rem; border-bottom: 1px solid #e7eef7; text-align: left; vertical-align: top; font-size: .88rem; }
      th { color: #51637c; background: #f6f9fd; font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      .number { color: #102a43; font-variant-numeric: tabular-nums; font-weight: 750; }
      .tag { display: inline-block; padding: .18rem .45rem; border-radius: 999px; background: #e8f1fb; color: #28557f; font-size: .76rem; font-weight: 700; }
      .tag-low { background: #fff3d5; color: #805b00; }
      .tag-high { background: #e4f7ea; color: #166534; }
      .muted { color: #60708a; }
      .table-scroll { overflow-x: auto; }
      .daily-table { min-width: 66rem; }
      .commit-messages { min-width: 16rem; max-width: 24rem; overflow-wrap: anywhere; }
      .commit-messages ul { margin: 0; padding-left: 1.1rem; }
      .commit-messages li + li { margin-top: .4rem; }
      .commit-messages details { margin-top: .6rem; }
      .commit-messages details ul { margin-top: .6rem; }
      details { margin-top: 1rem; }
      summary { cursor: pointer; color: #28557f; font-weight: 750; }
      .provenance { word-break: break-all; color: #60708a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
      @media (max-width: 40rem) { body { padding: 1rem .75rem 2rem; } .hero, .panel { padding: 1.15rem; } .estimate-overview, .metric-grid { grid-template-columns: 1fr; } th, td { padding: .65rem; } .hide-small { display: none; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero"><p class="eyebrow">Codex Worktime · {{ viewLabel }}</p><h1>{{ displayName }}</h1><p class="hero-copy">{{ summary }}</p><p class="status">{{ statusLabel }}</p>{% if dateRangeLabel %}<p class="report-range">{{ dateRangeLabel }} (Asia/Shanghai)</p>{% endif %}</header>
      {% if view === "internal" and commitEstimateTotalMinutes %}<section class="estimate-overview" aria-label="提交节奏推测总工时与费用"><div><span class="estimate-label">推测总工时（非核验）</span><strong class="estimate-value">{{ commitEstimateTotalHours }} 小时</strong><span class="estimate-note">约 {{ commitEstimateTotalDays }} 人天（8 小时 / 人天）</span></div><div><span class="estimate-label">推测费用</span><strong class="estimate-value">{{ commitEstimateTotalCost }}</strong><span class="estimate-note">按 ¥1,200 / 人天估算</span></div><div><span class="estimate-label">估算口径</span><strong class="estimate-value">提交节奏</strong><span class="estimate-note">不是已核验 AI 或人工工时</span></div></section>{% endif %}
      <section class="metric-grid" aria-label="已核验指标">
        <article class="metric"><span class="metric-label">活跃区间</span><strong class="metric-value">{% if activeTotalLabel %}{{ activeTotalLabel }}{% else %}{{ accounting.active.wallClockMinutes }} 分钟{% endif %}</strong><p class="metric-note">已核验的墙钟时间并集{% if view === "internal" %}；{% if parallelActiveLabel %}{{ parallelActiveLabel }}{% else %}{{ accounting.active.parallelMachineMinutes }} 分钟{% endif %}并行机器时间{% endif %}。</p></article>
        <article class="metric"><span class="metric-label">运行区间</span><strong class="metric-value">{% if runTotalLabel %}{{ runTotalLabel }}{% else %}{{ accounting.run.wallClockMinutes }} 分钟{% endif %}</strong><p class="metric-note">仅统计可观察的工具执行或等待。</p></article>
        <article class="metric"><span class="metric-label">数据覆盖</span><strong class="metric-value">{{ coverageSummary.available }} 天可用</strong><p class="metric-note">{{ coverageSummary.unknown }} 天未知 · {{ coverageSummary.noData }} 天无数据；两者都不代表零工时。</p></article>
      </section>
      <section class="panel"><h2>已核验数据 · 汇总</h2><p class="panel-note">活跃区间与运行区间是两个独立、由事件边界确定的指标；本报告不包含推算的人类工时。</p>
        <table class="summary-table"><thead><tr><th>指标</th><th>已核验值</th><th>说明</th></tr></thead><tbody>
          <tr><td>活跃区间</td><td class="number">{% if activeTotalLabel %}{{ activeTotalLabel }}{% else %}{{ accounting.active.wallClockMinutes }} 分钟{% endif %}</td><td>由完整的 UserPromptSubmit → Stop 区间构成。</td></tr>
          <tr><td>运行区间</td><td class="number">{% if runTotalLabel %}{{ runTotalLabel }}{% else %}{{ accounting.run.wallClockMinutes }} 分钟{% endif %}</td><td>由完整的 PreToolUse → PostToolUse 区间构成。</td></tr>
          {% if view === "internal" %}<tr><td>采集来源</td><td class="number">{{ sourceSummary }}</td><td>仅保留时间、项目目录和生命周期元数据；不保留对话正文。</td></tr>{% endif %}
          <tr><td>数据覆盖</td><td class="number">{{ coverageSummary.available }} 天可用 / {{ coverageSummary.unknown }} 天未知 / {{ coverageSummary.noData }} 天无数据</td><td>未知或无数据都不代表零工时。</td></tr>
        </tbody></table>{% if view === "internal" and cursorUndatedLabel %}<p class="panel-note">Cursor 无法定月累计：{{ cursorUndatedLabel }}；不是本月数量，不据此主张月内工时。</p>{% endif %}</section>
      <section class="panel"><h2>{% if view === "internal" %}已核验区间、提交节奏与数据覆盖{% else %}已核验区间与数据覆盖{% endif %}</h2>
        <h3>{% if view === "internal" %}按日活跃、提交与覆盖情况{% else %}按日活跃与覆盖情况{% endif %}（Asia/Shanghai）</h3>{% if view === "internal" %}<p class="panel-note">提交节奏推测只累计相邻且同一 scope 的提交间隔，每段最多 1 小时；它不是已核验 AI 或人工工时。</p>{% endif %}
        <div class="table-scroll" tabindex="0" role="region" aria-label="按日统计表"><table class="detail-table daily-table"><thead><tr><th>日期</th><th>已核验活跃</th>{% if view === "internal" %}<th>提交历史汇总</th><th>当天 Commit Message</th><th>提交节奏推测（非核验）</th>{% endif %}<th>无数据与覆盖情况</th></tr></thead><tbody>
        {% for entry in dailyRows %}<tr{% if entry.coverageLabel %} aria-label="{{ entry.date }}: {{ entry.coverageLabel }}"{% endif %}>
          <td>{{ entry.date }}</td><td class="number">{{ entry.activeLabel }}</td>
          {% if view === "internal" %}<td>{% if entry.commitCount %}<strong>{{ entry.commitCount }} 个提交</strong><br><span class="muted">{{ entry.commitSummary }}</span>{% else %}<span class="muted">—</span>{% endif %}</td>{% endif %}
          {% if view === "internal" %}<td class="commit-messages">{% if entry.commitMessages.length %}<ul>{% for message in entry.commitMessages %}{% if loop.index <= 3 %}<li>{{ message }}</li>{% endif %}{% endfor %}</ul>{% if entry.commitMessages.length > 3 %}<details><summary>展开其余 {{ entry.commitMessages.length - 3 }} 条提交信息</summary><ul>{% for message in entry.commitMessages %}{% if loop.index > 3 %}<li>{{ message }}</li>{% endif %}{% endfor %}</ul></details>{% endif %}{% else %}<span class="muted">—</span>{% endif %}</td>
          <td>{% if entry.commitEstimateMinutes %}<strong class="number">{{ entry.commitEstimateHours }} 小时</strong><br><span class="muted">{{ entry.commitEstimateSummary }}</span>{% else %}<span class="muted">—</span>{% endif %}</td>{% endif %}
          <td>{{ entry.coverageLabel or "无记录（不代表零工时）" }}</td>
        </tr>{% else %}<tr><td colspan="{% if view === \"internal\" %}6{% else %}3{% endif %}" class="muted">本周期没有已核验的活跃区间、提交记录或覆盖记录。</td></tr>{% endfor %}</tbody></table></div>
        <h3>按周活跃区间（Asia/Shanghai）</h3><table class="detail-table"><thead><tr><th>周</th><th>{{ weeklyUnit or "分钟" }}</th></tr></thead><tbody>{% for entry in accounting.active.weekly %}<tr><td>{{ entry.week }}</td><td class="number">{{ entry.minutes }}</td></tr>{% else %}<tr><td colspan="2" class="muted">本周期没有已核验的活跃区间。</td></tr>{% endfor %}</tbody></table>
      </section>
      <section class="panel"><h2>推断的交付证据 · 功能归因与已核验分钟</h2><p class="panel-note">Git 只提供交付证据。功能只有在审阅证据将其关联到已核验区间时才会获得分钟数；commit 时间戳不会产生已核验工时。</p>
        <table class="detail-table"><thead><tr><th>功能</th><th>证据 / 可信度</th><th>已核验活跃</th><th>已核验运行</th>{% if view === "internal" %}<th>证据链接</th>{% endif %}</tr></thead><tbody>{% for row in featureRows %}<tr><td><strong>{{ row.name }}</strong>{% if row.suggested %}<br><span class="tag tag-low">低可信度建议</span>{% endif %}</td><td><span class="tag tag-{{ row.confidence }}">{{ row.evidence }}</span> <span class="muted">{{ row.confidenceLabel }}可信度</span>{% if view === "internal" and row.commitId %}<br><span class="provenance">{{ row.commitId }}</span>{% endif %}</td><td class="number">{{ row.activeLabel }}</td><td class="number">{{ row.runLabel }}</td>{% if view === "internal" %}<td>{{ row.evidenceCount }}</td>{% endif %}</tr>{% else %}<tr><td colspan="5" class="muted">未提供推断的功能归因，因此不主张低可信度归因。</td></tr>{% endfor %}</tbody></table>
        {% if featureTotalsUnavailableForRange %}<p class="panel-note">未提供该报告范围内的功能区间关联证据，因此不主张功能时长。</p>{% endif %}
      </section>
      {% if view === "internal" and (warnings.length or legacyUnscopedWarningCount) %}<section class="panel"><h2>审计明细</h2>{% if warnings.length %}<p class="panel-note">{{ warnings.length }} 条数据质量警告。</p><details><summary>查看规范化警告标识</summary><ul>{% for warning in warnings %}<li>{{ warning.reason }} <span class="provenance">{{ warning.eventHash }}</span></li>{% endfor %}</ul></details>{% endif %}{% if legacyUnscopedWarningCount %}<p class="panel-note">{{ legacyUnscopedWarningCount }} 条全局旧警告无法归入 Project Profile。</p>{% endif %}</section>{% endif %}
    </main>
  </body>
</html>`;
