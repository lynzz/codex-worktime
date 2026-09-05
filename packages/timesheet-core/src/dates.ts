// 纯本地日历日(无时区换算):YYYY-MM-DD 字符串为中心
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDays(key: string, days: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

const DOW_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function dayOfWeekCN(key: string): string {
  return DOW_CN[(fromDateKey(key).getDay() + 6) % 7]!;
}

// 周一为一周之始
export function startOfWeek(key: string): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateKey(d);
}

export function isWeekend(key: string): boolean {
  const g = fromDateKey(key).getDay();
  return g === 0 || g === 6;
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

// 月历矩阵:以周一为首列的 42 天(6 行),非本月日期为空串
export function monthDays(anchor: string): string[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const key = addDays(gridStart, i);
    return sameMonth(key, anchor) ? key : "";
  });
}

export function monthStart(anchor: string): string {
  return `${anchor.slice(0, 7)}-01`;
}

export function nextMonthFirst(anchor: string): string {
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(y!, m!, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
