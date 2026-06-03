// 프로그램 필드 정규화 + 페이로드 빌더 (관리자 라우트와 동일 규칙).
// 개설 위임(routes/create.js)에서 관리자 "프로그램 추가" 검증/정규화를 그대로 재사용하기 위함.
const crypto = require('crypto');

function genEditToken() {
  return crypto.randomBytes(24).toString('hex');
}

const RECRUIT_STATUSES = ['recruiting', 'upcoming', 'full', 'closed', 'hidden'];
function normalizeRecruitStatus(v) {
  return RECRUIT_STATUSES.includes(v) ? v : null;
}

function normalizeGrades(input) {
  if (!Array.isArray(input)) return null;
  const out = Array.from(new Set(
    input.map(v => Number(v)).filter(v => Number.isInteger(v) && v >= 1 && v <= 6)
  )).sort((a, b) => a - b);
  return out.length > 0 ? out : null;
}

function normalizeSessionDates(input) {
  if (!Array.isArray(input)) return null;
  const out = Array.from(new Set(
    input.map(v => String(v || '').trim()).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v))
  )).sort();
  return out.length > 0 ? out : null;
}

function normalizeTime(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeExtraSessions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const it of input) {
    if (!it) continue;
    const date = String(it.date || '').trim();
    const start = normalizeTime(it.start);
    const end = normalizeTime(it.end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start || !end) continue;
    out.push({ date, start, end });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start.localeCompare(b.start)));
  return out;
}

// 생성 페이로드 빌더. 성공 시 {payload}, 실패 시 {error}. opts.forceStatus 로 모집상태 강제.
function buildCreatePayload(body, opts) {
  const b = body || {};
  if (!b.title || !String(b.title).trim()) return { error: '프로그램명을 입력하세요.' };
  const gradesNorm = normalizeGrades(b.grades);
  if (!gradesNorm) return { error: '대상 학년을 1개 이상 선택하세요.' };
  const tMulti = (typeof b.is_type_multicultural === 'boolean') ? b.is_type_multicultural : b.program_type === 'multicultural';
  const tSib = (typeof b.is_type_sibling === 'boolean') ? b.is_type_sibling : b.program_type === 'sibling';
  const ptype = tMulti ? 'multicultural' : (tSib ? 'sibling' : 'general');
  const status = (opts && opts.forceStatus) ? opts.forceStatus : (normalizeRecruitStatus(b.recruit_status) || 'hidden');
  const payload = {
    title: String(b.title).trim(),
    description: b.description ? String(b.description).trim() : null,
    schedule: b.schedule ? String(b.schedule).trim() : null,
    location: b.location ? String(b.location).trim() : null,
    grades: gradesNorm,
    capacity: Number(b.capacity) || 0,
    waitlist_capacity: b.waitlist_capacity === undefined || b.waitlist_capacity === null || b.waitlist_capacity === ''
      ? 10 : Math.max(0, Number(b.waitlist_capacity) || 0),
    instructors: b.instructors ? String(b.instructors).trim() : null,
    organization: b.organization ? String(b.organization).trim() : null,
    recruit_status: status,
    is_open: status === 'recruiting',
    program_type: ptype,
    is_type_multicultural: tMulti,
    is_type_sibling: tSib,
    type_custom: (b.type_custom === null || b.type_custom === undefined || String(b.type_custom).trim() === '') ? null : String(b.type_custom).trim(),
    multicultural_min: tMulti
      ? (b.multicultural_min === '' || b.multicultural_min === null || b.multicultural_min === undefined ? null : Number(b.multicultural_min))
      : null,
    session_dates: normalizeSessionDates(b.session_dates),
    start_time: normalizeTime(b.start_time),
    end_time: normalizeTime(b.end_time),
    extra_sessions: normalizeExtraSessions(b.extra_sessions),
    edit_token: genEditToken(),
    edit_enabled: false,
  };
  return { payload };
}

// 수정 패치 빌더(개설자용). 모집상태/권한 등 위임 범위를 넘는 필드는 받지 않는다.
// 성공 시 {patch}, 실패 시 {error}.
function buildCreatorUpdatePatch(body) {
  const b = body || {};
  const allowed = ['title', 'description', 'schedule', 'location', 'grades', 'capacity',
    'waitlist_capacity', 'instructors', 'program_type', 'multicultural_min',
    'session_dates', 'start_time', 'end_time', 'extra_sessions',
    'is_type_multicultural', 'is_type_sibling', 'type_custom', 'organization'];
  const patch = {};
  for (const k of allowed) if (k in b) patch[k] = b[k];
  if ('grades' in patch) {
    const g = normalizeGrades(patch.grades);
    if (!g) return { error: '대상 학년을 1개 이상 선택하세요.' };
    patch.grades = g;
  }
  if ('capacity' in patch) patch.capacity = Number(patch.capacity);
  if ('waitlist_capacity' in patch) patch.waitlist_capacity = Math.max(0, Number(patch.waitlist_capacity) || 0);
  if ('is_type_multicultural' in patch) patch.is_type_multicultural = patch.is_type_multicultural === true || patch.is_type_multicultural === 'true';
  if ('is_type_sibling' in patch) patch.is_type_sibling = patch.is_type_sibling === true || patch.is_type_sibling === 'true';
  if ('is_type_multicultural' in patch || 'is_type_sibling' in patch) {
    const m = patch.is_type_multicultural === true;
    const s = patch.is_type_sibling === true;
    patch.program_type = m ? 'multicultural' : (s ? 'sibling' : 'general');
  } else if ('program_type' in patch) {
    if (!['general', 'multicultural', 'sibling'].includes(patch.program_type)) patch.program_type = 'general';
  }
  if ('multicultural_min' in patch) {
    patch.multicultural_min = (patch.multicultural_min === '' || patch.multicultural_min === null || patch.multicultural_min === undefined)
      ? null : Number(patch.multicultural_min);
  }
  const isMultiAfter = ('is_type_multicultural' in patch) ? patch.is_type_multicultural === true : patch.program_type === 'multicultural';
  if (!isMultiAfter) patch.multicultural_min = null;
  if ('session_dates' in patch) patch.session_dates = normalizeSessionDates(patch.session_dates);
  if ('start_time' in patch) patch.start_time = normalizeTime(patch.start_time);
  if ('end_time' in patch) patch.end_time = normalizeTime(patch.end_time);
  if ('extra_sessions' in patch) patch.extra_sessions = normalizeExtraSessions(patch.extra_sessions);
  if ('organization' in patch) patch.organization = (patch.organization === null || patch.organization === undefined || String(patch.organization).trim() === '') ? null : String(patch.organization).trim();
  if ('type_custom' in patch) patch.type_custom = (patch.type_custom === null || patch.type_custom === undefined || String(patch.type_custom).trim() === '') ? null : String(patch.type_custom).trim();
  return { patch };
}

module.exports = {
  genEditToken, normalizeRecruitStatus, normalizeGrades, normalizeSessionDates,
  normalizeTime, normalizeExtraSessions, buildCreatePayload, buildCreatorUpdatePatch,
};
