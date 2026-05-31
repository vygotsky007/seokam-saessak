-- 2026-06-02: saessak_programs 에 "운영기관" 항목 추가
--
-- organization : text (nullable) — 프로그램 운영기관명(예: 한성대학교, 비페스, 울산대학교 등)
--
-- 관리자 전용 메타. 학부모 공개 화면(안내 카드/신청/내 신청 조회)에는 표시·노출하지 않음.
-- 백엔드 routes/public.js 가 /api/public/programs 응답에서 이 컬럼을 명시적으로 제거한다.

alter table saessak_programs
  add column if not exists organization text;

-- PostgREST 스키마 캐시 갱신 (Supabase): 새 컬럼이 즉시 보이도록.
notify pgrst, 'reload schema';
