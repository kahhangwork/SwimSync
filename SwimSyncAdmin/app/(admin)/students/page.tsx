"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { formatActiveStudents } from "@/lib/studentCounts";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import {
  removeFromClass,
  setStudentsActive,
  familyActiveChildren,
  type FamilyChild,
} from "@/lib/studentStatus";
import { findDuplicatePairs, type DupPair } from "@/lib/duplicateStudents";
import { checkSgPhone, checkEmail, blankToNull } from "@/lib/sgPhone";
import { ContactHint } from "@/components/ContactHint";
import {
  coverageByStudent,
  isRunningLow,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";

type StudentRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  level_id: string | null;
  level_label: string | null;
  assignment_status: string;
  is_active: boolean;
  inactivated_at: string | null;
  parent_id: string | null;
  parent_name: string;
  class_title: string | null;
  coach_name: string | null;
  /** Attendance rows. Decides which of a duplicate pair must survive a merge. */
  lessons: number;
};

const STATUS_FILTERS = ["All", "Assigned", "Unassigned", "Inactive"];

// A child added by a coach before their parent registered. Derived from the
// ABSENCE of a parent_students row rather than a stored flag — the join table
// is the fact, and a flag beside it would only ever go stale.
const isUnclaimed = (s: { parent_id: string | null }) => s.parent_id === null;

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [pending, setPending] = useState<{
    student: StudentRow;
    mode: "remove" | "inactive";
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Siblings are READ before anything is written, so the admin confirms a named
  // set rather than a count that could change underneath them — and the set
  // they confirm is exactly what gets written.
  const [family, setFamily] = useState<FamilyChild[]>([]);
  const [takeSiblings, setTakeSiblings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [merging, setMerging] = useState<DupPair | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  /**
   * Fold the emptied duplicate into the row holding the history.
   *
   * All the safety lives in merge_students(): it refuses when both rows carry
   * attendance, when the direction is wrong, when money is already documented
   * against the duplicate, and when an unknown cascading foreign key has
   * appeared that it has not been taught to move. So this handler does not
   * re-check any of that — it surfaces the refusal verbatim, because those
   * messages are written for the admin to act on.
   */
  async function doMerge(pair: DupPair) {
    setMergeBusy(true);
    setMergeError(null);
    const { error } = await supabase.rpc("merge_students", {
      p_survivor_id: pair.survivor.id,
      p_duplicate_id: pair.duplicate.id,
    });
    setMergeBusy(false);
    if (error) {
      setMergeError(error.message);
      return;
    }
    setMerging(null);
    await load();
  }

  async function openInactive(student: StudentRow) {
    setTakeSiblings(false);
    setFamily([]);
    setPending({ student, mode: "inactive" });
    const { children } = await familyActiveChildren(supabase, student.id);
    setFamily(children);
  }

  const siblings = family.filter((c) => !c.is_self);
  // True when this action leaves the family with no active children here — the
  // point at which the family itself becomes inactive. Not a second question:
  // it is a consequence, so the modal states it rather than asking.
  const lastActive =
    family.length > 0 && (siblings.length === 0 || takeSiblings);

  async function handleStatusChange(
    student: StudentRow,
    mode: "remove" | "inactive"
  ) {
    setBusyId(student.id);
    setActionError(null);
    const ids =
      mode === "inactive" && takeSiblings
        ? family.map((c) => c.student_id)
        : [student.id];
    const { error } =
      mode === "inactive"
        ? await setStudentsActive(supabase, ids, false)
        : await removeFromClass(supabase, student.id);
    setBusyId(null);
    setPending(null);
    if (error) {
      setActionError(`Could not update ${student.full_name}: ${error}`);
      return;
    }
    await load();
  }

  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);
  const [savingLevelFor, setSavingLevelFor] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

  // ── "Running low" package filter ──────────────────────────────────────────
  // Families whose LIVE package balance (stored minus attended-but-uninvoiced
  // draws — package_live_balances(), the single derivation, never recomputed
  // here) is at or below the business's own threshold. The threshold is
  // per-tenant (tenants.low_package_lessons): what counts as "running low" is
  // the business's call, not a constant SwimSync picks for everyone.
  // Families with NO package are never "running low" — they are ad-hoc.
  const [lowOnly, setLowOnly] = useState(false);
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  // ── Add a student whose parent has not registered ─────────────────────────
  // The other half of PRD §7.17: the coach's walk-in form handles a TRIAL (one
  // lesson, marked on the spot), and this handles the ONGOING case — a child
  // who is already attending weekly while their parent takes their time
  // signing up. Both go through add_unclaimed_student(); only the enrolment
  // lifecycle differs.
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDob, setAddDob] = useState("");
  const [addClassId, setAddClassId] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [classOptions, setClassOptions] = useState<
    { id: string; title: string }[]
  >([]);
  const [inviting, setInviting] = useState<StudentRow | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  // Separate from the message, because the modal's ACTIONS change once the
  // invite has gone: re-pressing a primary "Send invite" is how an admin
  // double-sends, or worse, believes they have re-sent when they have not.
  const [inviteSent, setInviteSent] = useState(false);
  const [threshold, setThreshold] = useState("2");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );

  async function loadPackages() {
    const { data: userRes } = await supabase.auth.getUser();
    const { data: prof } = await supabase
      .from("profiles")
      // !tenant_id disambiguates: tenants also references profiles via
      // owner_profile_id (20260806000100), so a bare embed is refused.
      .select("tenant_id, tenants!tenant_id(low_package_lessons)")
      .eq("id", userRes.user?.id)
      .single();
    setTenantId((prof as any)?.tenant_id ?? null);
    const stored = (prof as any)?.tenants?.low_package_lessons;
    if (stored !== null && stored !== undefined) setThreshold(String(stored));

    // Per-child verdict, category- and expiry-aware, computed in SQL. The old
    // code summed package_live_balances() by parent here, which said "10 left"
    // beside a child whose class the package could never pay for, and counted
    // date-expired packages too.
    const { data: cov } = await supabase.rpc("student_package_coverage");
    setCovMap(coverageByStudent(cov ?? []));
  }

  async function saveThreshold(value: string) {
    setThreshold(value);
    // Empty BEFORE coercing (§7.22): an empty field must not save 0.
    if (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0)
      return;
    if (!tenantId) return;
    await supabase
      .from("tenants")
      .update({ low_package_lessons: Number(value) })
      .eq("id", tenantId);
  }

  useEffect(() => {
    load();
    loadLevels();
    loadPackages();
    loadClasses();
  }, []);

  async function loadLevels() {
    // RLS scopes this to the caller's own business. Ordered by sort_order, not
    // by label — a ladder sorted alphabetically puts "Advanced" above
    // "Beginner", which is why sort_order exists at all.
    const { data } = await supabase
      .from("tenant_levels")
      .select("id, label")
      .order("sort_order")
      .order("label");
    setLevels(data ?? []);
  }

  async function setLevel(student: StudentRow, levelId: string | null) {
    setSavingLevelFor(student.id);
    setLevelError(null);
    const { error } = await supabase
      .from("students")
      .update({ level_id: levelId })
      .eq("id", student.id);
    setSavingLevelFor(null);

    if (error) {
      // 23514 is the database refusing a level from another business. Not
      // reachable from this picker, which only lists our own — but if it ever
      // fires, saying "try again" would invite a retry that cannot succeed.
      setLevelError(
        error.code === "23514"
          ? "That level belongs to a different business."
          : `Could not update ${student.full_name}'s level.`
      );
      return;
    }
    load();
  }

  async function loadClasses() {
    // RLS already scopes a tenant_admin to their own business's classes.
    const { data } = await supabase
      .from("classes")
      .select("id, title")
      .eq("is_active", true)
      .order("title");
    setClassOptions((data ?? []) as { id: string; title: string }[]);
  }

  async function handleAddStudent() {
    const name = addName.trim();
    if (!name || !addClassId) return;
    setAddBusy(true);
    setAddError(null);

    // p_kind: 'ongoing' — an OPEN enrolment, because this child attends every
    // week. That means they also join the completeness gate, which is correct:
    // from now on the coach must mark them, and a forgotten lesson blocks
    // billing rather than vanishing.
    //
    // No session date and no attendance status: those belong to the coach's
    // trial path. Enrolment is dated from now, so lessons taught BEFORE today
    // are not expected of them (and so are neither blocked nor billed) — the
    // coach back-dates on the attendance screen if those need capturing.
    const { error } = await supabase.rpc("add_unclaimed_student", {
      p_class_id: addClassId,
      p_full_name: name,
      p_kind: "ongoing",
      p_date_of_birth: addDob || null,
      p_contact_phone: addPhone.trim() || null,
      p_contact_email: addEmail.trim() || null,
    });

    setAddBusy(false);
    if (error) {
      // The RPC returns a plain sentence for a duplicate name+DOB rather than
      // a raw constraint error (PRD §5.1) — show it as-is.
      setAddError(error.message);
      return;
    }

    setAddOpen(false);
    setAddName("");
    setAddDob("");
    setAddClassId("");
    setAddPhone("");
    setAddEmail("");
    await load();
  }

  // ── The parent's contact details ────────────────────────────────────────
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
  const [contactParents, setContactParents] = useState<
    { full_name: string | null; email: string | null; phone: string | null }[]
  >([]);
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
    const { data, error } = await supabase
      .from("students")
      .select(
        `provisional_contact_name, provisional_contact_phone, provisional_contact_email,
         parent_students(parents(id, profiles(full_name, email, phone)))`
      )
      .eq("id", student.id)
      .single();

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
    const { count, error: claimError } = await supabase
      .from("student_claims")
      .select("id", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("status", "pending");

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
    // would not be.)
    //
    // blankToNull mirrors the creation path's NULLIF(trim(...), '') so a
    // cleared field becomes NULL, not '' — see lib/sgPhone.ts.
    const { error } = await supabase
      .from("students")
      .update({
        provisional_contact_name: blankToNull(contactName),
        provisional_contact_phone: blankToNull(contactPhone),
        provisional_contact_email: blankToNull(contactEmail),
      })
      .eq("id", contactFor.id);

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

  async function handleInviteParent() {
    if (!inviting) return;
    setInviteBusy(true);
    setInviteResult(null);
    setInviteSent(false);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    try {
      const res = await fetch("/api/invite-parent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          student_id: inviting.id,
          email: inviteEmail.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setInviteResult(`Error: ${json.error ?? "invite failed"}`);
      } else if (json.emailed) {
        setInviteResult(
          json.message ?? `Invite sent to ${inviteEmail.trim()}.`
        );
        setInviteSent(true);
        await load();
      } else if (json.alreadyRegistered) {
        // A live account: the child was linked, nothing was mailed, and saying
        // so plainly matters — this used to claim an email had been sent.
        setInviteResult(json.message);
        setInviteSent(true);
        await load();
      } else {
        // No RESEND_API_KEY (local, or a misconfigured deploy). Showing the
        // link is deliberate — it keeps the flow usable — but it must be
        // clearly NOT the intended outcome, or a broken key looks like success.
        setInviteResult(
          `No email was sent (no mail key configured). Send them this link yourself: ${json.invite_link}`
        );
        await load();
      }
    } catch (e) {
      setInviteResult(`Error: ${String(e)}`);
    }
    setInviteBusy(false);
  }

  async function load() {
    const { data } = await supabase
      .from("students")
      .select(`
        id, full_name, date_of_birth, level_id, assignment_status, is_active, inactivated_at,
        tenant_levels(id, label),
        parent_students(parents(id, profiles(full_name))),
        student_class_enrolments(
          is_active,
          classes(title, coaches(profiles(full_name)))
        )
      `)
      .order("full_name");

    // Lessons per child, for duplicate detection: a merge must keep the row
    // holding the history, and merge_students() refuses the other direction
    // outright — so offering it would be offering a refusal.
    const { data: att } = await supabase.from("attendance").select("student_id");
    const lessonCount = new Map<string, number>();
    for (const a of (att ?? []) as { student_id: string }[]) {
      lessonCount.set(a.student_id, (lessonCount.get(a.student_id) ?? 0) + 1);
    }

    setStudents(
      (data ?? []).map((s: any) => {
        const activeEnrolment = (s.student_class_enrolments ?? []).find(
          (e: any) => e.is_active
        );
        return {
          id: s.id,
          full_name: s.full_name,
          date_of_birth: s.date_of_birth,
          level_id: s.level_id,
          // Read off the JOINED tenant_levels row, not off the student — the
          // select is `any`, so the wrong nesting level typechecks and renders
          // every student unlevelled (§7.28).
          level_label: s.tenant_levels?.label ?? null,
          // Two INDEPENDENT axes now. This used to collapse them —
          // `s.is_active ? s.assignment_status : "inactive"` — which is exactly
          // the ambiguity the active/inactive work removed: a child can be
          // active but unassigned (a new signup awaiting a class).
          assignment_status: s.assignment_status,
          is_active: s.is_active,
          inactivated_at: s.inactivated_at,
          parent_id: s.parent_students?.[0]?.parents?.id ?? null,
          parent_name:
            s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
          class_title: activeEnrolment?.classes?.title ?? null,
          coach_name:
            activeEnrolment?.classes?.coaches?.profiles?.full_name ?? null,
          lessons: lessonCount.get(s.id) ?? 0,
        };
      })
    );
    setLoading(false);
  }

  // Activity is the outer question ("still a customer?"), assignment the inner
  // one ("in a class?"). An inactive child's assignment is not interesting.
  const statusLabel = (s: StudentRow) => {
    if (!s.is_active) return "Inactive";
    if (s.assignment_status === "assigned") return "Assigned";
    return "Unassigned";
  };

  const thresholdNum =
    threshold.trim() === "" || !Number.isFinite(Number(threshold))
      ? null
      : Number(threshold);

  // Coverage is per CHILD now — a family whose package cannot pay for this
  // child's class is not flagged on this child's row. Logic lives in
  // lib/packageCoverage so it is unit-tested.
  const runningLow = (s: StudentRow) => isRunningLow(covMap.get(s.id), thresholdNum);

  const filtered = students.filter((s) => {
    const matchSearch =
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.parent_name.toLowerCase().includes(search.toLowerCase());
    const label = statusLabel(s);
    const matchStatus = statusFilter === "All" || label === statusFilter;
    const matchLow = !lowOnly || runningLow(s);
    const matchUnclaimed = !unclaimedOnly || isUnclaimed(s);
    return matchSearch && matchStatus && matchLow && matchUnclaimed;
  });

  // Derived on read, never stored: nothing would maintain a "possible
  // duplicate" flag, and a stored value nothing maintains is not a fact
  // (§7.37). A business has a few dozen students, so this is cheap.
  const dupPairs = findDuplicatePairs(
    students.map((s) => ({
      id: s.id,
      full_name: s.full_name,
      date_of_birth: s.date_of_birth,
      // The parent's IDENTITY, not just whether there is one: two rows under
      // the same family is the commonest duplicate, and a boolean hid it.
      parentId: s.parent_id,
      lessons: s.lessons,
      // A child who has left is never flagged as a duplicate — the banner has
      // no dismiss, so a pair the admin has already retired would be permanent
      // noise. Reported from production 2026-07-26.
      isActive: s.is_active,
    }))
  );

  const sort = useTableSort<StudentRow>({
    key: "full_name",
    accessors: {
      // The badge, not the enum: what the Status column shows is
      // Assigned/Unassigned/Inactive, so that is what A→Z has to order.
      status: (s) => statusLabel(s),
      // An unclaimed child's cell reads "No parent account" rather than a name.
      // Sorting the literal text keeps those rows together — they are the ones
      // holding a billing month open, so grouping them is the useful behaviour.
      parent_name: (s) => (isUnclaimed(s) ? "No parent account" : s.parent_name),
    },
  });
  const visible = sort.apply(filtered);

  const unclaimedCount = students.filter(
    (s) => s.is_active && isUnclaimed(s)
  ).length;

  // `load()` deliberately still fetches inactive children — the All tab lists
  // them. So the header describes a SUBSET of the rows on screen, and the
  // "· N inactive" suffix is what explains the difference.
  //
  // `students.is_active` only. NOT the family's `parent_tenants.is_active`: a
  // family can be inactive while still holding an active child, and §7.61 makes
  // that deliberately unreconciled — cascading family status into this count
  // would make a still-swimming child disappear from it.
  const activeStudentCount = students.filter((s) => s.is_active).length;
  const inactiveStudentCount = students.length - activeStudentCount;

  return (
    <div>
      {levelError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {levelError}
        </div>
      )}
      <PageHeader
        title="Students"
        subtitle={formatActiveStudents(activeStudentCount, inactiveStudentCount)}
        action={
          <Button
            onClick={() => {
              setAddOpen(true);
              setAddError(null);
            }}
          >
            Add student
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by student or parent..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-64"
        />
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Only offered when there ARE any: a permanently-visible filter that
              always returns nothing reads as a broken feature. */}
          {unclaimedCount > 0 && (
            <button
              onClick={() => setUnclaimedOnly(!unclaimedOnly)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                unclaimedOnly
                  ? "bg-amber-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
              title="Children a coach added before the family registered. Their billable lessons cannot be invoiced, and they hold the billing month open until the parent is invited or the money is recorded as settled."
            >
              No parent account ({unclaimedCount})
            </button>
          )}
          <button
            onClick={() => setLowOnly(!lowOnly)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              lowOnly
                ? "bg-amber-500 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
            title="Families whose prepaid package is nearly used up — time to remind them to renew. Counts lessons attended but not yet invoiced."
          >
            Package running low
          </button>
          {lowOnly && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              at
              <input
                value={threshold}
                onChange={(e) => saveThreshold(e.target.value)}
                inputMode="numeric"
                className="w-12 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-xs"
                aria-label="Low-package threshold in lessons"
              />
              lessons or fewer
            </label>
          )}
        </div>
      </div>

      {/* ── Two rows that look like the same child ───────────────────────────
          The claim flow stops NEW duplicates. This is for the ones already
          here — every child added before it shipped, and every child a parent
          created by answering "no, that's a different child". Without this
          nothing in the app ever mentions that a duplicate exists. */}
      {dupPairs.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            {dupPairs.length === 1
              ? "Two records may be the same child"
              : `${dupPairs.length} pairs of records may be the same child`}
          </p>
          <div className="mt-2 space-y-2">
            {dupPairs.map((p) => (
              <div
                key={`${p.survivor.id}:${p.duplicate.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <p className="text-sm text-gray-700">
                  <span className="font-medium">{p.survivor.full_name}</span>{" "}
                  ({p.survivor.lessons} lesson
                  {p.survivor.lessons === 1 ? "" : "s"}) and{" "}
                  <span className="font-medium">{p.duplicate.full_name}</span>{" "}
                  ({p.duplicate.lessons} lesson
                  {p.duplicate.lessons === 1 ? "" : "s"})
                </p>
                {p.needsHuman ? (
                  // merge_students() refuses this outright. Say so here rather
                  // than offering a button that only produces an error.
                  <span className="text-xs font-medium text-red-700">
                    Both have lessons recorded — sort this one out by hand
                  </span>
                ) : (
                  <Button variant="outline" onClick={() => setMerging(p)}>
                    Review &amp; merge
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Table>
        <Thead>
          <Th sort={sort} sortKey="full_name">Student</Th>
          <Th sort={sort} sortKey="level_label">Level</Th>
          <Th sort={sort} sortKey="parent_name">Parent</Th>
          <Th sort={sort} sortKey="status">Status</Th>
          <Th sort={sort} sortKey="class_title">Class</Th>
          <Th sort={sort} sortKey="coach_name">Coach</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
                No students found.
              </Td>
            </Tr>
          ) : (
            visible.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-gray-900">{s.full_name}</Td>
                <Td>
                  {/* Inline rather than behind a modal: placing a child on the
                      ladder is a glance-and-set action, and an admin doing it
                      for a new intake would otherwise open a dialog per child. */}
                  <select
                    value={s.level_id ?? ""}
                    onChange={(e) => setLevel(s, e.target.value || null)}
                    disabled={levels.length === 0 || savingLevelFor === s.id}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="">
                      {levels.length === 0 ? "No levels defined" : "—"}
                    </option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td className="text-gray-500">
                  {isUnclaimed(s) ? (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                      title="Added by a coach before this family registered. Their billable lessons cannot be invoiced until the parent has an account."
                    >
                      No parent account
                    </span>
                  ) : (
                    s.parent_name
                  )}
                  <span className="ml-1.5">
                    <PackageChip
                      coverage={covMap.get(s.id)}
                      lowThreshold={thresholdNum}
                    />
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={statusLabel(s)} />
                </Td>
                <Td className="text-gray-500">{s.class_title ?? "—"}</Td>
                <Td className="text-gray-500">{s.coach_name ?? "—"}</Td>
                <Td>
                  <div className="flex gap-2">
                    {s.is_active && isUnclaimed(s) && (
                      // The BETTER remedy than settling: once the parent has an
                      // account the lessons bill normally and no money is
                      // written off.
                      <button
                        onClick={() => {
                          setInviting(s);
                          setInviteEmail("");
                          setInviteResult(null);
                        }}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                      >
                        Invite parent
                      </button>
                    )}
                    {/* Offered for EVERY child, claimed or not — the modal
                        decides what it shows. For an unclaimed child it edits
                        what the coach wrote down; for a claimed one it is the
                        answer to "how do I reach this family?", which is
                        otherwise only on the Parents page. */}
                    <button
                      onClick={() => openContact(s)}
                      disabled={busyId === s.id}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Contact details
                    </button>
                    {s.is_active && s.class_title && (
                      <button
                        onClick={() => setPending({ student: s, mode: "remove" })}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Remove from class
                      </button>
                    )}
                    {s.is_active && (
                      <button
                        onClick={() => openInactive(s)}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Set inactive
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* ── Add a student whose parent hasn't registered ────────────────────
          For a child already attending weekly. A TRIAL is the coach's job —
          it marks attendance on the spot, and back-dating a missed one already
          works from the attendance screen — so this form deliberately offers
          only the ongoing shape. */}
      <Modal
        title="Add a student"
        open={addOpen}
        onClose={() => setAddOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            For a child who is already attending but whose parent hasn&apos;t
            signed up yet. They&apos;ll appear on the coach&apos;s roster
            straight away; invite the parent whenever they&apos;re ready and
            everything already marked becomes theirs.
          </p>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Child&apos;s full name
            </span>
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Class</span>
            <select
              value={addClassId}
              onChange={(e) => setAddClassId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose a class…</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Date of birth <span className="font-normal">(optional)</span>
            </span>
            <input
              type="date"
              value={addDob}
              onChange={(e) => setAddDob(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                Parent&apos;s phone <span className="text-red-500">*</span>
              </span>
              <input
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              {/* Advisory. The phone stays REQUIRED (the Add button below is
                  disabled without one); its shape never gates submit. */}
              <ContactHint check={checkSgPhone(addPhone)} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                Parent&apos;s email <span className="font-normal">(optional)</span>
              </span>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <ContactHint check={checkEmail(addEmail)} />
            </label>
          </div>
          <p className="-mt-1 text-[11px] text-gray-400">
            Both optional, and both save you work later — the email is what the
            invite goes to.
          </p>

          {addError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {addError}
            </p>
          )}

          <Button
            className="w-full"
            // Phone required for the same reason as a trial booking: it is the
            // only signal that survives how a name gets written.
            disabled={
              addBusy || !addName.trim() || !addClassId || !addPhone.trim()
            }
            onClick={handleAddStudent}
          >
            {addBusy ? "Adding…" : "Add student"}
          </Button>
        </div>
      </Modal>

      {/* ── The parent's contact details ────────────────────────────────────
          Two modes off ONE fresh read — see openContact(). Editable while the
          child is unclaimed, read-only once a parent holds the account. */}
      <Modal
        // Not "…'s parent": a child can have two, and the claimed branch shows
        // every one of them.
        title={`${contactFor?.full_name ?? ""} — parent contact details`}
        open={contactFor !== null}
        onClose={() => setContactFor(null)}
      >
        {contactLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : contactLoadFailed ? (
          // The error and NOTHING ELSE — see contactLoadFailed. An empty form
          // here is a loaded gun pointed at real contact details.
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {contactError}
          </p>
        ) : contactClaimed ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This family has a SwimSync account, so these are their own
              details. They keep them up to date in the app, under{" "}
              <span className="font-medium text-gray-700">
                Profile → Contact Details
              </span>{" "}
              — ask them to change it there and it updates everywhere.
            </p>
            {contactParents.map((parent, i) => (
              <div key={i}>
                {contactParents.length > 1 && (
                  <p className="mb-1 text-xs font-semibold text-gray-500">
                    Parent {i + 1} of {contactParents.length}
                  </p>
                )}
                <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {[
                    ["Name", parent.full_name],
                    ["Email", parent.email],
                    ["Phone", parent.phone],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3 px-3 py-2 text-sm">
                      <dt className="w-16 shrink-0 font-medium text-gray-500">
                        {label}
                      </dt>
                      <dd className="text-gray-900">
                        {value || (
                          <span className="text-gray-400">
                            Not provided — the parent can add it in the app
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {pendingClaims > 0
                ? // "Nobody has claimed this child yet" is true of the JOIN
                  // TABLE and false to a reader looking at a pending request —
                  // the two sentences contradicted each other on screen.
                  "These are the details taken when this child was added. They are what the parent below was matched on."
                : "Nobody has claimed this child yet, so these are the details taken when they were added. The phone and email are what match this child to their parent's account when the family registers."}
            </p>

            {pendingClaims > 0 ? (
              // ⚠ REFUSED, NOT WARNED. See openContact() — the Claims queue
              // shows a SNAPSHOT of why the candidate was offered, so editing
              // these underneath it makes the admin approve on a reason that is
              // no longer true. Do NOT add a bypass, and do NOT "fix" this by
              // rewriting student_claims.match_reason: it is a record of a past
              // act, not a live lookup (§6).
              <div className="space-y-3">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {pendingClaims === 1
                    ? "A parent is currently claiming this child, so these details are locked."
                    : `${pendingClaims} parents are currently claiming this child, so these details are locked.`}{" "}
                  The claim was raised against the details below — changing them
                  now would leave the decision resting on a reason that is no
                  longer true. Settle it on{" "}
                  <Link
                    href="/claims"
                    className="font-semibold underline hover:text-amber-900"
                  >
                    Parent claims
                  </Link>{" "}
                  first.
                </p>
                <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {[
                    ["Name", contactName],
                    ["Phone", contactPhone],
                    ["Email", contactEmail],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3 px-3 py-2 text-sm">
                      <dt className="w-16 shrink-0 font-medium text-gray-500">
                        {label}
                      </dt>
                      <dd className="text-gray-900">
                        {value || <span className="text-gray-400">—</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">
                    Parent&apos;s name
                  </span>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Sarah Lim"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Who the number belongs to — a parent, a grandparent, a
                    helper.
                  </p>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">
                    Parent&apos;s phone
                  </span>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="9123 4567"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <ContactHint check={checkSgPhone(contactPhone)} />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">
                    Parent&apos;s email
                  </span>
                  <input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="sarah@example.com"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <ContactHint check={checkEmail(contactEmail)} />
                </label>

                {contactError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {contactError}
                  </p>
                )}

                {/* Disabled ONLY while the write is in flight. The hints above
                    never gate this — see ContactHint. */}
                <Button
                  className="w-full"
                  disabled={contactBusy}
                  onClick={handleSaveContact}
                >
                  {contactBusy ? "Saving…" : "Save contact details"}
                </Button>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ── Invite the parent of an unclaimed child ─────────────────────────
          The happy path for a child a coach added. Unlike self-registration
          there is no matching to get wrong: the admin asserts the link, so the
          parent lands with this child already on their account and every
          lesson already marked for them becomes billable. */}
      <Modal
        title={`Invite ${inviting?.full_name ?? ""}'s parent`}
        open={inviting !== null}
        onClose={() => {
          setInviting(null);
          setInviteSent(false);
          setInviteResult(null);
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            We&apos;ll email them a link to set a password.{" "}
            {inviting?.full_name} will already be on their account, along with
            the attendance already marked — so the lessons can be invoiced
            normally.
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Parent&apos;s email <span className="font-normal">(optional)</span>
            </span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="parent@example.com"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          {inviteResult && (
            <p
              className={`rounded-lg px-3 py-2 text-xs break-all ${
                inviteSent
                  ? "bg-green-50 text-green-800"
                  : "bg-gray-50 text-gray-700"
              }`}
            >
              {inviteSent ? "✓ " : ""}
              {inviteResult}
            </p>
          )}

          {/* ⚠ ONCE IT HAS GONE, "SEND INVITE" IS NO LONGER THE PRIMARY ACTION.
              Leaving it as the big blue button invites a second press — and the
              second press used to send NOTHING while reporting success, because
              the first one had created the auth user and the route then took
              the "already has an account" branch. Done is now the primary act;
              Resend is deliberately secondary, and genuinely re-sends. */}
          {inviteSent ? (
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  setInviting(null);
                  setInviteSent(false);
                  setInviteResult(null);
                }}
              >
                Done
              </Button>
              <Button
                variant="outline"
                disabled={inviteBusy}
                onClick={handleInviteParent}
              >
                {inviteBusy ? "Sending…" : "Resend email"}
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={inviteBusy || !inviteEmail.trim()}
              onClick={handleInviteParent}
            >
              {inviteBusy ? "Sending…" : "Send invite"}
            </Button>
          )}
        </div>
      </Modal>

      <Modal
        title={
          pending?.mode === "inactive"
            ? `Set ${pending.student.full_name} inactive?`
            : `Remove ${pending?.student.full_name} from their class?`
        }
        open={pending !== null}
        onClose={() => setPending(null)}
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {pending.mode === "inactive"
                ? "They stop appearing on rosters and stop counting toward attendance. Any active class enrolment is closed at the same time."
                : "They return to Unassigned for you to place in another class. Their enrolment is closed, not deleted."}
            </p>
            {/* Siblings are a CHOICE — the admin may be removing one child
                while the others keep attending. Only shown when there are any. */}
            {pending.mode === "inactive" && siblings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-900">
                  {siblings.length === 1
                    ? `${siblings[0].full_name} is also in this family.`
                    : `${siblings.map((c) => c.full_name).join(", ")} are also in this family.`}
                </p>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={!takeSiblings}
                    onChange={() => setTakeSiblings(false)}
                  />
                  <span>
                    Just {pending.student.full_name}
                    {siblings.length === 1
                      ? ` — ${siblings[0].full_name} keeps attending`
                      : " — the others keep attending"}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={takeSiblings}
                    onChange={() => setTakeSiblings(true)}
                  />
                  <span>All {family.length} children in this family</span>
                </label>
              </div>
            )}

            {/* The family outcome is a CONSEQUENCE, not a question — a family
                with no active children here is no longer a customer here. So it
                is stated, not asked. */}
            {pending.mode === "inactive" && lastActive && (
              <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                That leaves no active children, so{" "}
                <strong>{pending.student.parent_name}</strong> will be marked
                inactive at this business too. They can rejoin any time with your
                join code.
              </p>
            )}

            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Attendance and billing history are kept, and lessons they have
              already attended this month will still be invoiced. Any credit
              balance is untouched.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={busyId !== null}
                onClick={() => handleStatusChange(pending.student, pending.mode)}
              >
                {pending.mode === "inactive" ? "Set inactive" : "Remove"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {actionError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {/* ── Merge: the one action that repoints a child's records ─────────── */}
      <Modal
        open={merging !== null}
        onClose={() => {
          setMerging(null);
          setMergeError(null);
        }}
        title="Merge these two records?"
      >
        {merging && (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Kept
              </p>
              <p className="mt-1 font-medium text-gray-900">
                {merging.survivor.full_name}
              </p>
              <p className="text-sm text-gray-500">
                {merging.survivor.lessons} lesson
                {merging.survivor.lessons === 1 ? "" : "s"} recorded
                {merging.survivor.date_of_birth
                  ? ` · born ${merging.survivor.date_of_birth}`
                  : " · no date of birth"}
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Deleted
              </p>
              <p className="mt-1 font-medium text-gray-900">
                {merging.duplicate.full_name}
              </p>
              <p className="text-sm text-gray-500">
                {merging.duplicate.lessons} lesson
                {merging.duplicate.lessons === 1 ? "" : "s"} recorded
                {merging.duplicate.date_of_birth
                  ? ` · born ${merging.duplicate.date_of_birth}`
                  : " · no date of birth"}
              </p>
            </div>

            <p className="text-sm text-gray-600">
              The parent account, any trial bookings and any settlements move
              across to the record being kept, along with a date of birth or
              gender it is missing. Nothing already recorded on the kept record
              is overwritten. This cannot be undone.
            </p>

            {merging.eitherWay && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Neither record has any lessons, so it does not matter much which
                survives — but check the spelling of the name you are keeping.
              </p>
            )}

            {mergeError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {mergeError}
              </p>
            )}

            <div className="flex gap-2">
              <Button disabled={mergeBusy} onClick={() => doMerge(merging)}>
                {mergeBusy ? "Merging…" : "Merge them"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMerging(null);
                  setMergeError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
