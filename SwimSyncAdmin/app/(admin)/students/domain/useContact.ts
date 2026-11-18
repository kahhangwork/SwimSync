// Slice 8a — the parent's contact details, stored on the child's row. Stage 8
// of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// ⚠ THESE ARE THE PARENT'S DETAILS, STORED ON THE CHILD'S ROW. A child has no
// phone or email of their own anywhere in the model and must not get one. The
// three provisional_contact_* columns exist for the window BEFORE the adult
// who brought the child has an account.
//
// ⚠ TWO MODES. Unclaimed: the three provisional_contact_* columns on the child.
// Claimed: the parent's OWN `profiles` row — never a second copy on the child,
// which would be the stale duplicate `students.age` was removed for.
//
// The claimed mode was READ-ONLY until 2026-11-18. User feedback: "once a parent
// is linked to a child, if key information is entered wrongly, we may need to
// delete the whole child record and recreate it." The user's decision: the admin
// edits the parent's NAME + PHONE through set_parent_contact() — not the email,
// which is the parent's login — and can UNLINK a wrong parent through
// unlink_parent_from_student(), which refuses once that parent has been billed
// for this child. A parent is global: the corrected name and phone show in every
// business the family belongs to. Both RPCs are the boundary; nothing here writes
// `profiles` or `parent_students` directly.

import { useRef, useState } from "react";
import { blankToNull } from "@/lib/sgPhone";
import * as repo from "../dao/students.repo";
import * as rpc from "../dao/students.rpc";
import type { ContactParentRow, ContactSelectRow } from "../dao/students.repo";
import type { StudentRow } from "../types";

export type ContactParent = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

/** The admin's in-progress edit of one linked parent, keyed by parents.id. */
export type ParentEdit = { name: string; phone: string };

export function useContact(reload: () => Promise<void>) {
  const [contactFor, setContactFor] = useState<StudentRow | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactClaimed, setContactClaimed] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  // PLURAL. parent_students is many-to-many because a child has two parents,
  // and "show me the mother's number, not the father's" is the ordinary reason
  // an admin opens this. Taking [0] would answer with whichever row came back
  // first.
  const [contactParents, setContactParents] = useState<ContactParent[]>([]);
  const [parentEdits, setParentEdits] = useState<Record<string, ParentEdit>>({});
  // One parent at a time: the busy/error/confirm state belongs to the card it names.
  const [parentBusy, setParentBusy] = useState<string | null>(null);
  const [parentError, setParentError] = useState<{ id: string; message: string } | null>(null);
  const [parentSaved, setParentSaved] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [pendingClaims, setPendingClaims] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  // ⚠ NO FORM IS RENDERED WHILE THIS IS SET. Without it, a failed load left the
  // three inputs on screen holding the ""s they were reset to — so an admin who
  // did not read the error and pressed Save would ERASE that child's real
  // contact details, including the phone that is their only match signal.
  const [contactLoadFailed, setContactLoadFailed] = useState(false);
  // Which student the in-flight read is for. Open A, close, open B and A's
  // response can land last — putting A's phone number under B's name.
  const contactRequestFor = useRef<string | null>(null);

  async function openContact(student: StudentRow) {
    setContactFor(student);
    setContactLoading(true);
    setContactLoadFailed(false);
    setContactClaimed(false);
    setContactError(null);
    setContactParents([]);
    setParentEdits({});
    setParentBusy(null);
    setParentError(null);
    setParentSaved(null);
    setConfirmUnlink(null);
    setPendingClaims(0);
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    contactRequestFor.current = student.id;

    // ⚠ FETCHED HERE, NOT ADDED TO load()'s SELECT. That one query feeds this
    // entire page; a join-shape or RLS mistake in it returns null and renders
    // the admin's primary screen EMPTY rather than merely missing a field. A
    // failure in this query costs one modal.
    //
    // It also means the mode below is decided by a FRESH read, so a child
    // claimed while the list sat on screen opens read-only rather than
    // offering an edit that no longer makes sense.
    const { data, error } = await repo.fetchStudentContact(student.id);

    // A newer open has overtaken this one — drop the response on the floor
    // rather than painting it under another child's name.
    if (contactRequestFor.current !== student.id) return;

    if (error || !data) {
      setContactLoading(false);
      setContactLoadFailed(true);
      setContactError("Could not load this child's contact details.");
      return;
    }

    const row: ContactSelectRow = data;
    const parents = (row.parent_students ?? [])
      .map((ps) => ps.parents)
      .filter(Boolean) as ContactParentRow[]; // census: ui-cast (Wave 8) — `.filter(Boolean)` drops the RLS-hidden parents; TS does not narrow through it
    const claimed = parents.length > 0;
    setContactClaimed(claimed);

    if (claimed) {
      // ⚠ READ OFF THE JOINED profiles ROW, NOT THE STUDENT. The select is
      // `any`, so the wrong nesting level typechecks and renders every field
      // blank (§7.28) — which reads as "this family gave us nothing" when they
      // gave us everything. The UI driver asserts the exact seeded strings.
      const shown = parents.map((p) => ({
        id: p.id,
        full_name: p.profiles?.full_name ?? null,
        email: p.profiles?.email ?? null,
        phone: p.profiles?.phone ?? null,
      }));
      setContactParents(shown);
      setParentEdits(
        Object.fromEntries(shown.map((p) => [p.id, { name: p.full_name ?? "", phone: p.phone ?? "" }]))
      );
      setContactLoading(false);
      return;
    }

    setContactName(row.provisional_contact_name ?? "");
    setContactPhone(row.provisional_contact_phone ?? "");
    setContactEmail(row.provisional_contact_email ?? "");

    // ⚠ A PENDING CLAIM FREEZES THESE FIELDS, AND THAT IS THE POINT.
    // student_claims.match_reason is SNAPSHOTTED at claim time by design
    // (20260726000100) — the same rule as invoice_items.student_name. Editing
    // the phone underneath a pending claim leaves the Claims queue asserting
    // "their registered phone matches the contact number on this child" when it
    // no longer does, and the admin then approves a parent–child link on a
    // justification that is silently false. A wrong link can be unlinked
    // (unlinkParent) only until that parent is billed for the child, so it
    // stays expensive. Resolve the claim first.
    const { count, error: claimError } = await repo.countPendingClaims(student.id);

    if (contactRequestFor.current !== student.id) return;

    // ⚠ FAILS CLOSED, AND MUST. This is the whole guard: if we cannot find out
    // whether a claim is pending, the safe answer is "assume one is". Reading a
    // failed count as zero would silently unlock the fields in exactly the
    // situation the lock exists for.
    if (claimError || count === null) {
      setContactLoading(false);
      setContactLoadFailed(true);
      setContactError(
        "Could not check whether a parent is claiming this child, so editing is locked. Reopen to try again."
      );
      return;
    }

    setPendingClaims(count);
    setContactLoading(false);
  }

  async function handleSaveContact() {
    if (!contactFor) return;
    setContactBusy(true);
    setContactError(null);

    // ⚠ AN EXPLICIT THREE-KEY PAYLOAD. Never spread a row object into
    // .update(): a stray full_name or date_of_birth silently rewrites a child's
    // identity or trips students_identity_uniq with an error the admin cannot
    // act on. (tenant_id would be caught by pin_student_tenant(); the others
    // would not be.) The SANCTIONED way to change full_name is rename_student()
    // (the Rename action) — never add it to this payload.
    //
    // blankToNull mirrors the creation path's NULLIF(trim(...), '') so a
    // cleared field becomes NULL, not '' — see lib/sgPhone.ts.
    const { error } = await repo.updateStudentContact(contactFor.id, {
      provisional_contact_name: blankToNull(contactName),
      provisional_contact_phone: blankToNull(contactPhone),
      provisional_contact_email: blankToNull(contactEmail),
    });

    setContactBusy(false);
    if (error) {
      setContactError(`Could not save the contact details. ${error.message}`);
      return;
    }
    // Deliberately NO load(). Every other write on this page refetches because
    // it changes something the table shows; these three columns are shown
    // nowhere in it — not in the Parent column (which reads profiles through
    // parent_students), not in the duplicate detector, not in any filter. A
    // refetch here would re-run the students, attendance and package queries to
    // repaint identical rows.
    setContactFor(null);
  }

  function setParentField(parentId: string, field: keyof ParentEdit, value: string) {
    setParentEdits((e) => ({ ...e, [parentId]: { ...e[parentId], [field]: value } }));
    setParentSaved(null);
  }

  async function saveParent(parentId: string) {
    const edit = parentEdits[parentId];
    if (!edit) return;
    if (edit.name.trim() === "") {
      setParentError({ id: parentId, message: "Enter the parent's name." });
      return;
    }
    setParentBusy(parentId);
    setParentError(null);
    setParentSaved(null);
    const { error } = await rpc.setParentContact(parentId, edit.name.trim(), blankToNull(edit.phone));
    setParentBusy(null);
    if (error) {
      // The RPC's refusals (a pending claim, a blank name) are written for the admin — surfaced verbatim.
      setParentError({ id: parentId, message: error.message });
      return;
    }
    setContactParents((ps) =>
      ps.map((p) => (p.id === parentId ? { ...p, full_name: edit.name.trim(), phone: blankToNull(edit.phone) } : p))
    );
    setParentSaved(parentId);
    // The Parent column shows this name, so the table is now stale.
    await reload();
  }

  async function unlinkParent(parentId: string) {
    const student = contactFor;
    if (!student) return;
    setParentBusy(parentId);
    setParentError(null);
    const { error } = await rpc.unlinkParentFromStudent(parentId, student.id);
    setParentBusy(null);
    setConfirmUnlink(null);
    if (error) {
      setParentError({ id: parentId, message: error.message });
      return;
    }
    await reload();
    // Re-read: with the last parent gone the child is unclaimed again, and the
    // modal must switch to the editable provisional details — from a FRESH read.
    await openContact(student);
  }

  return {
    contactFor,
    contactLoading,
    contactClaimed,
    contactName,
    setContactName,
    contactPhone,
    setContactPhone,
    contactEmail,
    setContactEmail,
    contactParents,
    parentEdits,
    setParentField,
    parentBusy,
    parentError,
    parentSaved,
    confirmUnlink,
    setConfirmUnlink,
    saveParent,
    unlinkParent,
    pendingClaims,
    contactBusy,
    contactError,
    contactLoadFailed,
    openContact,
    close: () => setContactFor(null),
    handleSaveContact,
  };
}

export type ContactState = ReturnType<typeof useContact>;
