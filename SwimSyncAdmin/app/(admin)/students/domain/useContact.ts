// Slice 8a — the parent's contact details, stored on the child's row. Stage 8
// of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// ⚠ THESE ARE THE PARENT'S DETAILS, STORED ON THE CHILD'S ROW. A child has no
// phone or email of their own anywhere in the model and must not get one. The
// three provisional_contact_* columns exist for the window BEFORE the adult
// who brought the child has an account.
//
// ⚠ TWO MODES, AND THE CLAIMED ONE IS READ-ONLY BY DESIGN. Once a parent has
// an account their real details live on `profiles`, which they maintain
// themselves in the app ((parent)/profile/contact.tsx). Offering a second
// editable copy here would be exactly the stale duplicate that `students.age`
// and `classes.price_per_lesson` were removed for. It is also not ours to
// write: parents are global, so profiles.tenant_id is NULL and
// is_tenant_admin(NULL) is hard-false — the database refuses it either way.

import { useRef, useState } from "react";
import { blankToNull } from "@/lib/sgPhone";
import * as repo from "../dao/students.repo";
import type { StudentRow } from "../types";

export type ContactParent = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export function useContact() {
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

    const row = data as any;
    const parents = (row.parent_students ?? [])
      .map((ps: any) => ps.parents)
      .filter(Boolean);
    const claimed = parents.length > 0;
    setContactClaimed(claimed);

    if (claimed) {
      // ⚠ READ OFF THE JOINED profiles ROW, NOT THE STUDENT. The select is
      // `any`, so the wrong nesting level typechecks and renders every field
      // blank (§7.28) — which reads as "this family gave us nothing" when they
      // gave us everything. The UI driver asserts the exact seeded strings.
      setContactParents(
        parents.map((p: any) => ({
          full_name: p.profiles?.full_name ?? null,
          email: p.profiles?.email ?? null,
          phone: p.profiles?.phone ?? null,
        }))
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
    // justification that is silently false. Nothing else in the product can
    // unlink a parent from a child except that flow's own undo (§7.47), so a
    // wrong link is expensive. Resolve the claim first.
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
