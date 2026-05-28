// ⚠ 테스트 데이터 정리용 — 운영 중 사용 금지 ⚠
// saessak_applications 테이블의 모든 신청 행을 즉시 삭제합니다 (확인 프롬프트 없음).
// saessak_programs 는 건드리지 않습니다.
// 사용: npm run clear:apps

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const supabase = require('../utils/supabase');

(async () => {
  console.log('🧹 saessak_applications 비우는 중…');
  const { error, count } = await supabase
    .from('saessak_applications')
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) {
    console.error('  ✗ 실패:', error.message);
    process.exit(1);
  }
  console.log(`  ✓ ${count ?? '?'} 건 삭제됨.`);
  process.exit(0);
})();
