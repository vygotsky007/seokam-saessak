-- 2026-06-20: 에듀테크 도구(교사 큐레이션)
--
-- /edutech.html 새 디자인이 읽는 테이블. GET /api/edutech 가 visible=true 만,
-- is_certified desc, is_featured desc, sort_order asc 로 정렬해 반환한다.
-- 추가/삭제(POST/DELETE)는 서버에서 관리자 세션을 검사(권한 없으면 403).
--
-- 이미 Supabase 에 생성된 테이블을 문서화/재현용으로 기록(IF NOT EXISTS). 기존 테이블 무변경.
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — 비활성화.
-- 시드 데이터는 scripts/seed-edutech.js (scripts/edutech-tools.json, 259개) 로 채운다.

create table if not exists edutech_tools (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  one_liner    text,
  url          text default '',
  category     text,
  subjects     jsonb default '[]'::jsonb,
  grades       jsonb default '[]'::jsonb,
  teacher      boolean not null default false,
  is_featured  boolean not null default false,
  is_certified boolean not null default false,
  visible      boolean not null default true,
  sort_order   integer not null default 0,
  logo_url     text,
  guide_text   text,
  guide_url    text,
  subitems     jsonb default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists edutech_tools_visible_idx on edutech_tools (visible);
create index if not exists edutech_tools_sort_idx
  on edutech_tools (is_certified desc, is_featured desc, sort_order asc);

alter table edutech_tools disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
