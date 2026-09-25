// The tokenized public invoice page — where a parent lands from the WhatsApp
// reminder link, with or without a session (isPublicPage in lib/publicRoutes.ts).
//
// Data comes from the public-invoice edge function (the 128-bit token in the
// URL is the whole access control); the PayNow QR is computed CLIENT-SIDE
// from that response via lib/paynow — no image is stored anywhere.
//
// You can't scan a QR on the phone you're viewing it on, so the page leads
// with "Save QR image" + the scan-from-gallery instruction (DBS/OCBC/UOB all
// support it), and always shows amount + reference as selectable text for
// manual entry.
//
// Composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-G): the load, Save QR
// and the claim live in features/public-invoice/domain/usePublicInvoice (the edge
// function calls in …/dao — content-type only, plan ⚠ R2), markup in …/ui.

import { ScrollView } from "react-native";
import { usePublicInvoice } from "@/features/public-invoice/domain/usePublicInvoice";
import { LoadingView } from "@/features/public-invoice/ui/LoadingView";
import { NotFoundView } from "@/features/public-invoice/ui/NotFoundView";
import { PageHeader } from "@/features/public-invoice/ui/PageHeader";
import { AmountCard } from "@/features/public-invoice/ui/AmountCard";
import { Footer } from "@/features/public-invoice/ui/Footer";

export default function PublicInvoicePage() {
  const { state, invoice, qrDataUrl, saveQr, claiming, claimPaid } = usePublicInvoice();

  if (state === "loading") {
    return <LoadingView />;
  }

  if (state === "not_found" || !invoice) {
    return <NotFoundView />;
  }

  const paid = invoice.status === "paid";
  const claimed = !paid && invoice.paid_claimed_at !== null;

  return (
    <ScrollView
      className="flex-1 bg-sky-50"
      contentContainerClassName="flex-grow px-6 py-10 max-w-xl w-full mx-auto"
    >
      <PageHeader invoice={invoice} />

      <AmountCard invoice={invoice} paid={paid} qrDataUrl={qrDataUrl} saveQr={saveQr} claimed={claimed} claiming={claiming} claimPaid={claimPaid} />

      <Footer />
    </ScrollView>
  );
}
