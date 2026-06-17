// 프로그램 후기 작성용 서명 토큰 — DB 컬럼 없이 program_id 를 SESSION_SECRET 으로 HMAC 서명.
// 토큰 = <program_id의 32 hex> + <HMAC base64url 24자>. 추측 불가(시크릿 필요), 프로그램별 고정.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'saessak-review-dev-secret';

function hexToUuid(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sigOf(programId) {
  return crypto.createHmac('sha256', SECRET).update('review:' + programId).digest('base64url').slice(0, 24);
}

// program_id(UUID) → 토큰 문자열
function makeReviewToken(programId) {
  const hex = String(programId).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return hex + sigOf(hexToUuid(hex));
}

// 토큰 → program_id(UUID) | null (서명 불일치 시 null)
function parseReviewToken(token) {
  if (typeof token !== 'string' || token.length !== 56) return null;
  const hex = token.slice(0, 32).toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const programId = hexToUuid(hex);
  const given = token.slice(32);
  const expect = sigOf(programId);
  if (given.length !== expect.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expect))) return null;
  } catch { return null; }
  return programId;
}

module.exports = { makeReviewToken, parseReviewToken };
