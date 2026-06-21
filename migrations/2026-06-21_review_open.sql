-- 2026-06-21: 프로그램별 후기 받기 활성화/비활성화 — saessak_programs.review_open
--
-- 각 프로그램마다 후기를 "받는 중(true)/안 받는 중(false)"을 토글한다.
-- 기본값 true(기존 동작 유지: 링크가 있으면 후기를 받을 수 있었음).
-- 기존 행(NULL)은 true 로 채운다.
--
-- 관리자 후기 모달의 "후기 받기 ON/OFF" 토글이 이 컬럼을 뒤집고,
-- /review/:token 페이지·제출 API 가 이 값으로 폼 노출/저장 여부를 결정한다.
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준).

alter table saessak_programs
  add column if not exists review_open boolean not null default true;

-- 기존 행이 NULL 이면 true 로(컬럼이 이미 있었고 nullable 이던 경우 대비).
update saessak_programs set review_open = true where review_open is null;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
