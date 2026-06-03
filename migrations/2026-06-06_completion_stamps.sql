-- 2026-06-06: 이수 도장(마일리지) — 강사/관리자 전용
--
-- 이미 Supabase 에 생성된 completion_stamps 테이블을 문서화/재현용으로 기록한다.
-- (운영 DB 에는 이미 존재하므로 IF NOT EXISTS 로 안전하게 둔다. 신청 테이블은 무변경.)
--
-- 확인증 출력 화면에서 "도장 찍기(이수)" 시 1행 upsert, 취소 시 삭제.
-- unique (student_name, grade, class_no, program_id) — 학생+프로그램당 1개(중복 안 쌓임).
--   guardian_contact : 도장 수 집계 매칭용(연락처 있으면 이름+연락처 기준으로 학년 바뀌어도 누적).
--   program_name     : 출력 시 프로그램명 표시(프로그램 삭제돼도 남도록 스냅샷).
--   stamped_by       : '관리자' 또는 '강사(강사명)'.
-- 학부모 공개/내신청 화면엔 노출 안 함. RLS 는 서버 권한 체크로 대체 — 비활성화.

create table if not exists completion_stamps (
  id               uuid primary key default gen_random_uuid(),
  student_name     text not null,
  grade            integer,
  class_no         integer,
  guardian_contact text,
  program_id       text,
  program_name     text,
  stamped_by       text,
  stamped_at       timestamptz not null default now(),
  unique (student_name, grade, class_no, program_id)
);

alter table completion_stamps disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
