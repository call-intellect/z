export function parseNumericLoose(v: string): number | null {
  const s0 = v.replace(/[^\d.,-]/g, '');
  if (!s0) return null;
  const lastComma = s0.lastIndexOf(',');
  const lastDot = s0.lastIndexOf('.');
  let s: string;
  if (lastComma > lastDot) s = s0.replace(/\./g, '').replace(',', '.');
  else s = s0.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
