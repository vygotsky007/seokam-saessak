-- 2026-06-07: 학생 기록 긍정/부정 확장 — student_notes.polarity 컬럼
--
-- '긍정' | '부정' | '중립' 저장용. 기존 행(polarity NULL)은 앱에서 note_type 으로 추론한다
-- (excellent/active/praise→긍정, noshow/attitude→부정, etc→중립).
--
-- ※ 앱 코드는 이 컬럼이 없어도 동작한다(저장 시 polarity 빼고 재시도, 표시는 note_type 추론).
--   단, 저장된 polarity 를 그대로 쓰려면 아래를 1회 실행할 것.

alter table student_notes
  add column if not exists polarity text;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
