-- 석암 디지털새싹 모집/운영 관리 앱 초기 스키마
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.

create extension if not exists "pgcrypto";

-- 1) 프로그램 마스터
create table if not exists saessak_programs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  schedule    text,
  location    text,
  grade_min   int  not null default 1,
  grade_max   int  not null default 6,
  capacity    int  not null default 20,
  instructors text,
  is_open     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 2) 신청 내역
create table if not exists saessak_applications (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references saessak_programs(id) on delete cascade,
  student_name    text not null,
  grade           int,
  class_no        int,
  guardian_name   text,
  guardian_phone  text,
  student_phone   text,
  motivation      text,
  privacy_agreed  boolean not null default false,
  status          text not null default 'applied'
                  check (status in ('applied', 'selected', 'waiting', 'cancelled')),
  source          text not null default 'online'
                  check (source in ('online', 'manual')),
  submitted_at    timestamptz not null default now(),
  display_order   int,
  created_at      timestamptz not null default now()
);

create index if not exists idx_saessak_apps_program on saessak_applications(program_id);
create index if not exists idx_saessak_apps_submitted on saessak_applications(submitted_at);
create index if not exists idx_saessak_apps_status on saessak_applications(status);

-- 같은 프로그램에 (학생이름 + 보호자연락처) 중복 방지
create unique index if not exists uq_saessak_apps_dedup
  on saessak_applications(program_id, student_name, guardian_phone)
  where status <> 'cancelled';
