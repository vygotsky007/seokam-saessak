// 32자 랜덤 ADMIN_PATH 생성
const crypto = require('crypto');
const rand = crypto.randomBytes(24).toString('base64url').slice(0, 32);
console.log('/manage-' + rand);
