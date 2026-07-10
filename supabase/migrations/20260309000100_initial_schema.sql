-- ============================================================
-- SwimSync — Initial Schema
-- Enums + 14 core tables. RLS is enabled here; policies are
-- defined in 20260309000600_rls_policies.sql.
-- ============================================================

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('parent', 'coach', 'superadmin');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other');
CREATE TYPE swimming_ability AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE assignment_status AS ENUM ('unassigned', 'assigned', 'inactive');
CREATE TYPE day_of_week AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
CREATE TYPE session_status AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'cancelled_rain', 'cancelled_coach', 'trial_paid', 'trial_free');
CREATE TYPE invoice_status AS ENUM ('outstanding', 'paid');

-- ------------------------------------------------------------
-- 1. PROFILES  (links to Supabase Auth users)
-- ------------------------------------------------------------

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  role        user_role NOT NULL,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. COACHES
-- ------------------------------------------------------------

CREATE TABLE coaches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  paynow_qr_url   TEXT,
  bio             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. PARENTS
-- ------------------------------------------------------------

CREATE TABLE parents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  credit_balance  NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 4. STUDENTS
-- ------------------------------------------------------------

CREATE TABLE students (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         TEXT NOT NULL,
  date_of_birth     DATE,
  age               INTEGER,
  gender            gender_type,
  swimming_ability  swimming_ability,
  notes             TEXT,
  assignment_status assignment_status NOT NULL DEFAULT 'unassigned',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Who created this profile. Defaults to the calling user so a parent
  -- can read/update the row they just inserted before the
  -- parent_students link exists (needed for insert().select() in the app).
  created_by        UUID DEFAULT auth.uid() REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. PARENT_STUDENTS (junction)
-- ------------------------------------------------------------

CREATE TABLE parent_students (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_id, student_id)
);

-- ------------------------------------------------------------
-- 6. CLASSES
-- ------------------------------------------------------------

CREATE TABLE classes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id          UUID NOT NULL REFERENCES coaches(id),
  title             TEXT NOT NULL,
  day_of_week       day_of_week NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  location_name     TEXT NOT NULL,
  location_address  TEXT,
  price_per_lesson  NUMERIC(10, 2) NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. STUDENT_CLASS_ENROLMENTS
-- ------------------------------------------------------------

CREATE TABLE student_class_enrolments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id),
  class_id      UUID NOT NULL REFERENCES classes(id),
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unenrolled_at TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Only one active enrolment per student at a time
CREATE UNIQUE INDEX one_active_enrolment_per_student
  ON student_class_enrolments (student_id)
  WHERE is_active = TRUE;

-- ------------------------------------------------------------
-- 8. LESSON_SESSIONS
-- ------------------------------------------------------------

CREATE TABLE lesson_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID NOT NULL REFERENCES classes(id),
  session_date  DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  status        session_status NOT NULL DEFAULT 'scheduled',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, session_date)
);

-- ------------------------------------------------------------
-- 9. ATTENDANCE
-- ------------------------------------------------------------

CREATE TABLE attendance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_session_id   UUID NOT NULL REFERENCES lesson_sessions(id),
  student_id          UUID NOT NULL REFERENCES students(id),
  status              attendance_status NOT NULL,
  marked_by           UUID NOT NULL REFERENCES profiles(id),
  marked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_by      UUID REFERENCES profiles(id),
  last_edited_at      TIMESTAMPTZ,
  edit_reason         TEXT,
  UNIQUE (lesson_session_id, student_id)
);

-- ------------------------------------------------------------
-- 10. INVOICES
-- ------------------------------------------------------------

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID NOT NULL REFERENCES parents(id),
  billing_month   CHAR(7) NOT NULL,        -- format: YYYY-MM
  gross_amount    NUMERIC(10, 2) NOT NULL,
  credit_applied  NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  net_amount      NUMERIC(10, 2) NOT NULL,
  status          invoice_status NOT NULL DEFAULT 'outstanding',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ,
  paid_marked_by  UUID REFERENCES profiles(id),
  UNIQUE (parent_id, billing_month)
);

-- ------------------------------------------------------------
-- 11. INVOICE_ITEMS
-- ------------------------------------------------------------

CREATE TABLE invoice_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES students(id),
  lesson_session_id   UUID NOT NULL REFERENCES lesson_sessions(id),
  attendance_status   attendance_status NOT NULL,
  amount              NUMERIC(10, 2) NOT NULL,
  class_title         TEXT NOT NULL,
  session_date        DATE NOT NULL
);

-- ------------------------------------------------------------
-- 12. CREDIT_NOTES
-- ------------------------------------------------------------

CREATE TABLE credit_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      TEXT NOT NULL UNIQUE,   -- e.g. CN-2026-0001
  parent_id             UUID NOT NULL REFERENCES parents(id),
  student_id            UUID NOT NULL REFERENCES students(id),
  invoice_id            UUID NOT NULL REFERENCES invoices(id),
  invoice_item_id       UUID NOT NULL REFERENCES invoice_items(id),
  lesson_session_id     UUID NOT NULL REFERENCES lesson_sessions(id),
  amount                NUMERIC(10, 2) NOT NULL,
  original_status       attendance_status NOT NULL,
  corrected_status      attendance_status NOT NULL,
  reason                TEXT,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_to_invoice_id UUID REFERENCES invoices(id),
  applied_at            TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- 13. PAYMENT_RECORDS
-- ------------------------------------------------------------

CREATE TABLE payment_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id),
  marked_by   UUID NOT NULL REFERENCES profiles(id),
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT
);

-- ------------------------------------------------------------
-- 14. AUDIT_LOG
-- ------------------------------------------------------------

CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID NOT NULL REFERENCES profiles(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Enable Row Level Security on every table.
-- With RLS enabled and no policies, tables are deny-all for the
-- anon/authenticated roles; the service_role key bypasses RLS.
-- Policies are added in 20260309000600_rls_policies.sql.
-- ------------------------------------------------------------

ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_class_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                ENABLE ROW LEVEL SECURITY;
