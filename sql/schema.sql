-- ============================================================================
-- FEES MANAGEMENT SYSTEM — SUPABASE SCHEMA
-- ============================================================================
-- Run this entire file in the Supabase SQL editor (Project → SQL Editor → New
-- query) once, on a fresh project. Safe to re-run: guarded with IF NOT EXISTS
-- / OR REPLACE wherever possible.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. CLASSES
-- ----------------------------------------------------------------------------
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  class_name text not null,
  fee_type text not null check (fee_type in ('Monthly', 'Yearly')),
  fee_amount numeric(10,2) not null check (fee_amount >= 0),
  academic_year text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_name, academic_year)
);

-- ----------------------------------------------------------------------------
-- 2. STUDENTS
-- ----------------------------------------------------------------------------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,           -- human-readable ID e.g. STU0001
  student_name text not null,
  parent_name text not null,
  class_id uuid references classes(id) on delete set null,
  student_phone text,
  parent_phone text,
  blood_group text,
  admission_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_students_class on students(class_id);
create index if not exists idx_students_active on students(active);
create index if not exists idx_students_name on students using gin (to_tsvector('simple', student_name));

-- ----------------------------------------------------------------------------
-- 3. FEE RECORDS
-- ----------------------------------------------------------------------------
create table if not exists fee_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  academic_year text not null,
  month text,                                  -- e.g. 'January' — null for Yearly fee_type
  fee_type text not null check (fee_type in ('Monthly', 'Yearly')),
  fee_amount numeric(10,2) not null default 0,
  amount_paid numeric(10,2) not null default 0 check (amount_paid >= 0),
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  balance_amount numeric(10,2) not null default 0,
  payment_status text not null default 'Pending' check (payment_status in ('Pending','Partially Paid','Paid')),
  paid_date date,
  payment_method text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One monthly record per student/year/month, one yearly record per student/year
create unique index if not exists uq_fee_monthly
  on fee_records (student_id, academic_year, month)
  where fee_type = 'Monthly';

create unique index if not exists uq_fee_yearly
  on fee_records (student_id, academic_year)
  where fee_type = 'Yearly';

-- Migration safety net: adds the column if this script is re-run against a
-- database created before the Discount Amount feature existed.
alter table fee_records add column if not exists discount_amount numeric(10,2) not null default 0;

create index if not exists idx_fee_student on fee_records(student_id);
create index if not exists idx_fee_status on fee_records(payment_status);
create index if not exists idx_fee_year_month on fee_records(academic_year, month);

-- ----------------------------------------------------------------------------
-- 4. AUTO-CALCULATION TRIGGER (balance + payment status + timestamps)
-- ----------------------------------------------------------------------------
create or replace function fee_records_before_write()
returns trigger as $$
begin
  new.discount_amount := coalesce(new.discount_amount, 0);

  if new.discount_amount > new.fee_amount then
    new.discount_amount := new.fee_amount;
  end if;

  if new.amount_paid + new.discount_amount > new.fee_amount then
    new.amount_paid := new.fee_amount - new.discount_amount;
  end if;

  new.balance_amount := round((new.fee_amount - new.amount_paid - new.discount_amount)::numeric, 2);

  if (new.amount_paid + new.discount_amount) <= 0 then
    new.payment_status := 'Pending';
  elsif new.balance_amount <= 0 then
    new.payment_status := 'Paid';
    if new.paid_date is null then
      new.paid_date := current_date;
    end if;
  else
    new.payment_status := 'Partially Paid';
  end if;

  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fee_records_before_write on fee_records;
create trigger trg_fee_records_before_write
  before insert or update on fee_records
  for each row execute function fee_records_before_write();

-- classes/students updated_at bookkeeping
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_classes_touch on classes;
create trigger trg_classes_touch before update on classes
  for each row execute function touch_updated_at();

drop trigger if exists trg_students_touch on students;
create trigger trg_students_touch before update on students
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. AUTOMATIC FEE GENERATION FUNCTIONS
-- ----------------------------------------------------------------------------

-- These are the ONLY paths in the whole system that insert fee_records.
-- Nothing else (student creation, class edits, etc.) generates fee records
-- automatically — generation happens exclusively via the "Generate Fees for
-- a Period" action in the app, which calls these functions.

-- Drop older signatures from previous versions of this schema so the new
-- 3-parameter versions below aren't left ambiguously overloaded.
drop function if exists generate_monthly_fees(text, text);
drop function if exists generate_yearly_fees(text);
drop function if exists generate_fees_for_student(uuid, text, text);

-- Generate one Monthly fee record for every active student in an active
-- Monthly-fee class, for the given academic year + month.
--   p_student_id = null  -> generate for every eligible active student
--   p_student_id = <id>  -> generate for that one student only (still
--                           subject to all the same eligibility rules)
-- Rules enforced:
--   - only active students in an active Monthly-fee class
--   - never duplicates an existing record for the same student/year/month
--   - SKIPS a student entirely if they already have a Yearly fee record for
--     this academic year (a student cannot be on both plans at once)
create or replace function generate_monthly_fees(p_academic_year text, p_month text, p_student_id uuid default null)
returns integer as $$
declare
  v_count integer;
begin
  insert into fee_records (student_id, academic_year, month, fee_type, fee_amount, amount_paid, discount_amount)
  select s.id, p_academic_year, p_month, 'Monthly', c.fee_amount, 0, 0
  from students s
  join classes c on c.id = s.class_id
  where s.active = true
    and c.active = true
    and c.fee_type = 'Monthly'
    and c.academic_year = p_academic_year
    and (p_student_id is null or s.id = p_student_id)
    and not exists (
      select 1 from fee_records fr
      where fr.student_id = s.id
        and fr.academic_year = p_academic_year
        and fr.month = p_month
    )
    and not exists (
      select 1 from fee_records fr2
      where fr2.student_id = s.id
        and fr2.academic_year = p_academic_year
        and fr2.fee_type = 'Yearly'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql;

-- Generate one Yearly fee record for every active student in an active
-- Yearly-fee class, for the given academic year.
--   p_student_id = null  -> generate for every eligible active student
--   p_student_id = <id>  -> generate for that one student only
create or replace function generate_yearly_fees(p_academic_year text, p_student_id uuid default null)
returns integer as $$
declare
  v_count integer;
begin
  insert into fee_records (student_id, academic_year, month, fee_type, fee_amount, amount_paid, discount_amount)
  select s.id, p_academic_year, null, 'Yearly', c.fee_amount, 0, 0
  from students s
  join classes c on c.id = s.class_id
  where s.active = true
    and c.active = true
    and c.fee_type = 'Yearly'
    and c.academic_year = p_academic_year
    and (p_student_id is null or s.id = p_student_id)
    and not exists (
      select 1 from fee_records fr
      where fr.student_id = s.id
        and fr.academic_year = p_academic_year
        and fr.fee_type = 'Yearly'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY — only authenticated admins may read/write
-- ----------------------------------------------------------------------------
alter table classes enable row level security;
alter table students enable row level security;
alter table fee_records enable row level security;

drop policy if exists "admins full access classes" on classes;
create policy "admins full access classes" on classes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "admins full access students" on students;
create policy "admins full access students" on students
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "admins full access fee_records" on fee_records;
create policy "admins full access fee_records" on fee_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 7. CREATE YOUR FIRST ADMIN
-- ----------------------------------------------------------------------------
-- Go to Authentication → Users in the Supabase dashboard and click
-- "Add user" to create an admin login (email + password). Do NOT enable
-- public sign-ups in this app — the login page only calls signInWithPassword.
-- ============================================================================
