// Usage: node scripts/hash-password.js "내비밀번호"
const bcrypt = require('bcryptjs');
const pw = process.argv[2];
if (!pw) {
  console.error('사용법: node scripts/hash-password.js "your-password"');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log(hash);
