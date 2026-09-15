// Generate renewal offers (slice 8) — the riskiest slice, extracted last.
// Stage 9 of PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 9 — activeProducts, businessName and setQueue are PARAMETERS from
// list-core, never re-derived here (the queue is rendered by the always-mounted
// WhatsAppQueue). The 25-line inline product-select onChange becomes ONE method
// changeCandidateProduct(i, productId) with the identical body. The sequential
// for-loop + per-iteration setGenProgress + swallow-and-continue catch {} (RISK
// 12), and the onClose `!genBusy && setGenModal(false)` guard, all move verbatim.

import { useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import {
  buildPackageOfferMessage,
  buildWaLink,
  toWaNumber,
} from "@/lib/waMessage";
import type { WaQueueRow } from "@/components/WhatsAppQueue";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import { pickOfferProduct } from "./packageOffers";
import { money } from "../constants";
import type { CandidateRow, Product } from "../types";

type QueueRow = WaQueueRow & { link: string | null };

type Shared = {
  activeProducts: Product[];
  businessName: string;
  setQueue: (rows: QueueRow[]) => void;
  setError: (e: string | null) => void;
  reload: () => void;
};

export function useGenerateOffers({
  activeProducts,
  businessName,
  setQueue,
  setError,
  reload,
}: Shared) {
  const [genModal, setGenModal] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<string | null>(null);

  /** Create ONE offer (create_package_offer), fire the best-effort offer email,
   *  and return the row for the WhatsApp queue. Throws on RPC failure so the
   *  caller can mark that family and continue (RISK 12: the RPC itself refuses a
   *  second open offer). */
  async function createOneOffer(c: CandidateRow): Promise<QueueRow> {
    const { data: offerId, error: err } = await rpc.createPackageOffer(
      c.parent_id,
      c.chosenProduct,
      c.chosenStart || todayInSg()
    );
    if (err || !offerId) {
      throw new Error(err?.message ?? "offer failed");
    }

    const { data: row } = await repo.loadOfferRow(offerId as string);

    // Best-effort email (never blocks the offer).
    rpc
      .invokePackageEmail({ type: "offered", package_id: offerId })
      .catch(() => {});

    const waNumber = toWaNumber(c.parent_phone);
    const payUrl = row?.public_token
      ? `${window.location.origin.replace("admin.", "")}/package/${row.public_token}`
      : "";
    const waLink =
      waNumber && row
        ? buildWaLink(
            waNumber,
            buildPackageOfferMessage({
              businessName,
              childrenNames: c.children ? c.children.split(", ") : [],
              packageName: row.name as string,
              lessons: Number(row.lesson_count),
              // RISK 7 — the WhatsApp price MUST equal the /package pay-page
              // headline and the QR: amount_payable, not the undiscounted worth.
              price: Number(row.amount_payable),
              reference: (row.reference_number as string) ?? "",
              link: payUrl,
            })
          )
        : null;

    return {
      id: offerId as string,
      parentName: c.parent_name,
      subtitle: c.children,
      meta: row
        ? `${row.name} · ${money(Number(row.amount_payable))}`
        : null,
      waNumber,
      rawPhone: c.parent_phone,
      openedStamp: null, // an offer is superseded, not re-chased (no reminded_at)
      link: waLink,
    };
  }

  /** Open the Generate-all preview: pull the candidate families and seed each
   *  row with its suggested product + start date, editable, ticked when a
   *  product could be pre-selected (Decision 6). */
  async function openGenerateAll() {
    setGenBusy(true);
    setError(null);
    const { data, error: err } = await rpc.renewalCandidates();
    setGenBusy(false);
    if (err) {
      setError("Could not load renewal candidates.");
      return;
    }
    const rows: CandidateRow[] = await Promise.all(
      ((data as any[]) ?? []).map(async (r) => {
        const suggested =
          r.suggested_product_id ??
          pickOfferProduct(
            r.original_product_id
              ? {
                  productId: r.original_product_id,
                  isActive: activeProducts.some(
                    (p) => p.id === r.original_product_id
                  ),
                }
              : null,
            null,
            null
          ) ??
          "";
        const start = suggested
          ? await rpc.fetchSuggestedStart(r.parent_id, suggested)
          : todayInSg();
        const preview = suggested
          ? await rpc.fetchPreviewPrice(r.parent_id, suggested)
          : null;
        return {
          parent_id: r.parent_id,
          parent_name: r.parent_name ?? "Unknown",
          parent_phone: r.parent_phone ?? null,
          children: r.children ?? null,
          package_name: r.package_name ?? null,
          lessons_left: r.lessons_left ?? null,
          expires_on: r.expires_on ?? null,
          expired_days_ago: r.expired_days_ago ?? null,
          original_product_id: r.original_product_id ?? null,
          suggested_product_id: suggested || null,
          has_open_offer: !!r.has_open_offer,
          chosenProduct: suggested,
          chosenStart: start,
          include: !!suggested && !r.has_open_offer,
          previewTotal: preview?.total ?? null,
          previewDiscount: preview?.discount ?? null,
          previewPayable: preview?.payable ?? null,
        };
      })
    );
    setCandidates(rows);
    setGenModal(true);
  }

  /** Confirm the preview: create each ticked offer sequentially (a failure marks
   *  that row and continues — RISK 12), then open the WhatsApp queue. */
  async function confirmGenerateAll() {
    setGenBusy(true);
    const created: QueueRow[] = [];
    const chosen = candidates.filter((c) => c.include && c.chosenProduct);
    for (let i = 0; i < chosen.length; i++) {
      setGenProgress(`Creating offer ${i + 1} of ${chosen.length}…`);
      try {
        created.push(await createOneOffer(chosen[i]));
      } catch {
        /* skip this family; the rest continue */
      }
    }
    setGenProgress(null);
    setGenBusy(false);
    setGenModal(false);
    setQueue(created);
    reload();
  }

  function toggleInclude(i: number, checked: boolean) {
    setCandidates((prev) =>
      prev.map((r, j) => (j === i ? { ...r, include: checked } : r))
    );
  }

  // ⚠ RISK 9 — the former inline product-select onChange, VERBATIM body.
  function changeCandidateProduct(i: number, productId: string) {
    const c = candidates[i];
    setCandidates((prev) =>
      prev.map((r, j) =>
        j === i
          ? { ...r, chosenProduct: productId, previewPayable: null,
              previewDiscount: null, previewTotal: null }
          : r
      )
    );
    // RISK 7 — re-price via preview_package_price, never
    // lesson_count × rate, so a referral discount shows.
    if (productId) {
      rpc.fetchPreviewPrice(c.parent_id, productId).then((pv) =>
        setCandidates((prev) =>
          prev.map((r, j) =>
            j === i
              ? { ...r, previewTotal: pv?.total ?? null,
                  previewDiscount: pv?.discount ?? null,
                  previewPayable: pv?.payable ?? null }
              : r
          )
        )
      );
    }
  }

  function changeCandidateStart(i: number, value: string) {
    setCandidates((prev) =>
      prev.map((r, j) => (j === i ? { ...r, chosenStart: value } : r))
    );
  }

  return {
    genModal,
    setGenModal,
    candidates,
    genBusy,
    genProgress,
    openGenerateAll,
    confirmGenerateAll,
    toggleInclude,
    changeCandidateProduct,
    changeCandidateStart,
  };
}

export type GenerateOffers = ReturnType<typeof useGenerateOffers>;
