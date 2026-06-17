-- 2026-06-17: 프로그램 후기(리뷰)
--
-- 이수 학생이 QR/링크로 후기를 쓰고, 다른 학부모가 "후기보기"로 참고한다.
-- 이미 Supabase 에 생성된 테이블을 문서화/재현용으로 기록(IF NOT EXISTS). 기존 테이블 무변경.
--
-- program_id 는 프로그램 id를 text 로 저장/조회(타입 캐스팅). rating 1~5(선택), content 필수,
-- grade_label 익명 표시용(예 "5학년", 실명 금지), status 게시/숨김(숨김은 학부모 화면 즉시 제외).
--
-- 후기 작성 토큰은 별도 컬럼 없이 SESSION_SECRET 으로 서명한 HMAC 토큰(utils/review-token.js)을 사용 —
-- 스키마 변경 없이 프로그램별 추측 불가 URL(/review/:token) 을 만든다.
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — 비활성화.

create table if not exists program_reviews (
  id          uuid primary key default gen_random_uuid(),
  program_id  text not null,
  rating      smallint,
  content     text not null,
  grade_label text,
  status      text not null default '게시',
  created_at  timestamptz not null default now()
);

alter table program_reviews
  drop constraint if exists program_reviews_status_chk;
alter table program_reviews
  add constraint program_reviews_status_chk check (status in ('게시', '숨김'));

alter table program_reviews
  drop constraint if exists program_reviews_rating_chk;
alter table program_reviews
  add constraint program_reviews_rating_chk check (rating is null or (rating between 1 and 5));

create index if not exists program_reviews_program_idx on program_reviews (program_id);

alter table program_reviews disable row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
