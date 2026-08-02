# SwimSync — Fee-Free Payment Collection: Dynamic PayNow QR, WhatsApp Reminders, Reconciliation

_Drafted 2026-08-02. Status: **DESIGN — decisions locked with the user 2026-08-02**;
nothing built yet. The economic constraint is the design: swim-coaching margins cannot
absorb a percentage fee, so **no payment party ever sits between parent and coach** —
SwimSync relays payment information and never touches funds (which also keeps it outside
Payment Services Act licensing; the First Schedule excludes pure technical relays)._

Research base (2026-08-02, two web-research passes): PayNow gateway fees are actually
0.65–1.3% (HitPay 0.65% + S$0.30, Stripe 1.3%), not the feared 2%; the PayNow QR format
is **open** (EMVCo merchant-presented QR — amount + reference embeddable and lockable,
mature open-source JS generators exist, no bank partnership needed); wa.me click-to-chat
links are free, ToS-clean, and work from a desktop browser via WhatsApp Web; Meta's
Cloud API prices utility templates to SG at ≈S$0.02/message; unofficial WhatsApp
automation (Baileys, whatsapp-web.js) carries real, enforced ban risk against the
sender's own number.

---

## 1. The model (decisions locked with the user, 2026-08-02)

| Decision | Answer |
|---|---|
| Payment rails | **PayNow, parent's bank app → tenant's own account.** No gateway, no percentage, SwimSync never in the money path |
| QR | **Dynamic per-invoice QR**, generated client-side from the tenant's PayNow proxy + the invoice's amount + reference, amount **locked** (EMVCo editable=false). No uploaded QR image involved — the QR is a computed payload, not a stored asset |
| PayNow proxy | Tenant admin enters **UEN or mobile number** in settings (text fields, not an image). **UEN takes priority** when both exist: PayNow Corporate guarantees the reference lands on the recipient's statement; a personal mobile proxy collects fine but reference pass-through is bank-dependent (best-effort). The existing static `tenants.paynow_qr_url` stays as a fallback display only |
| Reference code | Unique per invoice, short (EMVCo Tag 62 bill number — keep ≤25 chars), shown as text on the page and embedded in the QR. Format settled at plan time |
| Invoice page | **Tokenized public link** on swimsync.sg — read-only single-invoice view, no login (the app is web-first; parents may have no session on the phone that opens the link). ≥128-bit crypto-random token; revocable/regenerable per invoice; `noindex`; link-preview metadata carries no amounts or names ("SwimSync invoice" only); data served by one rate-limited SECURITY DEFINER RPC keyed by token — `anon` EXECUTE is **deliberate here and only here** (§7.39 posture: revoke everywhere else, grant dump verified on deploy) |
| Same-phone scan wrinkle | You can't scan a QR displayed on the phone you're holding. The page gets a **"Save QR image"** button + one-line instruction (DBS/OCBC/UOB all scan from gallery), plus amount and reference as selectable text for manual entry |
| WhatsApp channel | **wa.me click-to-chat links only** — S$0, no approval, no ban risk; the message pre-fills and the admin presses Send. **Unofficial automation is permanently out** (it risks banning the coach's own number — for a private coach that number is the business) |
| Reminder UX | Per-invoice **WhatsApp button** + a **click-through queue** over unpaid invoices: each row's button opens the next pre-filled chat in a new tab, the row is stamped *reminded on \<date\>*. One press of Send per parent — that press is WhatsApp's anti-spam boundary and cannot legitimately be removed |
| Message content | Personalized text: child name(s), billing month, amount, the tokenized invoice link. Text only — a wa.me link cannot attach an image; the link carries the QR |
| Validation lane 1 (ship first) | Parent taps **"I've paid"** on the invoice (timestamped claim) → admin sees the claim and confirms with one tap (the existing mark-paid path). The reference makes the payment identifiable even when the payer's bank name differs from the family's |
| Validation lane 2 (later) | **Bank statement CSV upload → auto-match** on reference, falling back to amount+date; exceptions flagged for the admin, matches applied only on approval. Already called out in BACKLOG as "the 10% that delivers 80% of the value" of auto-detection |
| Bulk one-click sends | **BACKLOG, not now** — Meta Cloud API utility templates (≈S$0.02/msg ≈ S$1–5/month) whenever a tenant demands unattended sends; friction is the dedicated number + Meta verification + template approval, not the money |

Deliberately not doing: payment gateways (in tension with the product's economics —
already a rejected BACKLOG item), unofficial WhatsApp bridges (ban risk), bank-alert
email parsing (works — TrackLah pattern — but silently fragile; CSV is the robust
version), automatic reminder scheduling (no cron on the free tier; same gate as
auto-invoicing).

## 2. Phases

Each phase ships alone and is useful alone. Schema changes follow the house rules:
expand/contract, one in flight at a time, migrations authored on a `db/…` branch from
the root checkout.

- **Phase 0 — schema (expand).** `tenants.paynow_uen`, `tenants.paynow_mobile`
  (nullable text, advisory validation only); `invoices.public_token` (unique,
  crypto-random, backfilled for existing rows); `invoices.reminded_at`
  (timestamptz, null = never); `invoices.paid_claimed_at` (timestamptz — lane 1's
  claim). The token-lookup RPC with its deliberate `anon` grant.
- **Phase 1 — QR + public invoice page.** Settings fields (UEN/mobile, UEN-priority,
  `lib/sgPhone.ts`-style advisory validation); EMVCo payload generator (small,
  pure, unit-tested against known-good QR payloads); the tokenized page with QR,
  Save-QR-image button, amount + reference as text, paid/unpaid state.
- **Phase 2 — WhatsApp button + click-through queue.** Message template builder
  (pure function, tested); per-invoice button on the admin Invoices page; the
  unpaid-invoices queue view with reminded-at stamping.
- **Phase 3 — "I've paid".** Parent-side claim button (in-app and on the tokenized
  page is a plan-time decision), admin-side claim indicator + one-tap confirm.
- **Phase 4 — CSV reconciliation.** Upload → parse (DBS/OCBC/UOB export formats) →
  match on reference, fallback amount+date → admin approves → invoices marked paid
  via the existing path. Exceptions listed, never silently dropped.

## 3. Risks to carry into planning

1. **The engine is untouched.** Nothing here changes billing math — this feature is
   read-and-display plus mark-paid. Keep it that way; any pressure to touch
   `core.ts` is scope creep.
2. **The public RPC is the one new attack surface.** Rate-limit it, return the
   minimum the page needs, and verify the grant posture with a remote grant dump
   (§7.39) on deploy.
3. **QR correctness is a money path in the parent's hands.** A malformed payload
   fails loudly in the bank app (good); a *wrong amount* would not. The generator
   is pure and pinned by tests against externally-verified payloads before any UI
   uses it.
4. **`Alert.alert` is a no-op on RN-web** (§7.10) — every confirm/toast in the
   parent-facing flow uses `confirmAction`/Toast, as elsewhere.
5. **Phone numbers for wa.me** come from `profiles`/provisional contact columns —
   the queue must degrade visibly (row says "no number", never a broken link) and
   reuse `lib/sgPhone.ts` normalization for the E.164 conversion.
