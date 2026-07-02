// 신청 상태 모델 (통일) — 2026-07-02
//   received   : 신청(기본 접수)
//   selected   : 선정
//   waitlisted : 대기
//   confirmed  : 확정
//   rejected   : 미선정
//   cancelled  : 취소
// 옛 값(applied/waiting)은 마이그레이션으로 사라지지만, 전환기·외부 입력 방어를 위해
// 서버가 받은 옛 값을 새 값으로 정규화한다.
const APP_STATUSES = ['received', 'selected', 'waitlisted', 'confirmed', 'rejected', 'cancelled'];
const LEGACY_MAP = { applied: 'received', waiting: 'waitlisted' };

function normalizeAppStatus(v, fallback = 'received') {
  if (v == null) return fallback;
  const s = String(v).trim();
  if (LEGACY_MAP[s]) return LEGACY_MAP[s];
  return APP_STATUSES.includes(s) ? s : fallback;
}

// 옛 값도 유효한 입력으로 인정(정규화 후 canonical 로 저장).
function isValidAppStatus(v) {
  const s = String(v == null ? '' : v).trim();
  return APP_STATUSES.includes(s) || Object.prototype.hasOwnProperty.call(LEGACY_MAP, s);
}

const APP_STATUS_LABELS = {
  received: '신청', selected: '선정', waitlisted: '대기',
  confirmed: '확정', rejected: '미선정', cancelled: '취소',
};
function appStatusLabel(s) {
  return APP_STATUS_LABELS[normalizeAppStatus(s, s)] || s;
}

// 학생 이름 검증: 숫자만이거나 (공백 제외) 1글자면 거부. 통과 시 { ok, name(trim) }.
function validateStudentName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return { ok: false, error: '학생 이름을 입력해 주세요.' };
  if (/^\d+$/.test(name)) return { ok: false, error: '학생 이름을 숫자만으로 저장할 수 없어요. 실제 이름을 입력해 주세요.' };
  if (name.length < 2) return { ok: false, error: '학생 이름은 2글자 이상 입력해 주세요.' };
  return { ok: true, name };
}

module.exports = {
  APP_STATUSES, LEGACY_MAP, normalizeAppStatus, isValidAppStatus,
  APP_STATUS_LABELS, appStatusLabel, validateStudentName,
};
