-- 2026-06-06: 문의사항 답변 상태 — 관리자 전용
--
-- 이미 Supabase 에 생성된 inquiry_status 테이블을 문서화/재현용으로 기록한다.
-- (운영 DB 에는 이미 존재하므로 IF NOT EXISTS 로 안전하게 둔다.)
--
-- 문의 "원본" 은 saessak_applications.motivation 컬럼(읽기 전용, 무변경).
-- 이 테이블은 그 신청 건의 "답변 처리 여부" 만 별도로 기록한다.
--   application_id : saessak_applications.id (uuid) 를 text 로 보관. 행당 1개(PK).
--   answered       : 답변함(true) / 대기(false)
--   answered_by    : '관리자'
--   answered_at    : 마지막 토글 시각
-- 답변 자체는 시스템에서 발송하지 않음(직접 문자·전화). 공개/내신청 화면엔 노출 안 함.
--
-- RLS 는 서버 권한 체크(requireAdmin)로 대체(프로젝트 표준) — 비활성화.

create table if not exists inquiry_status (
  application_id text primary key,
  answered       boolean not null default false,
  answered_by    text,
  answered_at    timestamptz
);

alter table inquiry_status disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
