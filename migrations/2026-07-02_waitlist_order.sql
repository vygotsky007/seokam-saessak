-- 2026-07-02: 대기 순번(waitlist_order) 컬럼 추가
--
-- 신청 상태 모델(received/selected/waitlisted/confirmed/rejected/cancelled)은
-- 2026-07-02_application_status_model.sql 에서 이미 적용됨(먼저 실행 필요).
-- 여기서는 관리자가 '대기'로 지정할 때 부여하는 순번 컬럼만 추가한다(널 허용).
--
-- ⚠ 실행: Supabase SQL Editor 에서 실행 → PostgREST 캐시 갱신.

alter table saessak_applications
  add column if not exists waitlist_order int;

-- (안전) status 컬럼이 없거나 옛 제약이면 상태모델 마이그레이션을 먼저 실행하세요.
--   select status, count(*) from saessak_applications group by status;

notify pgrst, 'reload schema';
