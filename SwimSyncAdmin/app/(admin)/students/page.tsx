"use client";

import { useEffect } from "react";
import { useStudentList } from "./domain/useStudentList";
import { isUnclaimed, matchesFilters } from "./domain/studentRows";
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
import { useActionsDrawer } from "./domain/useActionsDrawer";
import { usePackageSettings } from "./domain/usePackageSettings";
import { ActionsDrawer } from "./ui/ActionsDrawer";
import { StudentTable } from "./ui/StudentTable";
import { StudentsHeader } from "./ui/StudentsHeader";

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

  const unclaimedCount = students.filter(
    (s) => s.is_active && isUnclaimed(s)
  ).length;

  return (
    <div>
      {grading.levelError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {grading.levelError}
        </div>
      )}
      <StudentsHeader students={students} onAdd={addStudent.open} />

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

      <StudentTable
        students={filtered}
        loading={loading}
        levels={grading.levels}
        savingLevelFor={grading.savingLevelFor}
        onSetLevel={grading.setLevel}
        covMap={packages.covMap}
        busyId={status.busyId}
        onActions={drawer.open}
      />

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
