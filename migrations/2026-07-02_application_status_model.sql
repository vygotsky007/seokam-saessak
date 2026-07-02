-- 2026-07-02: 신청 상태 모델 통일
--
-- 기존 status IN ('applied','selected','waiting','cancelled')  →
-- 신규 status IN ('received','selected','waitlisted','confirmed','rejected','cancelled')
--
-- 매핑
--   applied   → received     (기본 접수)
--   waiting   → waitlisted   (대기)
--   selected  → selected     (선정, 유지)
--   cancelled → cancelled    (취소, 유지)
--   신규       confirmed     (확정) / rejected (미선정) — 기존 데이터 없음
--
-- ⚠ 실행 순서: 이 마이그레이션을 먼저 실행한 뒤 앱 코드를 배포하세요
--   (코드가 'received' 등 새 값을 기록하는데 CHECK 제약이 옛 4값이면 INSERT/UPDATE 실패).
--
-- ── 실행 전 건수(검증용) ────────────────────────────────
--   select status, count(*) from saessak_applications group by status order by status;
--   기준값(2026-07-02): applied 167 · selected 86 · waiting 3 · cancelled 28 (합계 284)

begin;

-- 1) 기존 CHECK 제약 제거 (init.sql 의 인라인 제약 = saessak_applications_status_check)
alter table saessak_applications
  drop constraint if exists saessak_applications_status_check;

-- 2) 기본값을 잠시 떼어(옛 default 'applied' 가 새 제약과 충돌하지 않도록) 데이터 이관
alter table saessak_applications
  alter column status drop default;

-- 3) 데이터 이관: applied→received, waiting→waitlisted (selected·cancelled 은 유지)
update saessak_applications set status = 'received'   where status = 'applied';
update saessak_applications set status = 'waitlisted' where status = 'waiting';

-- 4) 새 기본값 + 새 CHECK 제약
alter table saessak_applications
  alter column status set default 'received';
alter table saessak_applications
  add constraint saessak_applications_status_check
  check (status in ('received','selected','waitlisted','confirmed','rejected','cancelled'));

commit;

-- 5) PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- ── 실행 후 건수(검증용) ────────────────────────────────
--   select status, count(*) from saessak_applications group by status order by status;
--   기대값: received 167 · selected 86 · waitlisted 3 · cancelled 28 · confirmed 0 · rejected 0 (합계 284)
