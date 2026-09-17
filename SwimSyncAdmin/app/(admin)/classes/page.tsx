"use client";

import { useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";

import { locationFilterOptions } from "./domain/locationOptions";
import { countActiveRetired } from "./domain/classRows";
import { useClassList } from "./domain/useClassList";
import { useRoster } from "./domain/useRoster";
import { useClassDrawer } from "./domain/useClassDrawer";
import { useExtraLesson } from "./domain/useExtraLesson";
import { useCancelLesson } from "./domain/useCancelLesson";
import { useRetire } from "./domain/useRetire";
import { useClassForm } from "./domain/useClassForm";
import { ClassToolbar } from "./ui/ClassToolbar";
import { ClassTable } from "./ui/ClassTable";
import { RosterDrawer } from "./ui/RosterDrawer";
import { ExtraLessonModal } from "./ui/ExtraLessonModal";
import { CancelLessonModal } from "./ui/CancelLessonModal";
import { RetireModal } from "./ui/RetireModal";
import { ClassFormModal } from "./ui/ClassFormModal";
import { NewClassButton } from "./ui/NewClassButton";

export default function ClassesPage() {
  const list = useClassList();
  const roster = useRoster(list.classes);
  const drawer = useClassDrawer(list.coaches);
  const extra = useExtraLesson();
  const cancel = useCancelLesson();
  const retire = useRetire(list.load);
  const form = useClassForm(list.load);

  useEffect(() => {
    list.load();
    list.loadCoaches();
    form.loadCategories();
    form.loadLocations();
    roster.loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locationOptions = useMemo(
    () => locationFilterOptions(list.classes),
    [list.classes]
  );
  const openRoster = roster.rosterByClass.get(drawer.drawerClass?.id ?? "") ?? {
    enrolled: [],
    trials: [],
  };
  const { active: activeCount, retired: retiredCount } = countActiveRetired(
    list.classes
  );

  return (
    <div>
      <PageHeader
        title="Classes"
        // Counted, not `classes.length` — that array now carries retired classes
        // too, and this line would have quietly started overstating the number
        // of classes the business actually runs.
        subtitle={`${
          retiredCount > 0
            ? `${activeCount} active · ${retiredCount} retired`
            : `${activeCount} active classes`
        }`}
        action={<NewClassButton onOpen={form.openNew} />}
      />

      <ClassToolbar
        search={list.search}
        onSearch={list.setSearch}
        locationOptions={locationOptions}
        locationFilter={list.locationFilter}
        onLocationFilter={list.setLocationFilter}
        showRetired={list.showRetired}
        onShowRetired={list.setShowRetired}
        retiredCount={retiredCount}
        loading={list.loading}
        capped={list.capped}
        retireError={retire.retireError}
        retireFor={retire.retireFor}
      />

      <ClassTable
        filtered={list.filtered}
        loading={list.loading}
        rosterByClass={roster.rosterByClass}
        restoringId={retire.restoringId}
        onSeeStudents={drawer.setDrawerClass}
        onEdit={form.openEdit}
        onExtra={extra.openExtra}
        onCancel={cancel.openCancel}
        onRetire={(cls) => {
          retire.setRetireError(null);
          retire.setRetireFor(cls);
        }}
        onRestore={retire.handleRestore}
      />

      <RetireModal
        retireFor={retire.retireFor}
        onClose={() => {
          retire.setRetireFor(null);
          retire.setRetireError(null);
        }}
        retireError={retire.retireError}
        retireSaving={retire.retireSaving}
        onRetire={retire.handleRetire}
      />

      <CancelLessonModal
        cancelFor={cancel.cancelFor}
        onClose={() => cancel.setCancelFor(null)}
        cancelDate={cancel.cancelDate}
        onCancelDate={cancel.setCancelDate}
        cancelReason={cancel.cancelReason}
        onCancelReason={cancel.setCancelReason}
        cancelSaving={cancel.cancelSaving}
        cancelError={cancel.cancelError}
        cancelDone={cancel.cancelDone}
        onCancelLesson={cancel.handleCancelLesson}
      />

      <ExtraLessonModal
        extraFor={extra.extraFor}
        onClose={() => extra.setExtraFor(null)}
        extraDate={extra.extraDate}
        onExtraDate={extra.setExtraDate}
        extraReason={extra.extraReason}
        onExtraReason={extra.setExtraReason}
        extraSaving={extra.extraSaving}
        extraError={extra.extraError}
        extraDone={extra.extraDone}
        onSchedule={extra.handleScheduleExtra}
      />

      <RosterDrawer
        drawerClass={drawer.drawerClass}
        onClose={() => drawer.setDrawerClass(null)}
        rosterError={roster.rosterError}
        shadows={drawer.shadows}
        shadowError={drawer.shadowError}
        shadowBusy={drawer.shadowBusy}
        shadowPick={drawer.shadowPick}
        onShadowPick={drawer.setShadowPick}
        shadowFrom={drawer.shadowFrom}
        onShadowFrom={drawer.setShadowFrom}
        onAssignShadow={drawer.handleAssignShadow}
        onEndShadow={drawer.handleEndShadow}
        coaches={list.coaches}
        openRoster={openRoster}
        covMap={roster.covMap}
      />

      <ClassFormModal form={form} coaches={list.coaches} />
    </div>
  );
}
