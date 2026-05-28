-- 2026-05-28: 대기자 시스템 도입
-- saessak_programs: 대기 정원(waitlist_capacity) 컬럼 추가 (default 10)
-- saessak_applications: 자동 대기 플래그(is_waitlist) 추가 (default false)
--
-- ⚠ 설계 메모
-- is_waitlist 는 "접수 순번에 따른 자동 구분"만 표현한다.
-- 기존 status('applied' / 'selected' / 'waiting' / 'cancelled')는
-- 관리자의 최종 선정 판정을 위한 별개 레이어로 유지된다.

alter table saessak_programs
  add column if not exists waitlist_capacity int not null default 10;

alter table saessak_applications
  add column if not exists is_waitlist boolean not null default false;
