-- 내 신청 조회/취소/수정용 PIN 해시 컬럼
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.
-- IF NOT EXISTS 가드, 기존 데이터에 영향 없음.

alter table saessak_applications
  add column if not exists pin_hash text;

-- 조회 시 (guardian_phone + student_name) 인덱스 보강
create index if not exists idx_saessak_apps_guardian_phone
  on saessak_applications(guardian_phone);
