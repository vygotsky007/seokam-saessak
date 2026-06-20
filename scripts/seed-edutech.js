// 에듀테크 도구 시드 — 교사 큐레이션 259개를 edutech_tools 테이블에 채운다.
//
// 기존 테이블에는 카테고리/한줄설명이 비어 있는 임시 임포트(501행)가 들어 있어,
// 새 디자인(/edutech.html)의 카테고리 필터·검색이 동작하지 않는다.
// 이 스크립트는 테이블을 비우고 큐레이션된 259개로 재시드한다.
//
//   node scripts/seed-edutech.js
//
// 데이터 원본: scripts/edutech-tools.json
// (name, one_liner, url, category, subjects[=[category]], grades, is_certified, is_featured, teacher, visible, sort_order)

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const fs = require('fs');
const path = require('path');
const supabase = require('../utils/supabase');

const ROWS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'edutech-tools.json'), 'utf8')
);

(async () => {
  console.log(`🧰 에듀테크 시드 시작 — ${ROWS.length}개`);

  // 1) 기존 행 전체 삭제
  const { error: delErr } = await supabase
    .from('edutech_tools')
    .delete()
    .not('id', 'is', null);
  if (delErr) {
    console.error('  ✗ 기존 데이터 삭제 실패:', delErr.message);
    process.exit(1);
  }
  console.log('  · 기존 데이터 삭제 완료');

  // 2) 배치 삽입
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < ROWS.length; i += BATCH) {
    const chunk = ROWS.slice(i, i + BATCH);
    const { error } = await supabase.from('edutech_tools').insert(chunk);
    if (error) {
      console.error(`  ✗ 배치 ${i / BATCH + 1} 삽입 실패:`, error.message);
      process.exit(1);
    }
    inserted += chunk.length;
    console.log(`  ✓ ${inserted}/${ROWS.length}`);
  }

  // 3) 검증
  const { count } = await supabase
    .from('edutech_tools')
    .select('*', { count: 'exact', head: true })
    .eq('visible', true);
  console.log(`완료. visible=true 행 수: ${count}`);
  process.exit(0);
})();
