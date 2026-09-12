"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { formatActiveStudents } from "@/lib/studentCounts";
import { Button } from "@/components/Button";
import {
  coverageByStudent,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import { Drawer } from "@/components/Drawer";
import type { SearchField, StudentRow } from "./types";
import * as repo from "./dao/students.repo";
import * as rpc from "./dao/students.rpc";
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
import { useMerge } from "./domain/useMerge";
import { DuplicateBanner } from "./ui/DuplicateBanner";
import { MergeModal } from "./ui/MergeModal";
import { useAddStudent } from "./domain/useAddStudent";
import { AddStudentModal } from "./ui/AddStudentModal";
import { useContact } from "./domain/useContact";
import { useInvite } from "./domain/useInvite";
import { ContactModal } from "./ui/ContactModal";
import { InviteModal } from "./ui/InviteModal";
import { useGrading } from "./domain/useGrading";
import { GradingModal } from "./ui/GradingModal";
import { LevelSelect } from "./ui/LevelSelect";

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
  // Slice 2 — duplicate pairs are derived from the list on every render.
  const merge = useMerge(students, load);

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
  // Slice 6 — the level ladder and the one-child grading modal.
  const grading = useGrading(load);
  // Slice 8 — the parent's contact details, and inviting a parent.
  const contact = useContact();
  const invite = useInvite(load);
  const [threshold, setThreshold] = useState("2");
  const [expiryDays, setExpiryDays] = useState("14");
  const [tenantId, setTenantId] = useState<string | null>(null);
  // Slice 7 — the Add-student form and its advisory duplicate check.
  const addStudent = useAddStudent(tenantId, load);
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
    grading.loadLevels();
    loadPackages();
    addClass.loadClasses();
  }, []);

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
      {grading.levelError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {grading.levelError}
        </div>
      )}
      <PageHeader
        title="Students"
        subtitle={formatActiveStudents(activeStudentCount, inactiveStudentCount)}
        action={
          <Button
            onClick={addStudent.open}
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

      <DuplicateBanner pairs={merge.dupPairs} onReview={merge.review} />

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
                  <LevelSelect
                    student={s}
                    levels={grading.levels}
                    saving={grading.savingLevelFor === s.id}
                    onChange={(levelId) => grading.setLevel(s, levelId)}
                  />
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
                      invite.open(s);
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
                    contact.openContact(s);
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
                    void grading.openGrading(s);
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

      <GradingModal grading={grading} tenantId={tenantId} />

      <AddStudentModal add={addStudent} classOptions={addClass.classOptions} />

      <ContactModal contact={contact} />

      {/* ── Rename a child ──────────────────────────────────────────────────
          Not frozen under a pending claim — see openRename's note. */}
      <RenameModal rename={rename} />

      <InviteModal invite={invite} />

      <StatusChangeModal status={status} />

      <AddClassModal addClass={addClass} />

      <MergeModal merge={merge} />
    </div>
  );
}
