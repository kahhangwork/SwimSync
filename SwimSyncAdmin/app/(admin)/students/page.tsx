"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { formatActiveStudents } from "@/lib/studentCounts";
import { Button } from "@/components/Button";
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
import { useActionsDrawer } from "./domain/useActionsDrawer";
import { usePackageSettings } from "./domain/usePackageSettings";
import { ActionsDrawer } from "./ui/ActionsDrawer";
import { capitalizeDay } from "./ui/dayLabel";

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

  // Slice 9 — the per-row Actions drawer and its referral summary.
  const drawer = useActionsDrawer();
  // Tenant package settings + per-child coverage (plan §10: extracted in place).
  const packages = usePackageSettings();
  const { tenantId } = packages;
  // Slice 6 — the level ladder and the one-child grading modal.
  const grading = useGrading(load);
  // Slice 8 — the parent's contact details, and inviting a parent.
  const contact = useContact();
  const invite = useInvite(load);
  // Slice 7 — the Add-student form and its advisory duplicate check.
  const addStudent = useAddStudent(tenantId, load);
  useEffect(() => {
    grading.loadLevels();
    packages.loadPackages();
    addClass.loadClasses();
  }, []);

  // Search is applied in the DATABASE now (scoped, past the 1000-row cap), so it
  // is gone from here — these are the refinements over whatever the fetch
  // returned (the matched set when searching, else the first 1000).
  const filtered = students.filter((s) =>
    matchesFilters(s, { statusFilter, lowOnly, unclaimedOnly }, packages.runningLow)
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
        threshold={packages.threshold}
        onThreshold={packages.saveThreshold}
        expiryDays={packages.expiryDays}
        onExpiryDays={packages.saveExpiryDays}
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
                  const cov = packages.covMap.get(s.id);
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
                    onClick={() => drawer.open(s)}
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

      <ActionsDrawer
        drawer={drawer}
        onInvite={invite.open}
        onContact={contact.openContact}
        onRename={rename.openRename}
        onGrade={(s) => void grading.openGrading(s)}
        onInactive={status.openInactive}
        onRemove={status.openRemove}
        onAddClass={addClass.openAddClass}
      />

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
