-- 2026-06-03: 프로그램 유형에 "기타(직접 입력)" 추가
--
-- 기존 유형 플래그(is_type_multicultural / is_type_sibling)는 그대로 두고,
-- 관리자가 자유 입력하는 기타 유형명을 담는 type_custom(text, nullable) 컬럼을 추가한다.
-- 기타는 단순 분류 표시용 — 신청 자격 제한이나 별도 입력 로직 없음.

alter table saessak_programs
  add column if not exists type_custom text;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
