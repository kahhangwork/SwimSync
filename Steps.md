# Building SwimSync Steps
## 1. Set Up Supabase (1–2 days)
This is the foundation everything else depends on.
- Create a project at supabase.com
- Design and create the database tables (parents, children, coaches, classes, enrollments, attendance, invoices, credit_notes)
- Set up Row Level Security (RLS) policies for parent/coach/admin data isolation
- Configure Supabase Auth with email/password

## 2. Wire Up Authentication (1–2 days)
- Replace the demo login buttons in the mobile app and admin panel with real Supabase Auth calls
- Implement role detection on sign-in (parent vs coach vs superadmin) to route users correctly
- Add protected route guards so unauthenticated users can't access screens

## 3. Connect the Mobile App to Supabase (1–2 weeks)
Work screen by screen, replacing placeholder data with real queries:

- Parent registration → creates a parents row
- Add child → inserts into children
- Superadmin assignment → creates an enrollments row
- Coach attendance marking → inserts/updates attendance rows
- Parent billing view → reads invoices and credit_notes

## 4. Connect the Admin Panel to Supabase (3–5 days)
- Same process for the web panel — each table view becomes a real Supabase query with working buttons (Assign, Mark Paid, Create Class, etc.)

## 5. Invoice Generation Logic (2–3 days)
- Write a Supabase Edge Function that generates monthly invoices from attendance records
- Schedule it with pg_cron to run on the 1st of each month
- Write a second Edge Function/trigger that auto-creates a credit note when attendance is corrected after invoicing

## 6. PayNow QR Upload (1 day)
- Set up a Supabase Storage bucket for QR images
- Wire the upload button in the Coach settings screen and Admin coaches page to actually upload files

## 7. Testing & Polish (ongoing)
- Test the full flow end-to-end: parent registers → admin assigns → coach marks attendance → invoice generates → parent pays
- Handle edge cases from Section 11 of the PRD (first month proration, cancelled lessons, trial lessons, etc.)