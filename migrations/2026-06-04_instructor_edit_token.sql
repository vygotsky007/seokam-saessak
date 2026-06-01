-- 2026-06-04: 강사용 프로그램 수정 링크(토큰) + 권한 on/off
--
-- edit_token   : 강사용 수정 링크(/edit/:token)의 무작위 토큰. 프로그램별 고유.
--                신규 프로그램은 서버(Node crypto)에서 발급. 기존 행은 아래에서 백필.
-- edit_enabled : 강사 수정 권한 on/off. 기본 off(false) — 관리자가 켜야만 수정 가능.
--
-- 토큰이 맞아도 edit_enabled=false 면 수정 차단(서버 검증). 신청자 명단 등 개인정보는
-- 강사 페이지에 절대 노출하지 않음(프로그램 정보만).

alter table saessak_programs
  add column if not exists edit_token text;

alter table saessak_programs
  add column if not exists edit_enabled boolean not null default false;

-- 기존 프로그램 토큰 백필: 토큰 없는 행에만 64자 무작위 hex 발급
-- (gen_random_uuid 는 PostgreSQL 코어 함수 — 별도 확장 불필요)
update saessak_programs
   set edit_token = replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '')
 where edit_token is null
    or edit_token = '';

-- 토큰 고유성 보장(값 있는 행만)
create unique index if not exists saessak_programs_edit_token_uidx
  on saessak_programs (edit_token)
  where edit_token is not null;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
