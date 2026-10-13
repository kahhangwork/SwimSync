// The Invoices tab: the empty state, or one card per invoice with Pay and I've paid.
// Moved from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-G).
// Restyled in UI restyle step 3.1 (DESIGN.md's Pay-First Rule): Pay via PayNow is the
// full-width primary, "I've paid" a text link beneath it, and a claimed invoice
// carries an Info "Claimed" tag. The money lines are the row's own fields, printed
// as-is in Ink — nothing is recomputed here (plan Phase 3 ⚠ RISK 2).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import { invoiceLabel } from "@/lib/invoiceLabel";
import { formatBillingMonth } from "../domain/billingFormat";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

function MoneyRow({ label, amount, strong = false }: { label: string; amount: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text className={strong ? "text-body font-semibold text-ink" : "text-body text-ink-secondary"}>
        {label}
      </Text>
      <Text className={strong ? "text-body font-semibold text-ink" : "text-body text-ink"} style={TABULAR}>
        {amount}
      </Text>
    </View>
  );
}

export function InvoicesTab(p: Pick<Billing, "invoices" | "claimPaid" | "claimingId">) {
  const { invoices, claimPaid, claimingId } = p;
  return (
    <>
      {
        invoices.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="receipt-outline" size={40} color="#6b6b6b" />
            <Text className="text-body text-ink-secondary mt-3">No invoices yet</Text>
          </View>
        ) : (
          invoices.map((inv) => {
            const outstanding = inv.status === "outstanding";
            // A claim is a STATEMENT, never a status change (PRD §7.21): the
            // invoice stays outstanding until the coach confirms it. The tag
            // says who it is waiting on — DESIGN.md's Claimed Is Its Own State.
            const claimed = outstanding && !!inv.paid_claimed_at;
            return (
            /* The Surface is the OUTER element and the action row below is a
               SIBLING of the touchable, not nested inside it — so the
               buttons cannot depend on responder semantics to work.

               ⚠ AND THE FEARED BUG DOES NOT EXIST — MEASURED, 2026-08-08.
               This was built to prevent a double-fire: `confirmAction` is a
               synchronous, blocking `window.confirm` on RN-web
               (lib/confirm.ts), so a press that ALSO bubbled to the card
               would run the RPC and then navigate, landing the parent on
               the detail screen while the optimistic patch and success
               toast applied to a screen they just left. The nesting was
               then deliberately reintroduced and driven:
               verify-parent-pay-claim.mjs still scored 16/16. React
               Native's responder system grants the responder to the
               INNERMOST view and does not propagate to ancestor
               Touchables, so nested presses do not double-fire here.
               This layout is kept because it reads honestly and does not
               rely on that behaviour surviving an RN-web upgrade — but do
               not repeat the double-fire claim as fact. */
            <Surface key={inv.id}>
              <TouchableOpacity
                onPress={() => router.push(`/(parent)/billing/invoice/${inv.id}`)}
                activeOpacity={0.8}
              >
                <View className="flex-row items-start justify-between gap-3 mb-3">
                  <View className="flex-1">
                    <Text className="text-headline font-semibold text-ink">
                      {formatBillingMonth(inv.billing_month)}
                    </Text>
                    {/* WHO is asking for money. With children at two
                        businesses a parent gets two invoices in the same
                        month, and without this they are indistinguishable. */}
                    <Text className="text-body-secondary text-ink-secondary mt-0.5">
                      {inv.business_name}
                    </Text>
                    {/* The reference the QR, the WhatsApp reminder and the
                        bank statement all carry — not a UUID fragment, which
                        gave the parent a different number to the one on their
                        own payment. */}
                    <Text selectable className="text-label text-ink-muted mt-0.5">
                      {invoiceLabel(inv)}
                    </Text>
                  </View>
                  <StatusBadge
                    status={claimed ? "Claimed" : outstanding ? "Outstanding" : "Paid"}
                    size="sm"
                  />
                </View>

                {/* Plain Words (DESIGN.md): what the lessons cost, what was
                    taken off, what is left to pay — never Gross / Net. */}
                <View className="gap-1">
                  <MoneyRow label="Lessons" amount={`S$${inv.gross_amount.toFixed(2)}`} />
                  {inv.package_applied > 0 && (
                    <MoneyRow label="Package" amount={`−S$${inv.package_applied.toFixed(2)}`} />
                  )}
                  {inv.credit_applied > 0 && (
                    <MoneyRow label="Credit" amount={`−S$${inv.credit_applied.toFixed(2)}`} />
                  )}
                  <View className="pt-2 mt-1 border-t border-divider">
                    <MoneyRow
                      label={outstanding ? "To pay" : "Total"}
                      amount={`S$${inv.net_amount.toFixed(2)}`}
                      strong
                    />
                  </View>
                </View>

                <View className="flex-row items-center justify-end mt-3 gap-1">
                  <Text className="text-body-secondary font-semibold text-primary">View Details</Text>
                  <Ionicons name="chevron-forward" size={14} color="#2563eb" />
                </View>
              </TouchableOpacity>

              {/* Paying is the single action this product most wants a
                  parent to take, and until now it was two taps deep behind
                  "View Details" — while the public tokenized page the
                  WhatsApp reminder links to put both controls in front of
                  them immediately. The parent who opened the APP got the
                  slower path; this removes that inversion. */}
              {outstanding && (
                <View className="mt-3 border-t border-divider pt-3">
                  <Button
                    label="Pay via PayNow"
                    onPress={() =>
                      router.push(
                        `/(parent)/billing/paynow?invoiceId=${inv.id}`
                      )
                    }
                  />
                  {/* A claim is one-way and idempotent, so once made the
                      link is replaced rather than disabled. Pay stays
                      available either way — a claimed invoice is still
                      unpaid until the coach confirms it. Pay-First: the
                      claim is a text link UNDER the primary, never an
                      equal button beside it. */}
                  {inv.paid_claimed_at ? (
                    <Text className="text-body-secondary text-ink-secondary text-center mt-3">
                      You&apos;ve told your coach this is paid — they&apos;ll
                      confirm it.
                    </Text>
                  ) : (
                    <Button
                      variant="link"
                      label={claimingId === inv.id ? "Saving…" : "I've paid"}
                      onPress={() => claimPaid(inv)}
                      className="items-center"
                    />
                  )}
                </View>
              )}
            </Surface>
            );
          })
        )
      }
    </>
  );
}
