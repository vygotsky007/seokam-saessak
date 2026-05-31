-- 2026-06-01: 모집 상태 4단계 도입 (recruiting / upcoming / closed / hidden)
--
-- 기존 is_open(boolean) 토글을 더 세분화한 status 개념으로 확장.
--   recruiting : 모집중   (공개 노출 + 신청 가능)
--   upcoming   : 모집예정 (공개 노출 + 신청 불가, "곧 열려요" 빨강 배지)
--   closed     : 모집완료 (공개 노출 + 신청 불가, 회색 마감 배지)
--   hidden     : 모집숨김 (공개 노출 자체 안 함, default)
--
-- 호환을 위해 is_open 컬럼은 그대로 두고, recruit_status='recruiting' 일 때만 true 로 동기화.
-- 백엔드 라우트가 두 컬럼을 함께 갱신하므로 기존 is_open 기반 로직(대시보드 카운트 등)도 안전.

alter table saessak_programs
  add column if not exists recruit_status text not null default 'hidden';

-- 기존 데이터 백필: is_open=true → recruiting, false → hidden
update saessak_programs
   set recruit_status = case
     when is_open is true  then 'recruiting'
     when is_open is false then 'hidden'
     else 'hidden'
   end
 where recruit_status is null
    or recruit_status not in ('recruiting','upcoming','closed','hidden');

-- 값 제약
alter table saessak_programs
  drop constraint if exists saessak_programs_recruit_status_chk;
alter table saessak_programs
  add constraint saessak_programs_recruit_status_chk
  check (recruit_status in ('recruiting','upcoming','closed','hidden'));
