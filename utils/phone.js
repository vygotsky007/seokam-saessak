// 휴대폰 번호 정규화/검증 유틸
// 입력은 어떤 형식이어도 받아서 010-XXXX-XXXX 표준형으로 정규화.
// 010 휴대폰 외 형식(02-..., 070, 임시번호 등)은 isValidMobile=false.

function normalizeMobile(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  // 자릿수가 다르면 원본 정규화(공백 제거)만 반환 — 검증에서 걸린다.
  return digits;
}

function isValidMobile(normalized) {
  if (!normalized) return false;
  return /^010-\d{4}-\d{4}$/.test(normalized);
}

module.exports = { normalizeMobile, isValidMobile };
