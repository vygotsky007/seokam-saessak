-- 2026-06-07: 프로그램 개설 위임 — creator_tokens / program_creators
--
-- 이미 Supabase 에 생성된 두 테이블을 문서화/재현용으로 기록(IF NOT EXISTS). 기존 테이블 무변경.
--
-- creator_tokens   : 관리자가 발급하는 개설자 토큰. enabled=true 여야 접근 가능.
--   /create/:token 링크 + 개설자 비번(env CREATOR_PASSWORD_HASH)으로 3중 게이트.
-- program_creators : 개설 위임으로 만들어진 프로그램의 귀속(누가 만들었나) 기록.
--   본인이 만든 프로그램만 수정 가능하도록 스코프 검증에 사용(서버 강제).
--
-- 개설분은 항상 recruit_status='hidden' 으로 생성 → 학부모 공개 미노출, 관리자 검토 후 공개.
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — 비활성화.

create table if not exists creator_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  label       text,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists program_creators (
  program_id        uuid primary key references saessak_programs (id) on delete cascade,
  created_by_token  text,
  created_by_label  text,
  created_at        timestamptz not null default now()
);
create index if not exists program_creators_token_idx on program_creators (created_by_token);

alter table creator_tokens disable row level security;
alter table program_creators disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
