// Rendering an audit_log row on the Change History page.
//
// old_value / new_value are full `to_jsonb(OLD/NEW)` row snapshots, so the screen
// DIFFS them — the dispute this page exists for is "what did the number used to
// be", not "here is the whole row". A create shows the new values; a delete shows
// what was removed; an update shows only the fields that actually changed.

export type ChangeKind = "created" | "updated" | "deleted" | "unknown";
export type FieldChange = { field: string; from: unknown; to: unknown };
export type AuditDiff = { kind: ChangeKind; changes: FieldChange[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Human string for one snapshot value: primitives as-is, objects/arrays as JSON,
 *  null/absent as an em dash. */
export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // to_jsonb of the same row type keeps key order stable, so a structural
  // compare via JSON is sufficient for these snapshots.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Diff two row snapshots into the fields that changed. */
export function diffSnapshots(oldVal: unknown, newVal: unknown): AuditDiff {
  const oldObj = isRecord(oldVal) ? oldVal : null;
  const newObj = isRecord(newVal) ? newVal : null;

  if (!oldObj && newObj) {
    return {
      kind: "created",
      changes: Object.keys(newObj)
        .sort()
        .map((f) => ({ field: f, from: undefined, to: newObj[f] })),
    };
  }
  if (oldObj && !newObj) {
    return {
      kind: "deleted",
      changes: Object.keys(oldObj)
        .sort()
        .map((f) => ({ field: f, from: oldObj[f], to: undefined })),
    };
  }
  if (oldObj && newObj) {
    const fields = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    const changes: FieldChange[] = [];
    for (const f of [...fields].sort()) {
      if (!sameValue(oldObj[f], newObj[f])) {
        changes.push({ field: f, from: oldObj[f], to: newObj[f] });
      }
    }
    return { kind: "updated", changes };
  }
  return { kind: "unknown", changes: [] };
}

/**
 * ⚠ RISK 5 — never label a real person "system". Every audit_log row has a
 * non-null actor_id (a no-JWT backend write returns early and inserts no row,
 * §7.120), so "system" is a defensive fallback that should not occur. A non-null
 * actor whose profile the tenant admin cannot see (e.g. a platform admin acting
 * inside the tenant) resolves to null NAME, and MUST render as an unknown user —
 * calling their action "system" would be an audit-integrity failure.
 */
export function actorLabel(actorId: string | null, name: string | null): string {
  if (!actorId) return "system";
  if (name && name.trim()) return name;
  return `unknown user (${actorId.slice(0, 8)}…)`;
}
