# SwimSync — Monthly Invoice Runbook

How to generate and collect invoices each month. Invoicing on SwimSync is
**manual** (the free-tier cloud project has no cron), so the business's admin runs it
by hand on the 1st. Keep this handy — it's a recurring task and easy to slip on
the "bill the *previous* month" detail.

---

## TL;DR

> On/after the **1st**: finish marking last month's attendance → **admin.swimsync.sg → Invoices** →
> set **Billing month = LAST month** (change it — it defaults to *this* month) →
> **Generate Invoices** → if it says lessons are unmarked, **get them marked and come
> back** (there is no override) → confirm → eyeball the results → tell parents to pay →
> mark **Paid** as money lands.

---

## Why it's manual

The app runs on a free Supabase/Vercel tier with no scheduled job (a paused free
project wouldn't fire one). So nothing generates invoices automatically — **you
click the button**. The "Automatic monthly generation" toggle on the Invoices
page is wired for a cron that isn't running on this plan, so treat it as inert:
you still generate manually every month.

> **Cron-default billing month is now timezone-correct.** The billing function
> derives its default month from the calendar date in the **app timezone**
> (`APP_TIMEZONE`, default `Asia/Singapore` — see
> `supabase/functions/generate-invoices/dates.ts`), not the UTC server clock. A
> job firing at 1am SGT on 1 Aug now correctly bills **July**. (This previously
> defaulted to the UTC month and would have billed June under cron — fixed.) The
> manual button is unaffected either way — it always sends an explicit month.

> **The automatic path now waits until a configurable day** —
> `app_settings.invoice_run_day`, **default 7**, editable on the Invoices page
> ("Generate automatic invoices from day _N_ of the following month", capped at
> 28 so it can still fire in February). If cron is ever switched on, a run
> before that day returns `before_run_day` and does nothing. Billing on the 1st
> was too early: the month's last lesson may not be marked yet, and a lesson
> marked *after* the parent's invoice exists is never added to it. **Manual
> generation ignores this setting entirely** — pressing the button is an
> explicit instruction and is never blocked by the schedule.

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

- [ ] **Every lesson is marked.** The app now *enforces* this: if any lesson in the month
      has no attendance, **generation is refused** and the dialog names the class and date
      (step 4 below). You cannot generate around it. The rest of this list is judgement.
- [ ] Any trials are classified **Paid Trial** or **Free Trial** (not left as a bare trial).
- [ ] Any needed attendance corrections are done. (Correcting a billable → non-billable
      status *after* an invoice exists auto-issues a **credit note** applied to the next
      month — that's expected, not something to avoid.)

> **Finalize attendance first.** Once you generate, re-running for the same month
> **skips** parents who already have an invoice (no double-billing), so extra
> attendance marked *after* generating won't top up an existing invoice.

---

## Step-by-step

1. Log in to **https://admin.swimsync.sg** as the **tenant admin** — the business whose
   invoices you are generating. *(Roles changed with multi-tenancy: `superadmin` split
   into `tenant_admin` and `platform_admin`. A **platform admin has no Generate button**,
   because generation runs for one business at a time — see PRD §4.3.)*
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
     **The Generate button is disabled — there is no "generate anyway".** That is
     deliberate: a lesson marked *after* an invoice exists can never be added to it,
     so billing around a gap loses that money permanently.
     Two ways forward, both legitimate:
     - **The lesson ran** → the coach marks it (it appears under **Unmarked Lessons**
       on their Today tab). Come back and generate.
     - **The lesson didn't run** → the coach marks everyone **Cancelled — rain** or
       **Cancelled — coach**. Non-billable, and it clears the block.
     - **A child has stopped coming** and is holding the class open → **Remove from
       class** on admin → Students (or the coach's roster). Lessons they already
       attended are still billed.

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
- **One invoice per parent per month**, covering *all* their children together —
  **including children in different classes**. (This was a real bug until
  2026-07-18: the engine created the invoice inside its per-class loop, so a
  family with siblings in two classes was billed for only one. Fixed; the
  engine now tallies every class before creating anything.)
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
- **A finished month gets "closed" (sealed).** When a run leaves every class
  marked, every parent invoiced and nothing failed, the month is recorded in
  `billing_periods` and later runs skip it with *"already_complete"*. The
  result message says **"This month is complete and now closed."** A month with
  unmarked attendance is deliberately **left open** so a later run can finish it.
  - **A month with nothing recorded is never closed.** Running generation before
    any attendance is marked reports *"No lessons are recorded … the month is
    still open"* and seals nothing. (Until 2026-07-18 it sealed such a month and
    reported "0 invoices — now closed", which locked the month out of billing
    entirely; that is what the empty-month guard now prevents.)
  - **If a month is closed by mistake** (e.g. a lesson surfaced afterwards),
    reopen it by deleting its row in the Supabase dashboard SQL editor:
    `DELETE FROM billing_periods WHERE billing_month = '2026-07' AND tenant_id = '<the business>';`
    *(the key is now `(tenant_id, billing_month)` — sealing is per business, so scope the
    delete or you reopen the month for everyone)*
    Then generate again. Note the existing invoices are **not** rewritten — the
    no-double-billing guard skips parents who already have one, so a lesson
    added after invoicing still needs a credit-note correction rather than a
    top-up.

---

_Related: PRD §5.5–5.6 (billing & credit rules), §7.7 (invoice generation),
§10 (calculation logic); HANDOVER §11 (cloud setup)._
