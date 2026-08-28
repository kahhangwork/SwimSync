"use client";

// This business's swimming-level ladder.
//
// Replaces the fixed beginner/intermediate/advanced enum, which was never
// populated and was never the right shape — a ladder is a business's own
// vocabulary ("Seahorse", "SwimSafer Level 3"), not a three-way split SwimSync
// chooses for everyone. Until now the CLASS NAME carried the level, which works
// for one coach with four classes and stops the moment anyone wants to track
// progress WITHIN a class.
//
// ORDER IS THE POINT. A ladder sorted alphabetically puts "Advanced" above
// "Beginner", which is why sort_order exists and why this page lets it be set
// rather than inferring it from the label.
//
// Levels are per business (RLS scopes every query here), and a student may only
// be given a level from their own business — enforced in the database, since no
// single-row policy can see across that reference.

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { describeLevelRemoval } from "@/lib/studentCounts";
import { nextRank, describeDeleteError, type GradeLevel } from "@/lib/skillScale";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type Skill = { id: string; label: string; sort_order: number };

type Level = {
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

export default function LevelsPage() {
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
    const { data } = await supabase
      .from("tenant_levels")
      .select("id, label, sort_order, note, students(id, is_active), tenant_level_skills(id, label, sort_order)")
      .order("sort_order")
      .order("label");

    setLevels(
      (data ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        sort_order: l.sort_order,
        note: l.note,
        // Read off the JOINED students, not off the level — the select is
        // `any`, so the wrong nesting level would typecheck and silently
        // report every level as empty.
        //
        // Split in JS, deliberately NOT with `students!inner(...)` and a
        // server-side filter: that would drop levels with no ACTIVE children out
        // of the result entirely, so a level held only by departed children
        // would VANISH from the ladder and read as deleted. The ladder is the
        // business's curriculum (PRD §7.15) — it must list every rung.
        student_count: (l.students ?? []).filter((s: any) => s.is_active).length,
        inactive_count: (l.students ?? []).filter((s: any) => !s.is_active).length,
        // Ordered here rather than in the query: PostgREST cannot order an
        // embedded resource, so sorting server-side would silently do nothing.
        skills: [...(l.tenant_level_skills ?? [])].sort(
          (a: Skill, b: Skill) =>
            a.sort_order - b.sort_order || a.label.localeCompare(b.label)
        ),
      }))
    );
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
      ? await supabase.from("tenant_levels").update(payload).eq("id", editing.id)
      : await supabase.from("tenant_levels").insert({
          ...payload,
          // The caller's own business. RLS refuses any other value anyway; this
          // is what makes the insert satisfy the WITH CHECK in the first place.
          tenant_id: (
            await supabase
              .from("profiles")
              .select("tenant_id")
              .eq("id", (await supabase.auth.getUser()).data.user?.id)
              .single()
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
    const { error: err } = await supabase.from("tenant_levels").delete().eq("id", l.id);
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
    const { data } = await supabase
      .from("skill_grade_levels")
      .select("id, rank, label")
      .order("rank");
    setGradeScale((data ?? []) as GradeLevel[]);
  }

  async function addGrade() {
    const trimmed = newGrade.trim();
    if (!trimmed) return;
    setScaleBusy(true);
    setScaleError(null);
    const { error: err } = await supabase.from("skill_grade_levels").insert({
      label: trimmed,
      rank: nextRank(gradeScale),
      // The caller's own business — RLS refuses any other value; this is what
      // satisfies the WITH CHECK (same pattern as the level insert).
      tenant_id: (
        await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", (await supabase.auth.getUser()).data.user?.id)
          .single()
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
    const { error: err } = await supabase
      .from("skill_grade_levels")
      .update({ label: trimmed })
      .eq("id", g.id);
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
    const { error: err } = await supabase
      .from("skill_grade_levels")
      .delete()
      .eq("id", g.id);
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
    const { error: err } = await supabase.from("tenant_level_skills").insert({
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
    const { error: err } = await supabase
      .from("tenant_level_skills")
      .delete()
      .eq("id", skill.id);
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
    await supabase.from("tenant_level_skills")
      .update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("tenant_level_skills")
      .update({ sort_order: a.sort_order }).eq("id", b.id);
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

  return (
    <div>
      <PageHeader
        title="Swimming Levels"
        subtitle="Your own level ladder. Students are placed on it from the Students page."
      />

      <div className="mb-4 flex gap-2">
        <Button onClick={openCreate}>Add level</Button>
        <Button variant="outline" onClick={() => { setScaleError(null); setScaleOpen(true); }}>
          Grading scale
        </Button>
      </div>

      {/* A one-line hint at what the scale is for, shown only once a scale
          exists (it always does — seeded per business). */}
      {gradeScale.length > 0 ? (
        <p className="mb-4 text-xs text-gray-500">
          Coaches grade each child&rsquo;s skills on your{" "}
          <span className="font-medium text-gray-700">
            {gradeScale.map((g) => g.label).join(" → ")}
          </span>{" "}
          scale. The top grade counts a skill as done.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : levels.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">No levels yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add the rungs you actually use — &ldquo;Seahorse&rdquo;,
            &ldquo;SwimSafer Level 1&rdquo;, whatever your business calls them.
            Until then a child&rsquo;s class name is the only signal of their level.
          </p>
        </div>
      ) : (
        <Table>
          {/* No <Tr> here — Thead emits its own. Wrapping these in one
              renders <tr> inside <tr>, which collapses all five headers into a
              single cell in column 1 and pushes every column out of line with
              the header naming it. Enforced by components/Table.test.tsx. */}
          <Thead>
            <Th sort={sort} sortKey="sort_order">Order</Th>
            <Th sort={sort} sortKey="label">Level</Th>
            <Th sort={sort} sortKey="skills">Skills</Th>
            <Th sort={sort} sortKey="student_count">Students</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {visible.map((l, li) => (
              <React.Fragment key={l.id}>
                <Tr>
                  <Td className="text-gray-500">{l.sort_order}</Td>
                  <Td className="font-medium text-gray-900">
                    {l.label}
                    {l.note && (
                      <div className="mt-0.5 text-xs font-normal italic text-gray-500">
                        {l.note}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <button
                      onClick={() =>
                        setExpanded(expanded === l.id ? null : l.id)
                      }
                      className="text-sm font-medium text-sky-600 hover:underline"
                    >
                      {l.skills.length === 0
                        ? "Add skills"
                        : `${l.skills.length} skill${
                            l.skills.length === 1 ? "" : "s"
                          }`}
                      {expanded === l.id ? " \u25be" : " \u25b8"}
                    </button>
                  </Td>
                  <Td className="text-gray-500">
                    {/* The number is ACTIVE children. A level can read 0 while
                        departed children still hold it, and the Remove dialog
                        will then say so — this title closes that gap on the page
                        itself, so the two numbers never look like they disagree.
                        On a <span> rather than a `title` prop on <Td>: widening
                        a shared table primitive for one cell's tooltip would put
                        the prop on all 22 tables. */}
                    <span
                      title={
                        l.inactive_count > 0
                          ? `${l.student_count} active. ${l.inactive_count} former student${
                              l.inactive_count === 1 ? "" : "s"
                            } still on this level.`
                          : undefined
                      }
                    >
                      {l.student_count}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => openEdit(l)}>
                        Edit
                      </Button>
                      <Button variant="outline" onClick={() => { setRemoveError(null); setRemoving(l); }}>
                        Remove
                      </Button>
                    </div>
                  </Td>
                </Tr>

                {expanded === l.id && (
                  <Tr>
                    <Td colSpan={5} className="bg-gray-50">
                      <div className="py-2">
                        <p className="mb-2 text-xs text-gray-500">
                          What is taught at this level, in teaching order. The
                          coach and the child&rsquo;s parent both see this.
                        </p>

                        {l.skills.length === 0 ? (
                          <p className="mb-3 text-sm text-gray-400">
                            No skills listed yet.
                          </p>
                        ) : (
                          <ol className="mb-3 space-y-1">
                            {l.skills.map((sk, i) => (
                              <li
                                key={sk.id}
                                className="flex items-center gap-2 text-sm text-gray-800"
                              >
                                <span className="w-5 text-right text-gray-400">
                                  {i + 1}.
                                </span>
                                <span className="flex-1">{sk.label}</span>
                                <button
                                  onClick={() => moveSkill(l, i, -1)}
                                  disabled={i === 0 || skillBusy}
                                  className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                  aria-label="Move up"
                                >
                                  &uarr;
                                </button>
                                <button
                                  onClick={() => moveSkill(l, i, 1)}
                                  disabled={i === l.skills.length - 1 || skillBusy}
                                  className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                  aria-label="Move down"
                                >
                                  &darr;
                                </button>
                                <button
                                  onClick={() => removeSkill(sk)}
                                  disabled={skillBusy}
                                  className="px-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                                  aria-label="Remove skill"
                                >
                                  &times;
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}

                        <div className="flex gap-2">
                          <input
                            value={expanded === l.id ? newSkill : ""}
                            onChange={(e) => setNewSkill(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addSkill(l);
                            }}
                            placeholder="Aeroplane Kick"
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                          />
                          <Button
                            onClick={() => addSkill(l)}
                            disabled={skillBusy || !newSkill.trim()}
                          >
                            Add skill
                          </Button>
                        </div>
                        {skillError && (
                          <p className="mt-2 text-sm text-red-600">{skillError}</p>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )}
              </React.Fragment>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? "Edit level" : "Add level"}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Level name
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Seahorse"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Order
            </label>
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Lowest first. This is what stops the ladder sorting alphabetically,
              which would put &ldquo;Advanced&rdquo; above &ldquo;Beginner&rdquo;.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Note <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Progress to B3 upon completing T4"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              For anything about the level that isn&rsquo;t a skill — usually a
              progression rule. Skills go in the list on the previous screen.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this level?"
      >
        <p className="text-sm text-gray-600">
          {/* Counts EVERYONE, not just the active — see Level.inactive_count. */}
          {removing
            ? describeLevelRemoval(removing.student_count, removing.inactive_count)
            : null}
        </p>
        {removeError && <p className="mt-3 text-sm text-red-600">{removeError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => removing && remove(removing)} disabled={busy} variant="danger">
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      </Modal>

      {/* ── Grade scale editor ──────────────────────────────────────────────
          Hosted here rather than on a new route, deliberately: same audience,
          same data family, and a new page would trip verify-platform-admin-
          scope.mjs's 24-page pin. Minimal by design — rename freely, add a
          grade; a grade a child holds cannot be deleted (the FK refuses, and
          removeGrade surfaces that as a friendly line). */}
      <Modal open={scaleOpen} onClose={() => setScaleOpen(false)} title="Grading scale">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The scale coaches grade each child&rsquo;s skills against, lowest
            first. The <span className="font-medium">top</span> grade counts a
            skill as done. Rename freely; a grade a child has been given
            can&rsquo;t be removed — their records are kept.
          </p>

          {gradeScale.length === 0 ? (
            <p className="text-sm text-gray-400">No grades yet.</p>
          ) : (
            <ol className="space-y-2">
              {gradeScale.map((g, i) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs text-gray-400">{i + 1}.</span>
                  {/* Rename on blur or Enter — a curriculum's grade names are
                      edited rarely, so an explicit save button is overkill. */}
                  <input
                    defaultValue={g.label}
                    onBlur={(e) => renameGrade(g, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    disabled={scaleBusy}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => removeGrade(g)}
                    disabled={scaleBusy}
                    className="px-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                    aria-label="Remove grade"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="flex gap-2">
            <input
              value={newGrade}
              onChange={(e) => setNewGrade(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addGrade();
              }}
              placeholder="Expert"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <Button onClick={addGrade} disabled={scaleBusy || !newGrade.trim()}>
              Add grade
            </Button>
          </div>

          {scaleError && <p className="text-sm text-red-600">{scaleError}</p>}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setScaleOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
