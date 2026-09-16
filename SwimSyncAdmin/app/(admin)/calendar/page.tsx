"use client";

// The admin calendar — every lesson of every coach, at a glance, so a make-up
// slot can be found by colour and count.
//
// READ-ONLY BY CONSTRUCTION. This page, lib/calendarData.ts and every component
// under components/calendar/ perform no writes. Double-click (or Enter, or the
// pinned tooltip's link) opens /lessons/[classId]/[date], which is where
// attendance, substitutes and guest bookings are changed.
//
// NO DATE IN STATE (§7.95). The anchor date, view and filters live in the URL
// (`?view=&date=&location=&coach=`), so refresh/back keep position and a tab
// left open overnight does not carry yesterday's "today" — the Today button
// computes todayInSg() at click time, and a missing `date` param is derived
// per render, never stored.
//
// Composition only (Admin L-B): state + derivations in domain/useCalendar, data
// in dao/calendar.repo, markup in ui/CalendarBody. See docs/refactor/BATCH_B_PLAN.md.

import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useCalendar } from "./domain/useCalendar";
import { CalendarBody } from "./ui/CalendarBody";

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <CalendarInner />
    </Suspense>
  );
}

function CalendarInner() {
  const calendar = useCalendar();

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Every lesson of every coach. Hover for the roster, double-click to open a lesson."
      />
      <CalendarBody {...calendar} />
    </div>
  );
}
