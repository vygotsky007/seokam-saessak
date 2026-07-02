// 관리자 진입 경로(ADMIN_PATH) 생성 + 로테이션(재발급) 도우미.
//   실행:  npm run gen-admin-path
//
// 로테이션 절차(관리자 URL 노출 의심 시):
//   1) 이 스크립트를 실행해 새 경로를 얻는다.
//   2) 배포 환경(Railway) 환경변수 ADMIN_PATH 를 새 값으로 교체한다.
//   3) 재배포/재시작 → 즉시 옛 URL 은 404, 새 URL 로만 접근 가능.
//   (비밀번호는 그대로 유지됨. 옛 경로로는 더 이상 접근 불가.)
const crypto = require('crypto');
const rand = crypto.randomBytes(24).toString('base64url').slice(0, 32);
const newPath = '/manage-' + rand;

console.log('');
console.log('새 관리자 경로가 생성되었습니다:');
console.log('  ' + newPath);
console.log('');
console.log('▼ 환경변수에 그대로 붙여넣으세요 (Railway → Variables):');
console.log('  ADMIN_PATH=' + newPath);
console.log('');
console.log('교체 후 재배포하면 옛 경로는 즉시 무효화됩니다(404). 비밀번호는 그대로예요.');
console.log('');
