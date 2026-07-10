# SwimSync — Dummy Credentials (local dev)

These accounts are created by `supabase/seed.sql` every time you run
`supabase db reset`. They are **local dev only** — never reuse these
passwords in the cloud project.

| Role | Email | Password | Where to log in |
|------|-------|----------|-----------------|
| Superadmin | `superadmin@swimsync.test` | `password123` | Admin panel → http://localhost:3000 |
| Coach | `coach@swimsync.test` | `password123` | Mobile app (Coach) |
| Parent | *self-register in the app* | *you choose* | Mobile app (Parent) |

## Notes
- **Parents self-register** in the mobile app (the "Register" link on the
  Sign In screen). Registration only ever creates *parent* accounts by design.
- **Superadmin is web-only.** Logging in as superadmin on the mobile app
  shows an "Unrecognised role" alert — use it in the admin panel instead.
- The seed also creates one class: **Saturday Beginners** (Sat 10–11am,
  Buona Vista, $25/lesson), owned by the coach above.

## Golden-path test order
1. Mobile app → **Register** a parent → **Add Child**.
2. Admin panel (superadmin) → **Unassigned Children** → assign the child to
   *Saturday Beginners*.
3. Mobile app → log out → log in as the **coach** → mark attendance.

## Local service URLs
- Supabase Studio: http://127.0.0.1:54323
- Mailpit (captured emails): http://127.0.0.1:54324
- API: http://127.0.0.1:54321

## Reset to a clean slate
`supabase db reset` — re-applies all migrations + seed. Wipes test data
(parents/children/attendance you created) but always restores the two
seed accounts above.
