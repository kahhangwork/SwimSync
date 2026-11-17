// Group rows by a key, preserving input order within each group. Moved verbatim
// out of core.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B5).

export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
