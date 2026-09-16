"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useInvoiceList } from "./domain/useInvoiceList";
import { useTenantBilling } from "./domain/useTenantBilling";
import { useUnclaimed } from "./domain/useUnclaimed";
import { useOrphans } from "./domain/useOrphans";
import { usePendingDebits } from "./domain/usePendingDebits";
import { useGenerate } from "./domain/useGenerate";
import { InvoiceToolbar } from "./ui/InvoiceToolbar";
import { InvoiceTable } from "./ui/InvoiceTable";
import { UnclaimedModal } from "./ui/UnclaimedModal";
import { OrphanReport } from "./ui/OrphanReport";
import { PendingDebits } from "./ui/PendingDebits";
import { GenerationPanel } from "./ui/GenerationPanel";
import { ConfirmGenerateModal } from "./ui/ConfirmGenerateModal";
import { BlockedLessonsModal } from "./ui/BlockedLessonsModal";
import { ReminderQueue } from "./ui/ReminderQueue";

export default function InvoicesPage() {
  // Each slice is one hook (docs/refactor/INVOICES_REFACTOR_PLAN.md). tenantId is
  // the shared spine the reports and generation read; the two cross-slice wires
  // (generation fills the unclaimed modal; the unclaimed settle writes genResult)
  // are threaded here in the compose layer, which is why useGenerate is created
  // after useUnclaimed and takes its setter.
  const list = useInvoiceList();
  const tenant = useTenantBilling();
  const { tenantId, isPlatformAdmin, businessName } = tenant;
  const unclaimed = useUnclaimed();
  const orphans = useOrphans(tenantId);
  const debits = usePendingDebits(tenantId);
  const generate = useGenerate({
    tenantId,
    setUnclaimed: unclaimed.setUnclaimed,
    afterGenerate: async () => {
      await list.load();
      if (tenantId) await debits.loadPendingDebits(tenantId);
    },
  });

  // Resolve the tenant, then load its tenant-scoped reports. The dependent loads
  // chain off the resolved id (which loadTenant returns) rather than racing the
  // state update.
  useEffect(() => {
    tenant.loadTenant().then((tid) => {
      if (tid) {
        orphans.loadOrphans(tid);
        debits.loadPendingDebits(tid);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`Total outstanding: S$${list.totalOutstanding.toFixed(2)}`}
      />

      {/* A platform admin belongs to no tenant, so there is no business for
          these controls to act on. Said plainly rather than leaving a button
          that looks live and 400s — the tenant switcher arrives in phase 3. */}
      {isPlatformAdmin && !tenantId && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Platform admin.</strong> Invoice generation runs for one
          business at a time, and your account is not attached to one. Sign in
          as that business&rsquo;s admin to generate their invoices.
        </div>
      )}

      {/* Lessons recorded into an already-BILLED month (Wave 4). A STANDING
          section, deliberately not a modal or a one-time warning: the failure
          mode is silence, and a message that can be dismissed is gone. Each
          line persists until a settlement covers it. No bulk action, same as
          the unclaimed modal — settling is a decision about money. */}
      <PendingDebits
        pendingDebits={debits.pendingDebits}
        writingOff={debits.writingOff}
        pendingDebitError={debits.pendingDebitError}
        onWriteOff={debits.handleWriteOff}
      />

      <OrphanReport
        orphans={orphans.orphans}
        orphanAmount={orphans.orphanAmount}
        setOrphanAmount={orphans.setOrphanAmount}
        orphanSettling={orphans.orphanSettling}
        orphanError={orphans.orphanError}
        onSettle={orphans.handleSettleOrphan}
      />

      <GenerationPanel
        genMonth={generate.genMonth}
        setGenMonth={generate.setGenMonth}
        latestBillableMonth={generate.latestBillableMonth}
        generating={generate.generating}
        onGenerate={generate.openConfirm}
        genResult={generate.genResult}
        autoEnabled={tenant.autoEnabled}
        togglingAuto={tenant.togglingAuto}
        onToggleAuto={tenant.handleToggleAuto}
        runDay={tenant.runDay}
        setRunDay={tenant.setRunDay}
        savingRunDay={tenant.savingRunDay}
        onSaveRunDay={tenant.handleSaveRunDay}
        paynowUen={tenant.paynowUen}
        setPaynowUen={tenant.setPaynowUen}
        paynowMobile={tenant.paynowMobile}
        setPaynowMobile={tenant.setPaynowMobile}
        onSavePaynow={tenant.handleSavePaynow}
        paynowSaved={tenant.paynowSaved}
      />

      <UnclaimedModal
        unclaimed={unclaimed.unclaimed}
        genMonth={generate.genMonth}
        settling={unclaimed.settling}
        settleAmount={unclaimed.settleAmount}
        setSettleAmount={unclaimed.setSettleAmount}
        settleError={unclaimed.settleError}
        onSettle={(u, kind, amount) =>
          unclaimed.handleSettle(u, kind, amount, generate.genMonth, generate.setGenResult)
        }
        onClose={unclaimed.close}
      />

      <BlockedLessonsModal
        blockedLessons={generate.blockedLessons}
        onClose={() => generate.setBlockedLessons([])}
      />

      <ConfirmGenerateModal
        open={generate.showConfirm}
        genMonth={generate.genMonth}
        checkingCoverage={generate.checkingCoverage}
        coverageError={generate.coverageError}
        coverage={generate.coverage}
        hasGaps={generate.hasGaps}
        onClose={() => generate.setShowConfirm(false)}
        onConfirm={() => {
          generate.setShowConfirm(false);
          generate.handleGenerate();
        }}
      />

      <InvoiceToolbar
        searchField={list.searchField}
        setSearchField={list.setSearchField}
        search={list.search}
        setSearch={list.setSearch}
        statusFilter={list.statusFilter}
        setStatusFilter={list.setStatusFilter}
        exportDisabled={list.visible.length === 0}
        remindersDisabled={list.invoices.every((i) => i.status !== "outstanding")}
        onExportCsv={list.handleExportCsv}
        onOpenQueue={() => list.setQueueOpen(true)}
        exportNotice={list.exportNotice}
      />

      <ReminderQueue
        open={list.queueOpen}
        onClose={() => list.setQueueOpen(false)}
        rows={list.invoices
          .filter((i) => i.status === "outstanding")
          .map((i) => ({
            id: i.id,
            parent_name: i.parent_name,
            student_names: i.student_names,
            net_amount: i.net_amount,
            reference_number: i.reference_number,
            reminded_at: i.reminded_at,
            wa_number: i.wa_number,
            raw_phone: i.raw_phone,
          }))}
        onOpenChat={(id) => {
          const inv = list.invoices.find((i) => i.id === id);
          if (inv) list.handleWhatsApp(inv, businessName);
        }}
      />

      <InvoiceTable
        loading={list.loading}
        loadError={list.loadError}
        capped={list.capped}
        searchField={list.searchField}
        search={list.search}
        visible={list.visible}
        sort={list.sort}
        markingPaid={list.markingPaid}
        copiedLink={list.copiedLink}
        onMarkPaid={list.handleMarkPaid}
        onWhatsApp={(inv) => list.handleWhatsApp(inv, businessName)}
        onCopyLink={list.copyLink}
      />
    </div>
  );
}
