import { useEffect, useState } from "react";
import { useTableSort } from "@/components/Table";
import * as repo from "../dao/levels.repo";
import { toLevels } from "./levelRows";
import { nextRank, describeDeleteError, type GradeLevel } from "./skillScale";
import type { Level, Skill } from "../types";

// All Levels state, loads and writes (Admin L-D, BATCH_D_PLAN.md).
//
// ⚠ The caller's tenant is resolved INSIDE each insert's payload, after the
// validation and immediately before the write — exactly where the page did it
// (RISK 6). Do not hoist it into load(): a tenant read at mount would be one
// more request on every visit, and a failed one would surface at the wrong time.
// useTableSort lives here too: load() flips `loading`, which unmounts the table
// (it renders under `loading ? … :`), so a ui/-held sort would reset on every write.
export function useLevels() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Level | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Level | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState("");
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);

  // ── The tenant's grade scale (skill_grade_levels) ────────────────────────
  const [gradeScale, setGradeScale] = useState<GradeLevel[]>([]);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [newGrade, setNewGrade] = useState("");
  const [scaleBusy, setScaleBusy] = useState(false);
  const [scaleError, setScaleError] = useState<string | null>(null);

  useEffect(() => {
    load();
    loadScale();
  }, []);

  async function load() {
    setLoading(true);
    // RLS scopes this to the caller's own business, so no tenant filter here.
    const { data } = await repo.loadLevels();

    setLevels(toLevels(data));
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setLabel("");
    // Default to the end of the ladder — a new level is far more often the next
    // rung than the first one.
    setSortOrder(String((levels.at(-1)?.sort_order ?? 0) + 1));
    setNote("");
    setError(null);
  }

  function openEdit(l: Level) {
    setCreating(false);
    setEditing(l);
    setLabel(l.label);
    setSortOrder(String(l.sort_order));
    setNote(l.note ?? "");
    setError(null);
  }

  function close() {
    setCreating(false);
    setEditing(null);
    setError(null);
  }

  async function save() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("A level needs a name.");
      return;
    }
    // Check for empty BEFORE coercing: Number("") is 0, which has silently
    // saved a $0 wage rate and an invoice run day of 1 in this codebase.
    if (sortOrder.trim() === "" || !Number.isFinite(Number(sortOrder))) {
      setError("Order must be a number.");
      return;
    }

    setBusy(true);
    setError(null);
    const payload = { label: trimmed, sort_order: Number(sortOrder), note: note.trim() || null };

    const { error: err } = editing
      ? await repo.updateLevel(editing.id, payload)
      : await repo.insertLevel({
          ...payload,
          // The caller's own business. RLS refuses any other value anyway; this
          // is what makes the insert satisfy the WITH CHECK in the first place.
          tenant_id: (
            await repo.profileTenant((await repo.getAuthUser()).data.user?.id)
          ).data?.tenant_id,
        });

    setBusy(false);

    if (err) {
      setError(
        err.code === "23505"
          ? `You already have a level called "${trimmed}".`
          : "Could not save. Please try again."
      );
      return;
    }
    close();
    load();
  }

  async function remove(l: Level) {
    setBusy(true);
    setRemoveError(null);
    const { error: err } = await repo.deleteLevel(l.id);
    setBusy(false);
    if (err) {
      // Keep the dialog OPEN so the reason is visible — a level a child has
      // been graded against is refused by the database (FK 23503), and that is
      // the keep-records feature, not a fault.
      setRemoveError(describeDeleteError(err, "level"));
      return;
    }
    setRemoving(null);
    load();
  }

  // ── Grade scale (skill_grade_levels) ────────────────────────────────────────
  async function loadScale() {
    // RLS scopes this to the caller's own business.
    const { data } = await repo.loadGradeScale();
    setGradeScale((data ?? []) as GradeLevel[]);
  }

  async function addGrade() {
    const trimmed = newGrade.trim();
    if (!trimmed) return;
    setScaleBusy(true);
    setScaleError(null);
    const { error: err } = await repo.insertGrade({
      label: trimmed,
      rank: nextRank(gradeScale),
      // The caller's own business — RLS refuses any other value; this is what
      // satisfies the WITH CHECK (same pattern as the level insert).
      tenant_id: (
        await repo.profileTenant((await repo.getAuthUser()).data.user?.id)
      ).data?.tenant_id,
    });
    setScaleBusy(false);
    if (err) {
      setScaleError(
        err.code === "23505"
          ? `You already have a grade called "${trimmed}".`
          : "Could not add that grade."
      );
      return;
    }
    setNewGrade("");
    loadScale();
  }

  async function renameGrade(g: GradeLevel, label: string) {
    const trimmed = label.trim();
    if (!trimmed || trimmed === g.label) return;
    setScaleBusy(true);
    setScaleError(null);
    const { error: err } = await repo.renameGrade(g.id, trimmed);
    setScaleBusy(false);
    if (err) {
      setScaleError(
        err.code === "23505"
          ? `You already have a grade called "${trimmed}".`
          : "Could not rename that grade."
      );
      return;
    }
    loadScale();
  }

  async function removeGrade(g: GradeLevel) {
    setScaleBusy(true);
    setScaleError(null);
    const { error: err } = await repo.deleteGrade(g.id);
    setScaleBusy(false);
    if (err) {
      setScaleError(describeDeleteError(err, "grade"));
      return;
    }
    loadScale();
  }

  // ── Skills ────────────────────────────────────────────────────────────────
  async function addSkill(level: Level) {
    const trimmed = newSkill.trim();
    if (!trimmed) return;

    setSkillBusy(true);
    setSkillError(null);
    const { error: err } = await repo.insertSkill({
      level_id: level.id,
      label: trimmed,
      // Append to the end. A curriculum is written in teaching order, so a new
      // skill is far more often the next one than an insertion in the middle
      // — and the order can be nudged afterwards.
      sort_order: (level.skills.at(-1)?.sort_order ?? 0) + 1,
    });
    setSkillBusy(false);

    if (err) {
      setSkillError(
        err.code === "23505"
          ? `"${trimmed}" is already listed at this level.`
          : "Could not add that skill."
      );
      return;
    }
    setNewSkill("");
    load();
  }

  async function removeSkill(skill: Skill) {
    setSkillBusy(true);
    setSkillError(null);
    const { error: err } = await repo.deleteSkill(skill);
    setSkillBusy(false);
    if (err) {
      // 23503 = a child has been graded on this skill; the record is kept and
      // the delete is refused. Any other error is a generic failure.
      setSkillError(describeDeleteError(err, "skill"));
      return;
    }
    load();
  }

  // Swap sort_order with the neighbour. Two writes rather than a drag-and-drop
  // library: the lists are 3-6 items and reordering is rare once a curriculum
  // is entered.
  async function moveSkill(level: Level, index: number, delta: number) {
    const a = level.skills[index];
    const b = level.skills[index + delta];
    if (!a || !b) return;

    setSkillBusy(true);
    await repo.setSkillSortOrder(a.id, b.sort_order);
    await repo.setSkillSortOrder(b.id, a.sort_order);
    setSkillBusy(false);
    load();
  }

  // Defaults to `sort_order`, which is the order the ladder is already in — a
  // level ladder means something in sequence, so the first render must not
  // reshuffle it. Sorting by name is there to FIND a rung, not to reorder one:
  // the ladder's real order is edited through the Order field.
  const sort = useTableSort<Level>({
    key: "sort_order",
    accessors: { skills: (l) => l.skills.length },
  });
  const visible = sort.apply(levels);

  return {
    levels,
    loading,
    editing,
    creating,
    label,
    setLabel,
    sortOrder,
    setSortOrder,
    note,
    setNote,
    busy,
    error,
    removing,
    setRemoving,
    removeError,
    setRemoveError,
    expanded,
    setExpanded,
    newSkill,
    setNewSkill,
    skillBusy,
    skillError,
    gradeScale,
    scaleOpen,
    setScaleOpen,
    newGrade,
    setNewGrade,
    scaleBusy,
    scaleError,
    setScaleError,
    openCreate,
    openEdit,
    close,
    save,
    remove,
    addGrade,
    renameGrade,
    removeGrade,
    addSkill,
    removeSkill,
    moveSkill,
    sort,
    visible,
  };
}

export type LevelsState = ReturnType<typeof useLevels>;
