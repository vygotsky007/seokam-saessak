// 강사용 프로그램 수정 라우터 — /api/edit prefix 아래에 마운트됨(관리자 인증 없음).
// 보안: 추측 불가능한 긴 토큰(edit_token) + 프로그램별 edit_enabled=true 일 때만 수정/삭제 허용.
// 중요: 신청자 명단·학생/보호자 개인정보는 절대 노출하지 않는다. 프로그램 정보만 다룬다.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../utils/supabase');

// 토큰은 충분히 길어야 한다(백필 64자 / 신규 48자). 짧은 값은 즉시 거부해 null 매칭 등을 방지.
const MIN_TOKEN_LEN = 16;

// 강사 페이지에 노출해도 되는 "프로그램 정보" 컬럼만 골라서 반환(개인정보 차단).
const PUBLIC_PROGRAM_FIELDS = [
  'id', 'title', 'description', 'schedule', 'location', 'grades',
  'capacity', 'waitlist_capacity', 'instructors',
  'session_dates', 'start_time', 'end_time',
  'is_type_multicultural', 'is_type_sibling', 'type_custom',
  'multicultural_min', 'program_type', 'recruit_status', 'edit_enabled',
];
function pickProgram(p) {
  const out = {};
  for (const k of PUBLIC_PROGRAM_FIELDS) out[k] = p[k];
  return out;
}

// 수정 변경 빈도가 높지 않으므로 IP 기준 완만한 제한.
const editLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

// ===== 필드 정규화(관리자 라우트와 동일 규칙) =====
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

// 토큰으로 프로그램 1개 조회. 없으면 null.
async function findByToken(token) {
  if (!token || String(token).length < MIN_TOKEN_LEN) return null;
  const { data, error } = await supabase
    .from('saessak_programs')
    .select('*')
    .eq('edit_token', token)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// GET /api/edit/:token — 강사 수정 화면용 프로그램 정보(개인정보 없음)
router.get('/:token', async (req, res) => {
  try {
    const p = await findByToken(req.params.token);
    if (!p) return res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' });
    if (p.edit_enabled !== true) {
      // 권한 off — 프로그램 정보도 주지 않고 안내만.
      return res.json({ ok: true, edit_enabled: false, title: p.title || '' });
    }
    res.json({ ok: true, edit_enabled: true, data: pickProgram(p) });
  } catch (err) {
    console.error('[GET /api/edit/:token]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/edit/:token — 강사 프로그램 정보 수정(권한 on 일 때만)
router.put('/:token', editLimiter, async (req, res) => {
  try {
    const p = await findByToken(req.params.token);
    if (!p) return res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' });
    if (p.edit_enabled !== true) {
      return res.status(403).json({ ok: false, error: '현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.' });
    }

    // 강사가 만질 수 있는 필드만 화이트리스트. recruit_status / is_open / organization /
    // edit_token / edit_enabled 등은 절대 받지 않는다(관리자 전용).
    const b = req.body || {};
    const patch = {};
    if ('title' in b) {
      const t = String(b.title || '').trim();
      if (!t) return res.status(400).json({ ok: false, error: '프로그램명을 입력하세요.' });
      patch.title = t;
    }
    if ('description' in b) patch.description = b.description ? String(b.description).trim() : null;
    if ('location' in b)    patch.location = b.location ? String(b.location).trim() : null;
    if ('instructors' in b) patch.instructors = b.instructors ? String(b.instructors).trim() : null;
    if ('schedule' in b)    patch.schedule = b.schedule ? String(b.schedule).trim() : null;
    if ('grades' in b) {
      const g = normalizeGrades(b.grades);
      if (!g) return res.status(400).json({ ok: false, error: '대상 학년을 1개 이상 선택하세요.' });
      patch.grades = g;
    }
    if ('capacity' in b) patch.capacity = Math.max(0, Number(b.capacity) || 0);
    if ('waitlist_capacity' in b) patch.waitlist_capacity = Math.max(0, Number(b.waitlist_capacity) || 0);
    if ('session_dates' in b) patch.session_dates = normalizeSessionDates(b.session_dates);
    if ('start_time' in b) patch.start_time = normalizeTime(b.start_time);
    if ('end_time' in b) patch.end_time = normalizeTime(b.end_time);

    // 유형(다문화/형제/기타) — program_type 호환값도 함께 동기화.
    const hasTypeFields = ('is_type_multicultural' in b) || ('is_type_sibling' in b);
    if ('is_type_multicultural' in b) patch.is_type_multicultural = b.is_type_multicultural === true || b.is_type_multicultural === 'true';
    if ('is_type_sibling' in b)       patch.is_type_sibling = b.is_type_sibling === true || b.is_type_sibling === 'true';
    if (hasTypeFields) {
      const m = patch.is_type_multicultural === true;
      const s = patch.is_type_sibling === true;
      patch.program_type = m ? 'multicultural' : (s ? 'sibling' : 'general');
    }
    if ('type_custom' in b) {
      const tc = b.type_custom;
      patch.type_custom = (tc === null || tc === undefined || String(tc).trim() === '') ? null : String(tc).trim();
    }
    if ('multicultural_min' in b) {
      patch.multicultural_min = (b.multicultural_min === '' || b.multicultural_min === null || b.multicultural_min === undefined)
        ? null : Number(b.multicultural_min);
    }
    // 다문화 우대가 아니면 최소보장은 강제 null
    const isMultiAfter = ('is_type_multicultural' in patch) ? patch.is_type_multicultural === true : p.is_type_multicultural === true;
    if (!isMultiAfter) patch.multicultural_min = null;

    const { data, error } = await supabase
      .from('saessak_programs')
      .update(patch)
      .eq('id', p.id)
      .eq('edit_token', req.params.token) // 토큰 재확인(경합 방지)
      .select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '수정에 실패했습니다. 링크를 다시 확인하세요.' });
    res.json({ ok: true, data: pickProgram(data[0]) });
  } catch (err) {
    console.error('[PUT /api/edit/:token]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/edit/:token — 강사 프로그램 삭제(권한 on 일 때만)
router.delete('/:token', editLimiter, async (req, res) => {
  try {
    const p = await findByToken(req.params.token);
    if (!p) return res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' });
    if (p.edit_enabled !== true) {
      return res.status(403).json({ ok: false, error: '현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.' });
    }
    // 프로그램 삭제 시 연결된 신청 행도 함께 제거(관리자 삭제와 동일). 명단을 보여주지는 않는다.
    await supabase.from('saessak_applications').delete().eq('program_id', p.id);
    const { error } = await supabase.from('saessak_programs').delete().eq('id', p.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/edit/:token]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
