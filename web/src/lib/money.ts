// 外包计费:1200 元/人天,8h 为一人天
export const DAY_RATE_YUAN = 1200;
export const DAY_MINUTES = 8 * 60;

export function laborCostYuan(minutes: number): number {
  return Math.round((minutes / DAY_MINUTES) * DAY_RATE_YUAN);
}
