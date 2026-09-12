"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { formatActiveStudents } from "@/lib/studentCounts";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { findDuplicatePairs, type DupPair } from "@/lib/duplicateStudents";
import {
  describeCandidate,
  partitionCandidates,
  type RosterCandidate,
} from "@/lib/rosterDuplicates";
import { checkSgPhone, checkEmail, blankToNull } from "@/lib/sgPhone";
import { ContactHint } from "@/components/ContactHint";
import {
  coverageByStudent,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import { Drawer } from "@/components/Drawer";
import { AssessmentGrid } from "@/components/AssessmentGrid";
import { todayInSg } from "@/lib/lessonDates";
import type {
  GradeLevel as SkillGradeLevel,
  Level as SkillLevel,
  RosterStudent,
} from "@/lib/assessment";
import type { SearchField, StudentRow } from "./types";
import * as repo from "./dao/students.repo";
import * as rpc from "./dao/students.rpc";
import * as api from "./dao/students.api";
import { useStudentList } from "./domain/useStudentList";
import { statusLabel, isUnclaimed, matchesFilters } from "./domain/studentRows";
import { StudentToolbar } from "./ui/StudentToolbar";
import { ListNotices } from "./ui/ListNotices";
import { useRename } from "./domain/useRename";
import { useAddClass } from "./domain/useAddClass";
import { useStudentStatus } from "./domain/useStudentStatus";
import { RenameModal } from "./ui/RenameModal";
import { AddClassModal } from "./ui/AddClassModal";
import { StatusChangeModal } from "./ui/StatusChangeModal";

/** "monday" → "Mon". The chip has room for a weekday and a time, not both in
 *  full, and the day is what an admin scans for. */
const capitalizeDay = (d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3);

export default function StudentsPage() {
  // Slice 1: the list, the scoped search, the filters, and load() — which every
  // write handler below still awaits, exactly as before.
  const {
    students,
    loading,
    loadError,
    capped,
    search,
    setSearch,
    searchField,
    setSearchField,
    statusFilter,
    setStatusFilter,
    lowOnly,
    setLowOnly,
    unclaimedOnly,
    setUnclaimedOnly,
    load,
  } = useStudentList();
  // Slices 3, 4, 5 — rename, add-to-class, inactive/remove. Each hook takes
  // load() so its write refetches the table exactly as the inline code did.
  const rename = useRename(load);
  const addClass = useAddClass(load);
  const status = useStudentStatus(load);
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
    const { error } = await rpc.mergeStudents(pair.survivor.id, pair.duplicate.id);
    setMergeBusy(false);
    if (error) {
      setMergeError(error.message);
      return;
    }
    setMerging(null);
    await load();
  }

  // The per-row Actions drawer — one button holds Invite/Contact/Rename/Inactive
  // so the row keeps only the inline glance-and-set controls (Decision 10).
  const [drawerFor, setDrawerFor] = useState<StudentRow | null>(null);
  // Read-only referral summary for the drawer's parent (link to /referrals).
  const [drawerReferral, setDrawerReferral] = useState<
    { referred: boolean; brought: number } | null
  >(null);
  useEffect(() => {
    const pid = drawerFor?.parent_id;
    if (!pid) {
      setDrawerReferral(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [refereeRes, referrerRes] = await Promise.all([
        repo.countReferredBy(pid),
        repo.countConvertedReferrals(pid),
      ]);
      if (cancelled) return;
      setDrawerReferral({
        referred: (refereeRes.count ?? 0) > 0,
        brought: referrerRes.count ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [drawerFor?.parent_id]);
  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);

  // ── Grade skills, for ONE child (the Assessment tab does whole classes) ────
  // This is the one-off correction: a child was mis-graded, or joined after the
  // class was assessed. The round machinery still applies — `since` is today, so
  // a grade from a previous round shows greyed and dated exactly as it does in
  // the class grid, and a correction made here reads as fresh.
  const [gradingFor, setGradingFor] = useState<StudentRow | null>(null);
  const [gradeLevels, setGradeLevels] = useState<SkillLevel[]>([]);
  const [gradeScale, setGradeScale] = useState<SkillGradeLevel[]>([]);
  const [gradeRoster, setGradeRoster] = useState<RosterStudent[]>([]);
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [savingLevelFor, setSavingLevelFor] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

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
  // The Add-student duplicate warning (ADD_STUDENT_DUP_WARNING_PLAN.md).
  // `addDupCandidates` are possible duplicates find_roster_duplicates() returned;
  // `addConfirmed` arms the second, "Add anyway" click once they have been shown.
  const [addDupCandidates, setAddDupCandidates] = useState<RosterCandidate[]>([]);
  const [addConfirmed, setAddConfirmed] = useState(false);
  const [inviting, setInviting] = useState<StudentRow | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  // Separate from the message, because the modal's ACTIONS change once the
  // invite has gone: re-pressing a primary "Send invite" is how an admin
  // double-sends, or worse, believes they have re-sent when they have not.
  const [inviteSent, setInviteSent] = useState(false);
  const [threshold, setThreshold] = useState("2");
  const [expiryDays, setExpiryDays] = useState("14");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );

  async function loadPackages() {
    const { data: userRes } = await repo.getCurrentUser();
    const { data: prof } = await repo.fetchTenantPackageSettings(userRes.user?.id);
    setTenantId((prof as any)?.tenant_id ?? null);
    const stored = (prof as any)?.tenants?.low_package_lessons;
    if (stored !== null && stored !== undefined) setThreshold(String(stored));
    const storedDays = (prof as any)?.tenants?.package_expiry_warning_days;
    if (storedDays !== null && storedDays !== undefined)
      setExpiryDays(String(storedDays));

    // Per-child verdict, category- and expiry-aware, computed in SQL. The old
    // code summed package_live_balances() by parent here, which said "10 left"
    // beside a child whose class the package could never pay for, and counted
    // date-expired packages too.
    const { data: cov } = await rpc.fetchPackageCoverage();
    setCovMap(coverageByStudent(cov ?? []));
  }

  async function saveThreshold(value: string) {
    setThreshold(value);
    // Empty BEFORE coercing (§7.22): an empty field must not save 0.
    if (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0)
      return;
    if (!tenantId) return;
    await repo.updateLowPackageLessons(tenantId, Number(value));
  }

  async function saveExpiryDays(value: string) {
    setExpiryDays(value);
    if (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0)
      return;
    if (!tenantId) return;
    await repo.updatePackageExpiryDays(tenantId, Number(value));
  }

  useEffect(() => {
    loadLevels();
    loadPackages();
    addClass.loadClasses();
  }, []);

  async function loadLevels() {
    // RLS scopes this to the caller's own business. Ordered by sort_order, not
    // by label — a ladder sorted alphabetically puts "Advanced" above
    // "Beginner", which is why sort_order exists at all.
    const { data } = await repo.fetchLevels();
    setLevels(data ?? []);
  }

  // Fetches everything the grid needs for ONE child. Kept separate from
  // loadLevels() above, which deliberately reads only id + label for the inline
  // dropdown — the grid additionally needs each level's skills and the tenant's
  // grade scale, and loading those on every Students page render would be a
  // per-row cost paid by the many admins who never grade from here.
  async function openGrading(student: StudentRow) {
    setGradingFor(student);
    setGradeLoading(true);
    setGradeError(null);

    const [levelsRes, scaleRes, progRes] = await Promise.all([
      repo.fetchLevelsWithSkills(),
      repo.fetchGradeScale(),
      repo.fetchSkillProgress(student.id),
    ]);

    const failed = levelsRes.error || scaleRes.error || progRes.error;
    if (failed) {
      // Surfaced, not swallowed: an empty grid that is really a failed query
      // reads as "this child has no skills", which would invite re-grading work
      // that already exists.
      setGradeError(failed.message);
      setGradeLoading(false);
      return;
    }

    setGradeLevels(
      (levelsRes.data ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        sort_order: l.sort_order,
        skills: l.tenant_level_skills ?? [],
      }))
    );
    setGradeScale((scaleRes.data ?? []) as SkillGradeLevel[]);
    setGradeRoster([
      {
        id: student.id,
        full_name: student.full_name,
        level_id: student.level_id,
        progress: (progRes.data ?? []) as any,
      },
    ]);
    setGradeLoading(false);
  }

  async function setLevel(student: StudentRow, levelId: string | null) {
    setSavingLevelFor(student.id);
    setLevelError(null);
    const { error } = await repo.updateStudentLevel(student.id, levelId);
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

  // ⚠ RISK 6: any edit to the identifying fields re-arms the check — a warning
  // the admin saw for "Anya / 9111 2222" must not carry over to a different
  // child. Structural reset, not a reminder: the confirm token and the shown
  // candidates both clear whenever name / phone / DOB change.
  useEffect(() => {
    setAddConfirmed(false);
    setAddDupCandidates([]);
  }, [addName, addPhone, addDob]);

  // Blank the whole Add form, including the duplicate-warning state. Called on
  // open, on close, and after a successful add, so a stale warning + pre-armed
  // "Add anyway" button can never carry from one child to the next.
  function resetAddForm() {
    setAddName("");
    setAddDob("");
    setAddClassId("");
    setAddPhone("");
    setAddEmail("");
    setAddDupCandidates([]);
    setAddConfirmed(false);
    setAddError(null);
  }

  async function handleAddStudent() {
    const name = addName.trim();
    // Phone is required (the button enforces it too) — it is the strongest
    // duplicate signal, so never add without it.
    if (!name || !addClassId || !addPhone.trim()) return;
    setAddBusy(true);
    setAddError(null);

    // ⚠ RISK 1/3/4: the duplicate WARNING. Advisory, and it FAILS OPEN — an
    // error or a refusal from find_roster_duplicates() must never block the add
    // (students_identity_uniq is the real floor). On the FIRST click, if it
    // finds candidates, show them and stop; `addConfirmed` then lets the second
    // "Add anyway" click through. A phone match never hard-blocks — siblings
    // share a parent phone, which is why this is a prompt, not a refusal.
    if (!addConfirmed) {
      try {
        const { data, error } = await rpc.findRosterDuplicates({
          p_tenant_id: tenantId,
          p_full_name: name,
          p_phone: addPhone.trim() || null,
          p_dob: addDob || null,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          setAddDupCandidates(data as RosterCandidate[]);
          setAddConfirmed(true);
          setAddBusy(false);
          return;
        }
      } catch {
        // Fail open: fall through to the insert. The warning is a courtesy.
      }
    }

    // p_kind: 'ongoing' — an OPEN enrolment, because this child attends every
    // week. That means they also join the completeness gate, which is correct:
    // from now on the coach must mark them, and a forgotten lesson blocks
    // billing rather than vanishing.
    //
    // No session date and no attendance status: those belong to the coach's
    // trial path. Enrolment is dated from now, so lessons taught BEFORE today
    // are not expected of them (and so are neither blocked nor billed) — the
    // coach back-dates on the attendance screen if those need capturing.
    const { error } = await rpc.addUnclaimedStudent({
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
    resetAddForm();
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

  async function handleInviteParent() {
    if (!inviting) return;
    setInviteBusy(true);
    setInviteResult(null);
    setInviteSent(false);

    try {
      const { ok, json } = await api.inviteParent(inviting.id, inviteEmail.trim());
      if (!ok) {
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

  // ⚠ RISK 10 — "running low" is now the SQL `low` verdict (lessons OR expiry,
  // minus families with an open row), so this filter AGREES with Generate-all's
  // candidate list. No TS re-derivation.
  const runningLow = (s: StudentRow) => covMap.get(s.id)?.low === true;

  // Search is applied in the DATABASE now (scoped, past the 1000-row cap), so it
  // is gone from here — these are the refinements over whatever the fetch
  // returned (the matched set when searching, else the first 1000).
  const filtered = students.filter((s) =>
    matchesFilters(s, { statusFilter, lowOnly, unclaimedOnly }, runningLow)
  );

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
              resetAddForm();
              setAddOpen(true);
            }}
          >
            Add student
          </Button>
        }
      />

      <StudentToolbar
        search={search}
        onSearch={setSearch}
        searchField={searchField}
        onSearchField={setSearchField}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        unclaimedCount={unclaimedCount}
        unclaimedOnly={unclaimedOnly}
        onToggleUnclaimed={() => setUnclaimedOnly(!unclaimedOnly)}
        lowOnly={lowOnly}
        onToggleLow={() => setLowOnly(!lowOnly)}
        threshold={threshold}
        onThreshold={saveThreshold}
        expiryDays={expiryDays}
        onExpiryDays={saveExpiryDays}
      />

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

      <ListNotices
        loading={loading}
        loadError={loadError}
        capped={capped}
        searching={search.trim() !== ""}
      />

      <Table>
        <Thead>
          <Th sort={sort} sortKey="full_name">Student</Th>
          <Th sort={sort} sortKey="level_label">Level</Th>
          <Th sort={sort} sortKey="parent_name">Parent</Th>
          <Th>Package</Th>
          <Th>Left</Th>
          <Th>Expires</Th>
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
                </Td>
                {/* Package / Left / Expires — the coverage columns replace the
                    old Parent-cell chip (one truth per row). Amber when the
                    family is running low (SQL `low`); blank/"Ad-hoc" when the
                    child's class is not package-covered. */}
                {(() => {
                  const cov = covMap.get(s.id);
                  const adHoc = !cov || cov.coverage === "ad_hoc";
                  const amber = cov?.low ? "text-amber-700 font-medium" : "text-gray-600";
                  return (
                    <>
                      <Td className={adHoc ? "text-gray-400" : amber}>
                        {adHoc ? "Ad-hoc" : cov?.packageName ?? "Package"}
                      </Td>
                      <Td className={adHoc ? "text-gray-400" : amber}>
                        {adHoc || cov?.lessonsRemaining == null
                          ? "—"
                          : `${cov.lessonsRemaining} left`}
                      </Td>
                      <Td className="text-gray-500">
                        {adHoc || !cov?.expiresOn ? "—" : cov.expiresOn}
                      </Td>
                    </>
                  );
                })()}
                <Td>
                  <StatusBadge status={statusLabel(s)} />
                </Td>
                {/* VIEW-ONLY chips — one per class, showing that a child is in
                    more than one class. Adding a class and ending one both live
                    in the Actions drawer now. */}
                <Td className="text-gray-500">
                  {s.classes.length === 0 ? (
                    "—"
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      {s.classes.map((c) => (
                        <span
                          key={c.id}
                          title={`${c.title}${c.coach_name ? ` · ${c.coach_name}` : ""}`}
                          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                        >
                          {c.day ? capitalizeDay(c.day) : c.title}
                          {c.start ? ` ${c.start}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="text-gray-500">
                  {/* DISTINCT coaches. Two classes with the same coach must not
                      print the name twice. */}
                  {[...new Set(s.classes.map((c) => c.coach_name).filter(Boolean))].join(
                    ", "
                  ) || "—"}
                </Td>
                {/* One Actions button opens the right-hand Drawer. The
                    glance-and-set controls (Level dropdown, class chips + Add
                    class) stay inline in their own columns — Decision 10. */}
                <Td>
                  <button
                    onClick={() => setDrawerFor(s)}
                    disabled={status.busyId === s.id}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Actions
                  </button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* ── Per-row Actions drawer (Decision 10) ────────────────────────────
          Each button opens the SAME modal the column opened before — no logic
          moved, only the trigger. The drawer closes first so the modal is never
          launched behind it (RISK 8 / §7.10, §7.58). */}
      <Drawer
        open={drawerFor !== null}
        onClose={() => setDrawerFor(null)}
        title={drawerFor?.full_name ?? "Actions"}
        subtitle={drawerFor ? statusLabel(drawerFor) : undefined}
      >
        {drawerFor && (
          <div className="space-y-6 px-6 py-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Parent
              </h3>
              <div className="space-y-2">
                {drawerFor.is_active && isUnclaimed(drawerFor) && (
                  <button
                    onClick={() => {
                      const s = drawerFor;
                      setDrawerFor(null);
                      setInviting(s);
                      setInviteEmail("");
                      setInviteResult(null);
                    }}
                    className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    Invite parent
                  </button>
                )}
                <button
                  onClick={() => {
                    const s = drawerFor;
                    setDrawerFor(null);
                    openContact(s);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Contact details
                </button>
                {drawerReferral && (drawerReferral.referred || drawerReferral.brought > 0) && (
                  <a
                    href="/referrals"
                    className="block rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    {drawerReferral.referred ? "Referred by a friend" : ""}
                    {drawerReferral.referred && drawerReferral.brought > 0 ? " · " : ""}
                    {drawerReferral.brought > 0
                      ? `Referred ${drawerReferral.brought} ${drawerReferral.brought === 1 ? "friend" : "friends"}`
                      : ""}
                    <span className="text-sky-600"> → Referrals</span>
                  </a>
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Student
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    const s = drawerFor;
                    setDrawerFor(null);
                    rename.openRename(s);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Rename
                </button>
                {/* The one-off correction. Whole classes are graded on the
                    Assessment tab; this is for the child who joined late or was
                    mis-graded. The drawer closes FIRST so the modal is never
                    stacked on top of it — the order every other action here
                    uses. */}
                <button
                  onClick={() => {
                    const s = drawerFor;
                    setDrawerFor(null);
                    void openGrading(s);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Grade skills
                </button>
                {drawerFor.is_active && (
                  <button
                    onClick={() => {
                      const s = drawerFor;
                      setDrawerFor(null);
                      status.openInactive(s);
                    }}
                    className="w-full rounded-lg border border-red-200 px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    Set inactive
                  </button>
                )}
              </div>
            </div>
            {/* Classes — the add / end-enrolment controls moved here from the
                table; the Class column is now view-only. Active students only,
                as the inline controls were. */}
            {drawerFor.is_active && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Classes
                </h3>
                <div className="space-y-2">
                  {drawerFor.classes.length === 0 ? (
                    <p className="text-sm text-gray-400">Not in any class yet.</p>
                  ) : (
                    drawerFor.classes.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
                      >
                        <span className="text-sm text-gray-700">
                          {c.day ? capitalizeDay(c.day) : c.title}
                          {c.start ? ` ${c.start}` : ""}
                          {c.coach_name ? (
                            <span className="text-gray-400"> · {c.coach_name}</span>
                          ) : null}
                        </span>
                        <button
                          onClick={() => {
                            const s = drawerFor;
                            setDrawerFor(null);
                            status.openRemove(s, c);
                          }}
                          aria-label={`Remove ${drawerFor.full_name} from ${c.title}`}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                  <button
                    onClick={() => {
                      const s = drawerFor;
                      setDrawerFor(null);
                      addClass.openAddClass(s);
                    }}
                    className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    + Add class
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* ── Grade ONE child's skills ────────────────────────────────────────
          The same grid the Assessment tab uses, in compact mode: no paint
          toolbar, because there is no run of children to paint across. Sharing
          the component is deliberate — two implementations of "what does this
          grade mean" would eventually disagree, and only one of them would be
          the one the assessor trusts. */}
      <Modal
        title={gradingFor ? `Grade ${gradingFor.full_name}` : "Grade skills"}
        open={gradingFor !== null}
        onClose={() => {
          setGradingFor(null);
          setGradeError(null);
        }}
      >
        {gradeError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Could not load this child&apos;s skills: {gradeError}. Close and try
            again — an empty list here is a failed query, not an ungraded child.
          </div>
        ) : gradeLoading ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        ) : tenantId && gradingFor ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Click a grade to cycle it. Changes save straight away. Grades from
              before today show greyed with the date they were given.
            </p>
            <AssessmentGrid
              tenantId={tenantId}
              roster={gradeRoster}
              levels={gradeLevels}
              scale={gradeScale}
              since={todayInSg()}
              compact
              onReload={() => openGrading(gradingFor)}
            />
          </div>
        ) : null}
      </Modal>

      {/* ── Add a student whose parent hasn't registered ────────────────────
          For a child already attending weekly. A TRIAL is the coach's job —
          it marks attendance on the spot, and back-dating a missed one already
          works from the attendance screen — so this form deliberately offers
          only the ongoing shape. */}
      <Modal
        title="Add a student"
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetAddForm();
        }}
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
              {addClass.classOptions.map((c) => (
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

          {/* ⚠ RISK 1/3: possible duplicates. Phone hits (strong) are shown
              first and separately from same-name hits (weak), so a name
              coincidence never reads as equal evidence to a phone match. The
              admin can still proceed — "Add anyway" — because a phone match may
              be a sibling, not a duplicate. */}
          {addDupCandidates.length > 0 &&
            (() => {
              const { strong, weak } = partitionCandidates(addDupCandidates);
              const Row = (c: RosterCandidate) => (
                <li key={c.student_id}>
                  <span className="font-medium">{c.full_name}</span>{" "}
                  <span className="text-amber-700">— {describeCandidate(c)}</span>
                </li>
              );
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-semibold">
                    This may already be on your roster
                  </p>
                  {strong.length > 0 && (
                    <>
                      <p className="mt-1 text-[11px] text-amber-700">
                        Same phone number:
                      </p>
                      <ul className="ml-4 list-disc">{strong.map(Row)}</ul>
                    </>
                  )}
                  {weak.length > 0 && (
                    <>
                      <p className="mt-1 text-[11px] text-amber-700">
                        Same name:
                      </p>
                      <ul className="ml-4 list-disc">{weak.map(Row)}</ul>
                    </>
                  )}
                  <p className="mt-2 text-[11px]">
                    If this is a new child (a sibling can share a phone), add
                    them anyway. If it is the same child, close this and find
                    them on the roster instead.
                  </p>
                </div>
              );
            })()}

          <Button
            className="w-full"
            // Phone required for the same reason as a trial booking: it is the
            // only signal that survives how a name gets written.
            disabled={
              addBusy || !addName.trim() || !addClassId || !addPhone.trim()
            }
            onClick={handleAddStudent}
          >
            {addBusy
              ? "Adding…"
              : addConfirmed && addDupCandidates.length > 0
                ? "Add anyway"
                : "Add student"}
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

      {/* ── Rename a child ──────────────────────────────────────────────────
          Not frozen under a pending claim — see openRename's note. */}
      <RenameModal rename={rename} />

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

      <StatusChangeModal status={status} />

      <AddClassModal addClass={addClass} />

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
