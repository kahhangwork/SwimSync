// The coach grade viewer's entity type (docs/refactor/BATCH_FGH_PLAN.md, app fence) —
// moved verbatim from app/(coach)/classes/[id]/grade.tsx.

export type StudentInfo = {
  full_name: string;
  tenant_id: string;
  level_label: string | null;
  level_note: string | null;
};
