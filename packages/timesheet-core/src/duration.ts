// 时长输入文法(原型验证):1.5 | 90m | 1:30 | 1h30 → 分钟
// 返回:null=空串;NaN=有内容但格式非法;正整数=解析成功
export function parseDurationInput(text: unknown): number | null {
  const t = String(text ?? "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(parseFloat(m[1]!) * 60);
  if ((m = t.match(/^(\d+(?:\.\d+)?)h$/))) return Math.round(parseFloat(m[1]!) * 60);
  if ((m = t.match(/^(\d+)m$/))) return parseInt(m[1]!, 10);
  if ((m = t.match(/^(\d+):([0-5]?\d)$/)))
    return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
  if ((m = t.match(/^(\d+)h(\d+)?$/)))
    return parseInt(m[1]!, 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  return NaN;
}

export const MAX_MINUTES_PER_DAY = 24 * 60;

// 分钟 → 展示文本:"1.5h" / "7h" / "0.75h"
export function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 100) / 100}h`;
}
