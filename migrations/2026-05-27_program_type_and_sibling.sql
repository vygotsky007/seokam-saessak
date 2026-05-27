-- 디지털새싹: 프로그램 유형(일반/다문화우대/형제우대) + 다문화 최소 보장 + 형제 동시 신청 묶음
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.
-- 모두 IF NOT EXISTS 가드로 작성, 기존 데이터에 영향 없음.

-- 1) saessak_programs: 유형 / 다문화 최소 보장 인원
alter table saessak_programs
  add column if not exists program_type text not null default 'general'
    check (program_type in ('general', 'multicultural', 'sibling'));

alter table saessak_programs
  add column if not exists multicultural_min int;

-- 2) saessak_applications: 다문화가정 여부 / 형제 묶음 UUID
alter table saessak_applications
  add column if not exists is_multicultural boolean not null default false;

alter table saessak_applications
  add column if not exists sibling_group_id uuid;

create index if not exists idx_saessak_apps_sibling on saessak_applications(sibling_group_id);
create index if not exists idx_saessak_apps_multicultural on saessak_applications(is_multicultural)
  where is_multicultural = true;
