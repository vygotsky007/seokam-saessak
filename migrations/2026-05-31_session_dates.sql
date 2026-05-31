-- 2026-05-31: saessak_programs 일정 입력을 구조화 (달력형 날짜 선택 + 시간)
--
-- 새 컬럼
--   session_dates : date[]  (수업 날짜 배열, 예: {2026-06-22, 2026-06-23, 2026-06-25, 2026-06-26})
--   start_time    : text    (예: '09:00')
--   end_time      : text    (예: '12:00')
--
-- 기존 schedule(text) 컬럼은 롤백/기존 데이터 표시 안전용으로 남겨둔다.
-- 새 등록부터는 session_dates/start_time/end_time 을 사용한다.
-- session_dates 가 비어 있으면 화면에서는 schedule 텍스트를 그대로 fallback 으로 표시한다.

alter table saessak_programs
  add column if not exists session_dates date[];

alter table saessak_programs
  add column if not exists start_time text;

alter table saessak_programs
  add column if not exists end_time text;
