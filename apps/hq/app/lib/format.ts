export function fmtInt(s: string | null | undefined): string {
  if (s == null) return '—';
  const n = Number(s);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}
