// The tokenized public PACKAGE-OFFER page — where a parent lands from the
// WhatsApp/email renewal link, with or without a session (PUBLIC_PATHS in
// app/_layout.tsx). The package mirror of invoice/[token].tsx.
//
// Data comes from the public-package edge function (the 128-bit token in the
// URL is the whole access control); the PayNow QR is computed CLIENT-SIDE from
// that response via lib/paynow — no image is stored anywhere. The QR + "I've
// paid" appear ONLY while the offer is pending (RISK 5): a stale link for a
// superseded / already-active offer must not present a payable QR.
//
// Composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-G): the load, Save QR
// and the claim live in features/public-package/domain/usePublicPackage (the edge
// function calls in …/dao — content-type only, plan ⚠ R2), markup in …/ui.

import { ScrollView } from "react-native";
import { usePublicPackage } from "@/features/public-package/domain/usePublicPackage";
import { formatDate } from "@/features/public-package/domain/formatDate";
import { LoadingView } from "@/features/public-package/ui/LoadingView";
import { NotFoundView } from "@/features/public-package/ui/NotFoundView";
import { PageHeader } from "@/features/public-package/ui/PageHeader";
import { OfferCard } from "@/features/public-package/ui/OfferCard";
import { Footer } from "@/features/public-package/ui/Footer";

export default function PublicPackagePage() {
  const { state, pkg, qrDataUrl, saveQr, claiming, claimPaid } = usePublicPackage();

  if (state === "loading") {
    return <LoadingView />;
  }

  if (state === "not_found" || !pkg) {
    return <NotFoundView />;
  }

  const active = pkg.status === "active";
  const pending = pkg.status === "pending";
  const claimed = pending && pkg.paid_claimed_at !== null;
  const validUntil = formatDate(pkg.valid_until_preview);
  const startDate = formatDate(pkg.start_date);

  return (
    <ScrollView
      className="flex-1 bg-sky-50"
      contentContainerClassName="flex-grow px-6 py-10 max-w-xl w-full mx-auto"
    >
      <PageHeader pkg={pkg} />

      <OfferCard pkg={pkg} startDate={startDate} validUntil={validUntil} active={active} pending={pending} qrDataUrl={qrDataUrl} saveQr={saveQr} claimed={claimed} claiming={claiming} claimPaid={claimPaid} />

      <Footer />
    </ScrollView>
  );
}
