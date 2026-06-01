-- 2026-06-01: 프로그램 "보충 회차" 추가
--
-- extra_sessions : 메인 일정(session_dates + start_time/end_time)과 독립된 보충 회차 배열.
--                  형식: [{"date":"2026-06-16","start":"14:40","end":"16:20"}, ...]
--                  메인 일정은 그대로 두고, 별도 시간의 보충 날짜를 덧붙이는 용도.
--
-- 기존 데이터 무변경: nullable + 기본 빈 배열([]). 보충 없는 프로그램은 지금과 동일하게 동작.

alter table saessak_programs
  add column if not exists extra_sessions jsonb not null default '[]'::jsonb;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
