export type Skill = { id: string; label: string; sort_order: number };

export type Level = {
  id: string;
  label: string;
  sort_order: number;
  note: string | null;
  /** ACTIVE children on this level — what the Students column shows. */
  student_count: number;
  /**
   * Children who have LEFT but still hold this level.
   *
   * Tracked separately because the column and the removal warning answer
   * different questions. `students.level_id` is ON DELETE SET NULL, so removing
   * a level blanks it for everyone pointing at it — active or not — and a
   * warning built from `student_count` alone would tell the admin "No students
   * are on this level" about a level still held by departed children. They
   * delete it, those children lose a level nothing records, and reactivating one
   * later cannot restore it. See describeLevelRemoval() in lib/studentCounts.ts.
   */
  inactive_count: number;
  skills: Skill[];
};
