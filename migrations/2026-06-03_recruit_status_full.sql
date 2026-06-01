-- 2026-06-03: 모집 상태에 'full'(모집마감) 추가
--
-- 기존 4단계(recruiting / upcoming / closed / hidden) + full(모집마감)
--   recruiting : 모집중   (공개 노출 + 신청 가능, 녹색)
--   upcoming   : 모집예정 (공개 노출 + 신청 불가, "곧 열려요" 빨강 배지)
--   full       : 모집마감 (공개 노출 + 신청 불가, "마감" 도장 표시) ← 신규
--   closed     : 모집종료 (공개 노출 + 신청 불가, 회색 종료 안내)
--   hidden     : 모집숨김 (공개 노출 자체 안 함, default)
--
-- full 은 관리자가 수동으로 걸 수 있고, 정원+대기 자동 소진 시의 자동마감과
-- 동일한 "마감 도장" 표시를 공유한다. is_open 동기화는 recruiting 일 때만 true 라
-- 기존 백엔드 로직 그대로 안전(full 은 is_open=false).

-- 값 제약: 기존 제약을 떨구고 'full' 을 포함해 다시 건다.
alter table saessak_programs
  drop constraint if exists saessak_programs_recruit_status_chk;
alter table saessak_programs
  add constraint saessak_programs_recruit_status_chk
  check (recruit_status in ('recruiting','upcoming','full','closed','hidden'));

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
