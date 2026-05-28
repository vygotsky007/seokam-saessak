-- 2026-05-28: 대상 학년을 grade_min/grade_max 범위에서 grades 정수 배열로 전환
-- (grade_min/grade_max 컬럼은 롤백 안전용으로 일단 남겨둠. 새 코드는 grades만 사용)

alter table saessak_programs
  add column if not exists grades int[];

-- 기존 행: grade_min~grade_max 범위를 펼쳐서 grades 배열로 채움
update saessak_programs
set grades = (
  select array_agg(g order by g)
  from generate_series(coalesce(grade_min, 1), coalesce(grade_max, 6)) as g
)
where grades is null;
