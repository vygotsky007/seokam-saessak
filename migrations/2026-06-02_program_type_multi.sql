-- 2026-06-02: 프로그램 유형을 단일 선택 → 다중 선택으로 확장
--
-- 기존 program_type(text: 'general'|'multicultural'|'sibling') 한 칸 대신,
-- 두 개의 boolean 컬럼으로 "다문화 우대" / "형제 우대" 여부를 독립적으로 표현한다.
-- 둘 다 false 면 "일반형".
--
-- 호환을 위해 program_type 컬럼은 그대로 두고, 백엔드가 두 boolean 으로부터
-- program_type 값을 동기화한다 (다문화 우선, 다음 형제, 둘 다 false 면 general).
-- 다문화 최소보장(multicultural_min)은 is_type_multicultural=true 일 때만 의미.

alter table saessak_programs
  add column if not exists is_type_multicultural boolean not null default false;

alter table saessak_programs
  add column if not exists is_type_sibling       boolean not null default false;

-- 기존 데이터 백필: program_type 값에서 두 boolean 으로 옮긴다
update saessak_programs
   set is_type_multicultural = (program_type = 'multicultural')
 where is_type_multicultural is distinct from (program_type = 'multicultural');

update saessak_programs
   set is_type_sibling = (program_type = 'sibling')
 where is_type_sibling is distinct from (program_type = 'sibling');

-- PostgREST 스키마 캐시 갱신 (Supabase): 새 컬럼이 즉시 보이도록.
notify pgrst, 'reload schema';
