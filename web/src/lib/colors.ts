// 项目固定色:按 id 哈希到稳定色相,色点/色条全局一致
export function projectHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function projectColor(id: string): string {
  return `hsl(${projectHue(id)}, 62%, 45%)`;
}
