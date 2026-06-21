// 후기 작성자 이름 마스킹 — 반드시 서버에서만 수행하고, 원본 실명은 DB에 저장하지 않는다.
// 가운데 글자를 'O'로 가린다.
//   홍길동 → 홍O동, 홍길 → 홍O, 남궁민수 → 남OO수
function maskName(n) {
  n = (n || '').trim();
  if (!n) return '';
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + 'O';
  return n[0] + 'O'.repeat(n.length - 2) + n[n.length - 1];
}

module.exports = { maskName };
