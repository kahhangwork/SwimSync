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

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type Level = {
  id: string;
  label: string;
  sort_order: number;
  student_count: number;
};

export default function LevelsPage() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Level | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Level | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    // RLS scopes this to the caller's own business, so no tenant filter here.
    const { data } = await supabase
      .from("tenant_levels")
      .select("id, label, sort_order, students(id)")
      .order("sort_order")
      .order("label");

    setLevels(
      (data ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        sort_order: l.sort_order,
        // Read off the JOINED students, not off the level — the select is
        // `any`, so the wrong nesting level would typecheck and silently
        // report every level as empty.
        student_count: (l.students ?? []).length,
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
    setError(null);
  }

  function openEdit(l: Level) {
    setCreating(false);
    setEditing(l);
    setLabel(l.label);
    setSortOrder(String(l.sort_order));
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
    const payload = { label: trimmed, sort_order: Number(sortOrder) };

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
    const { error: err } = await supabase.from("tenant_levels").delete().eq("id", l.id);
    setBusy(false);
    setRemoving(null);
    if (err) {
      setError("Could not remove that level.");
      return;
    }
    load();
  }

  return (
    <div>
      <PageHeader
        title="Swimming Levels"
        subtitle="Your own level ladder. Students are placed on it from the Students page."
      />

      <div className="mb-4">
        <Button onClick={openCreate}>Add level</Button>
      </div>

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
          <Thead>
            <Tr>
              <Th>Order</Th>
              <Th>Level</Th>
              <Th>Students</Th>
              <Th>&nbsp;</Th>
            </Tr>
          </Thead>
          <Tbody>
            {levels.map((l) => (
              <Tr key={l.id}>
                <Td className="text-gray-500">{l.sort_order}</Td>
                <Td className="font-medium text-gray-900">{l.label}</Td>
                <Td className="text-gray-500">{l.student_count}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => openEdit(l)}>
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => setRemoving(l)}>
                      Remove
                    </Button>
                  </div>
                </Td>
              </Tr>
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
          {removing?.student_count
            ? `${removing.student_count} student${
                removing.student_count === 1 ? "" : "s"
              } will simply have no level. Nobody is removed from a class, and no history changes.`
            : "No students are on this level."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => removing && remove(removing)} disabled={busy} variant="danger">
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
