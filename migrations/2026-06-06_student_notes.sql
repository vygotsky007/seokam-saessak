-- 2026-06-06: 학생 참고기록(노쇼/태도) — 내부 관리용
--
-- 이미 Supabase 에 생성된 student_notes 테이블을 문서화/재현용으로 기록한다.
-- (운영 DB 에는 이미 존재하므로 IF NOT EXISTS 로 안전하게 둔다. 신청 테이블은 무변경.)
--
-- 매칭 식별값: 이름(student_name) + 학년(grade) + 반(class_no).
--   보호자 연락처(guardian_contact)가 기록·신청 양쪽 다 있으면 연락처까지 일치할 때만
--   동일 학생으로 간주(앱의 기존 동명이인 처리 원칙과 동일). 한쪽이라도 없으면 이름+학년+반.
-- note_type: 'noshow'(노쇼) | 'attitude'(태도) | 'etc'(기타)
-- created_by: '관리자' 또는 '강사(이름)'.
-- 공개/내신청 화면에는 절대 노출하지 않음(관리자·강사 페이지 전용).
--
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — 비활성화.

create table if not exists student_notes (
  id               uuid primary key default gen_random_uuid(),
  student_name     text not null,
  grade            integer,
  class_no         integer,
  guardian_contact text,
  program_id       uuid references saessak_programs (id) on delete set null,
  note_type        text not null default 'etc',
  content          text,
  created_by       text,
  created_at       timestamptz not null default now()
);

-- 명단 일괄 매칭 조회 가속(이름+학년+반)
create index if not exists student_notes_match_idx
  on student_notes (student_name, grade, class_no);

alter table student_notes disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
