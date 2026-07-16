# SwimSync — Monthly Invoice Runbook

How to generate and collect invoices each month. Invoicing on SwimSync is
**manual** (the free-tier cloud project has no cron), so the superadmin runs it
by hand on the 1st. Keep this handy — it's a recurring task and easy to slip on
the "bill the *previous* month" detail.

---

## TL;DR

> On/after the **1st**: finish marking last month's attendance → **admin.swimsync.sg → Invoices** →
> set **Billing month = LAST month** (change it — it defaults to *this* month) →
> **Generate Invoices** → **read the gap report** in the dialog → confirm →
> eyeball the results → tell parents to pay → mark **Paid** as money lands.

---

## Why it's manual

The app runs on a free Supabase/Vercel tier with no scheduled job (a paused free
project wouldn't fire one). So nothing generates invoices automatically — **you
click the button**. The "Automatic monthly generation" toggle on the Invoices
page is wired for a cron that isn't running on this plan, so treat it as inert:
you still generate manually every month.

> **If cron is ever switched on, read this first.** The billing function defaults
> its billing month from the server clock, which is **UTC** — 8 hours behind us.
> A job firing at 00:00 SGT on 1 Aug is still 31 Jul in UTC, so it would bill
> **June**, not July. The manual button is unaffected (it always sends an explicit
> month). Whoever wires the cron must pass `billing_month` explicitly.

---

## When

- Run on or **after the 1st of the month**, and always bill the **previous
  calendar month**.
  - On **1 Aug** → bill **July**. On **1 Sep** → bill **August**.
- Billing the previous month (not the current one) is deliberate: it guarantees
  lessons on the last day of the month are included.

---

## Before you generate — checklist

Billing is based on **actual attendance**, so make sure last month is complete:

- [ ] **Read the gap report in the confirm dialog** (step 4 below) — it lists any
      lesson with no attendance marked. This is the one check the app can do for
      you; the rest are judgement.
- [ ] Any trials are classified **Paid Trial** or **Free Trial** (not left as a bare trial).
- [ ] Any needed attendance corrections are done. (Correcting a billable → non-billable
      status *after* an invoice exists auto-issues a **credit note** applied to the next
      month — that's expected, not something to avoid.)

> **Finalize attendance first.** Once you generate, re-running for the same month
> **skips** parents who already have an invoice (no double-billing), so extra
> attendance marked *after* generating won't top up an existing invoice.

---

## Step-by-step

1. Log in to **https://admin.swimsync.sg** as the superadmin.
2. Open **Invoices** (left sidebar).
3. In the **Billing month** picker, select the **previous month**.
   ⚠️ It defaults to the *current* month — **you must change it** (e.g. on 1 Aug, set it to **Jul**).
4. Click **Generate Invoices**. A dialog checks every class's schedule against
   what's actually marked, and reports either:
   - ✅ **"All N classes fully marked"** → go ahead.
   - 🚩 **"Some lessons have no attendance marked"**, naming each class and the
     missing dates (e.g. *Saturday Beginners — 3 of 4 lessons marked · Missing:
     Sat, 18 Jul*). **Stop.** Cancel, get the coach to mark those lessons (they
     appear under **Unmarked Lessons** on the coach's Today tab), then come back.
     The button says **Generate anyway** — it won't block you, because a class
     that genuinely didn't run is a legitimate reason to proceed. But anything
     you skip here is **money you won't bill**, and you can't top up the invoice
     afterwards.

   Then confirm. Give it ~5–8 seconds (the billing function can cold-start).
   You'll see a toast like **"Created N invoice(s) for <month>."**

   > A lesson the coach never marked has **no record at all** — the invoice
   > engine can't miss it, because to the engine it never happened. That dialog
   > is the only thing that will tell you.
5. **Verify** in the list below: one row per parent for that month, each with
   **Gross / Credit / Net** and an **Outstanding** badge. Spot-check a couple
   against what you marked (billable lessons × class rate).

---

## After generating

- **Parents are emailed automatically** when their invoice is created — a branded,
  itemized "your invoice is ready" email (best-effort; it never blocks or fails
  generation). **Active in production since 2026-07-16** (function deployed + `RESEND_API_KEY`
  set). Watch `emails_sent` in the generate response and Resend → Emails on the first run.
  _(If a future function change is ever deployed without the secret, generation still works
  but sends nothing — fall back to your usual reminder.)_
- **Parents pay externally** via your PayNow QR — they see the invoice + QR in
  the app (`swimsync.sg`).
- **As payments arrive in your bank**, mark each invoice **Paid**:
  Invoices → find the row → **Mark Paid**. This stamps the paid time.

---

## Good to know / gotchas

- **Bill the previous month** — the picker defaults to the current month; always change it.
- **One invoice per parent per month**, covering *all* their children together.
  ⚠️ **Known bug (until fixed):** a parent with children in **two different classes** is
  currently billed for only **one** class — the other is silently dropped (BACKLOG →
  Billing). If any family has siblings in different classes, **verify that invoice by hand**
  before telling them to pay.
- **Only billable statuses count:** **Present** and **Paid Trial**. Absent,
  Cancelled (rain/coach), and Free Trial are excluded.
- **Credit auto-applies** (oldest first). An invoice fully covered by credit is
  created already marked **Paid**; the leftover credit carries to next month.
- **No double-billing:** re-running the same month skips parents who already have
  an invoice — so finalize attendance *before* generating. To *reduce* a bill
  after the fact, use an attendance edit (billable → non-billable), which issues
  a credit note; there's no "top-up" for adding lessons after invoicing.
- **No billable attendance = no invoice** for that parent that month (expected).
- If **Generate** errors (cold start / transient), just click it again — it's safe
  to retry (won't double-bill).

---

_Related: PRD §5.5–5.6 (billing & credit rules), §7.7 (invoice generation),
§10 (calculation logic); HANDOVER §11 (cloud setup)._
