// 강사용 프로그램 수정 라우터 — /api/edit prefix 아래에 마운트됨(관리자 인증 없음).
// 보안: 추측 불가능한 긴 토큰(edit_token) + 프로그램별 edit_enabled=true 일 때만 수정/삭제 허용.
// 중요: 신청자 명단·학생/보호자 개인정보는 절대 노출하지 않는다. 프로그램 정보만 다룬다.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const router = express.Router();
const supabase = require('../utils/supabase');
const { normalizeMobile } = require('../utils/phone');

// 토큰은 충분히 길어야 한다(백필 64자 / 신규 48자). 짧은 값은 즉시 거부해 null 매칭 등을 방지.
const MIN_TOKEN_LEN = 16;

// 강사용 공통 비밀번호(명단 열람·수동입력 게이트). 토큰만으로 개인정보가 새지 않도록 한 단계 더.
// 미설정이면 명단/수동입력 기능 자체를 잠근다(안전 기본값) — 관리자가 INSTRUCTOR_PASSWORD_HASH 설정 필요.
function instructorPassConfigured() {
  return !!(process.env.INSTRUCTOR_PASSWORD_HASH && process.env.INSTRUCTOR_PASSWORD_HASH.trim());
}
async function checkInstructorPass(pw) {
  if (!instructorPassConfigured()) return false;
  if (!pw || typeof pw !== 'string') return false;
  try {
    return await bcrypt.compare(pw, process.env.INSTRUCTOR_PASSWORD_HASH);
  } catch {
    return false;
  }
}
// 명단/수동입력 공통 게이트: 토큰 유효 + edit_enabled=true + 강사 비번 일치.
// 통과 시 프로그램 객체 반환, 실패 시 res 로 응답하고 null 반환.
async function gateRoster(req, res) {
  if (!instructorPassConfigured()) {
    res.status(503).json({ ok: false, error: '강사 명단 기능이 아직 설정되지 않았습니다. 관리자에게 문의하세요.' });
    return null;
  }
  const p = await findByToken(req.params.token);
  if (!p) {
    res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' });
    return null;
  }
  if (p.edit_enabled !== true) {
    res.status(403).json({ ok: false, error: '현재 열람이 비활성화되어 있습니다. 관리자에게 문의하세요.' });
    return null;
  }
  const ok = await checkInstructorPass((req.body || {}).password);
  if (!ok) {
    res.status(401).json({ ok: false, error: '강사 비밀번호가 올바르지 않습니다.' });
    return null;
  }
  return p;
}

// 명단 1행을 강사에게 보여줄 필드만 추려서 반환.
function pickRosterRow(a) {
  return {
    id: a.id,
    student_name: a.student_name,
    grade: a.grade,
    class_no: a.class_no,
    guardian_name: a.guardian_name,
    guardian_phone: a.guardian_phone,
    is_waitlist: a.is_waitlist === true,
    status: a.status,
    source: a.source,
    submitted_at: a.submitted_at,
    motivation: a.motivation || null, // 학부모가 신청 시 적은 문의사항(특이사항·알레르기 등)
  };
}

// 강사 페이지에 노출해도 되는 "프로그램 정보" 컬럼만 골라서 반환(개인정보 차단).
const PUBLIC_PROGRAM_FIELDS = [
  'id', 'title', 'description', 'schedule', 'location', 'grades',
  'capacity', 'waitlist_capacity', 'instructors',
  'session_dates', 'start_time', 'end_time', 'extra_sessions',
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
// 보충 회차 배열 정규화(관리자 라우트와 동일 규칙)
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
    if ('extra_sessions' in b) patch.extra_sessions = normalizeExtraSessions(b.extra_sessions);

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

// DELETE /api/edit/:token — 프로그램 삭제는 강사에게 허용하지 않는다(관리자 전용).
// 신청자 있는 프로그램을 강사가 실수로 지우면 신청 데이터가 손실되므로, 서버에서도 항상 거부.
router.delete('/:token', editLimiter, (req, res) => {
  return res.status(403).json({ ok: false, error: '프로그램 삭제는 관리자만 가능합니다. 관리자에게 문의하세요.' });
});

// 명단/수동입력 비번 시도 제한(브루트포스 방지). 수정 한도와 별개로 더 빡빡하게.
const rosterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

// POST /api/edit/:token/roster — 이 프로그램 신청자 명단(개인정보 포함, 내부 강사 전용)
// body: { password }. 토큰+권한+강사비번 모두 통과해야 응답.
// 오직 이 토큰의 program_id 신청자만 반환(다른 프로그램은 절대 노출 안 됨).
router.post('/:token/roster', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return; // gateRoster 가 이미 응답함

    const { data, error } = await supabase
      .from('saessak_applications')
      .select('*')
      .eq('program_id', p.id) // 이 프로그램만
      .order('is_waitlist', { ascending: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    // 취소건도 표시(강사가 되돌릴 수 있게). 단 순번/카운트는 비취소 건만.
    const rows = (data || []).map(pickRosterRow);
    let acceptedNo = 0;
    let waitlistNo = 0;
    const list = rows.map(r => {
      let seq = '';
      if (r.status !== 'cancelled') seq = r.is_waitlist ? ++waitlistNo : ++acceptedNo;
      return { ...r, seq };
    });

    res.json({
      ok: true,
      program: {
        title: p.title || '', capacity: p.capacity || 0, waitlist_capacity: p.waitlist_capacity || 0,
        grades: p.grades || [], recruit_status: p.recruit_status || (p.is_open ? 'recruiting' : 'hidden'),
      },
      accepted_count: acceptedNo,
      waitlist_count: waitlistNo,
      data: list,
    });
  } catch (err) {
    console.error('[POST /api/edit/:token/roster]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/edit/:token/applications — 종이 신청서 수동 입력(내부 강사 전용)
// body: { password, student_name, grade, class_no, guardian_name, guardian_phone }
// 정원/대기 로직·학년 검증은 온라인 신청과 동일. source='manual'.
router.post('/:token/applications', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return;

    const b = req.body || {};
    const studentName = b.student_name ? String(b.student_name).trim() : '';
    if (!studentName) return res.status(400).json({ ok: false, error: '학생 이름을 입력하세요.' });

    const grade = Number(b.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
      return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력하세요.' });
    }
    const classNo = Number(b.class_no);
    if (!Number.isInteger(classNo) || classNo < 1 || classNo > 30) {
      return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력하세요.' });
    }
    // 대상 학년 검증
    const grades = Array.isArray(p.grades) ? p.grades : [];
    if (!grades.includes(grade)) {
      return res.status(400).json({ ok: false, error: `이 프로그램은 ${grades.join(',')}학년 대상입니다.` });
    }

    const guardianName = b.guardian_name ? String(b.guardian_name).trim() : null;
    const guardianPhone = b.guardian_phone ? normalizeMobile(b.guardian_phone) : null;

    // 현재 접수/대기 카운트 (취소 제외)
    const { data: apps, error: cErr } = await supabase
      .from('saessak_applications')
      .select('*')
      .eq('program_id', p.id);
    if (cErr) throw cErr;
    let aCount = 0, wCount = 0;
    (apps || []).forEach(a => {
      if (a.status === 'cancelled') return;
      if (a.is_waitlist) wCount++; else aCount++;
    });

    // 중복 체크: 같은 학생이름+보호자연락처가 이미 이 프로그램에 등록되어 있으면 거부.
    const dup = (apps || []).some(a =>
      a.status !== 'cancelled' &&
      a.student_name === studentName &&
      (guardianPhone ? a.guardian_phone === guardianPhone : true)
    );
    if (dup) {
      return res.status(409).json({ ok: false, error: '이미 이 프로그램에 등록된 학생입니다.' });
    }

    const cap = Number(p.capacity) || 0;
    const wcap = Number(p.waitlist_capacity) || 0;
    let isWait, slotNumber;
    if (aCount < cap) {
      isWait = false; slotNumber = aCount + 1;
    } else if (wCount < wcap) {
      isWait = true; slotNumber = wCount + 1;
    } else {
      return res.status(409).json({ ok: false, error: '정원과 대기 인원이 모두 찼습니다.' });
    }

    const isMulticulturalProgram = p.is_type_multicultural === true || p.program_type === 'multicultural';

    const { data: inserted, error: iErr } = await supabase
      .from('saessak_applications')
      .insert([{
        program_id: p.id,
        student_name: studentName,
        grade,
        class_no: classNo,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        student_phone: null,
        motivation: null,
        privacy_agreed: true,
        status: 'applied',
        source: 'manual',
        submitted_at: new Date().toISOString(),
        is_multicultural: false, // 강사 수동입력은 다문화 표기 미지정(관리자가 필요시 조정)
        sibling_group_id: null,
        is_waitlist: isWait,
      }])
      .select();
    if (iErr) throw iErr;

    res.json({
      ok: true,
      is_waitlist: isWait,
      slot_number: slotNumber,
      data: pickRosterRow(inserted[0]),
    });
  } catch (err) {
    console.error('[POST /api/edit/:token/applications]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 강사가 만질 수 있는 신청 행인지 확인: 이 프로그램(program_id 일치) + source='manual' 만.
// 온라인 신청은 강사가 수정/삭제 불가 → 409 로 거부(클라이언트 우회 방지).
// 통과 시 행 반환, 실패 시 res 로 응답하고 null 반환.
async function findManualRow(programId, appId, res) {
  const { data, error } = await supabase
    .from('saessak_applications')
    .select('*')
    .eq('id', appId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.program_id !== programId) {
    res.status(404).json({ ok: false, error: '신청 건을 찾을 수 없습니다.' });
    return null;
  }
  if (data.source !== 'manual') {
    res.status(409).json({ ok: false, error: '온라인 신청 건은 관리자에게 문의해 주세요.' });
    return null;
  }
  return data;
}

// PUT /api/edit/:token/applications/:appId — 수동 신청 건 수정(내부 강사 전용)
// body: { password, student_name, grade, class_no, guardian_name, guardian_phone }
router.put('/:token/applications/:appId', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return;
    const row = await findManualRow(p.id, req.params.appId, res);
    if (!row) return;

    const b = req.body || {};
    const patch = {};
    if ('student_name' in b) {
      const name = b.student_name ? String(b.student_name).trim() : '';
      if (!name) return res.status(400).json({ ok: false, error: '학생 이름을 입력하세요.' });
      patch.student_name = name;
    }
    const grades = Array.isArray(p.grades) ? p.grades : [];
    if ('grade' in b) {
      const grade = Number(b.grade);
      if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
        return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력하세요.' });
      }
      if (!grades.includes(grade)) {
        return res.status(400).json({ ok: false, error: `이 프로그램은 ${grades.join(',')}학년 대상입니다.` });
      }
      patch.grade = grade;
    }
    if ('class_no' in b) {
      const classNo = Number(b.class_no);
      if (!Number.isInteger(classNo) || classNo < 1 || classNo > 30) {
        return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력하세요.' });
      }
      patch.class_no = classNo;
    }
    if ('guardian_name' in b) patch.guardian_name = b.guardian_name ? String(b.guardian_name).trim() : null;
    if ('guardian_phone' in b) patch.guardian_phone = b.guardian_phone ? normalizeMobile(b.guardian_phone) : null;

    const { data, error } = await supabase
      .from('saessak_applications')
      .update(patch)
      .eq('id', row.id)
      .eq('program_id', p.id)      // 프로그램 재확인(경합 방지)
      .eq('source', 'manual')      // 온라인 건 보호 재확인
      .select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '수정에 실패했습니다.' });
    res.json({ ok: true, data: pickRosterRow(data[0]) });
  } catch (err) {
    console.error('[PUT /api/edit/:token/applications/:appId]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/edit/:token/applications/:appId — 수동 신청 건 삭제(내부 강사 전용)
router.delete('/:token/applications/:appId', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return;
    const row = await findManualRow(p.id, req.params.appId, res);
    if (!row) return;

    const { error } = await supabase
      .from('saessak_applications')
      .delete()
      .eq('id', row.id)
      .eq('program_id', p.id)      // 프로그램 재확인
      .eq('source', 'manual');     // 온라인 건 보호 재확인
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/edit/:token/applications/:appId]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/edit/:token/applications/:appId/status — 신청자 선정/상태 변경(내부 강사 전용)
// 온라인·수동 모두 가능. 데이터 삭제가 아니라 status 값만 변경(안전). 이 프로그램 신청자만.
const APP_STATUSES = ['applied', 'selected', 'waiting', 'cancelled'];
router.patch('/:token/applications/:appId/status', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return;
    const status = (req.body || {}).status;
    if (!APP_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: '유효하지 않은 상태입니다.' });
    }
    // 이 토큰의 프로그램 신청자인지 확인(다른 프로그램 거부)
    const { data: row, error: e0 } = await supabase
      .from('saessak_applications')
      .select('id, program_id')
      .eq('id', req.params.appId)
      .maybeSingle();
    if (e0) throw e0;
    if (!row || row.program_id !== p.id) {
      return res.status(404).json({ ok: false, error: '신청 건을 찾을 수 없습니다.' });
    }
    const { data, error } = await supabase
      .from('saessak_applications')
      .update({ status })
      .eq('id', row.id)
      .eq('program_id', p.id) // 프로그램 재확인(경합 방지)
      .select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '상태 변경에 실패했습니다.' });
    res.json({ ok: true, data: pickRosterRow(data[0]) });
  } catch (err) {
    console.error('[PATCH /api/edit/:token/applications/:appId/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/edit/:token/recruit-status — 모집상태 변경(내부 강사 전용). 공개 화면 즉시 반영.
const RECRUIT_STATUSES = ['recruiting', 'upcoming', 'full', 'closed', 'hidden'];
router.patch('/:token/recruit-status', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return;
    const status = (req.body || {}).recruit_status;
    if (!RECRUIT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: '유효하지 않은 모집상태입니다.' });
    }
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ recruit_status: status, is_open: status === 'recruiting' }) // is_open 호환 동기화
      .eq('id', p.id)
      .eq('edit_token', req.params.token) // 토큰 재확인(경합 방지)
      .select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '모집상태 변경에 실패했습니다.' });
    res.json({ ok: true, recruit_status: data[0].recruit_status });
  } catch (err) {
    console.error('[PATCH /api/edit/:token/recruit-status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/edit/:token/roster.xlsx — 이 프로그램 신청자 명단 엑셀 다운로드(내부 강사 전용)
// body: { password }. 명단 보기와 동일 게이트. 읽기 전용(데이터 변경 없음).
router.post('/:token/roster.xlsx', rosterLimiter, async (req, res) => {
  try {
    const p = await gateRoster(req, res);
    if (!p) return; // gateRoster 가 이미 응답함

    const { data, error } = await supabase
      .from('saessak_applications')
      .select('*')
      .eq('program_id', p.id) // 이 프로그램만
      .order('is_waitlist', { ascending: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    const rows = (data || []).filter(a => a.status !== 'cancelled');
    let acceptedNo = 0, waitlistNo = 0;

    const wb = new ExcelJS.Workbook();
    wb.creator = '석암 디지털새싹';
    wb.created = new Date();
    const ws = wb.addWorksheet('신청자명단');

    ws.columns = [
      { key: 'seq', width: 6 },
      { key: 'status', width: 8 },
      { key: 'student_name', width: 12 },
      { key: 'grade', width: 6 },
      { key: 'class_no', width: 6 },
      { key: 'guardian_name', width: 12 },
      { key: 'guardian_phone', width: 18 },
      { key: 'source', width: 10 },
      { key: 'submitted_at', width: 22 },
      { key: 'motivation', width: 36 },
    ];
    const COLS = ws.columns.length; // 병합 범위 = 전체 열 수

    // 1행: 외부 유출 금지 경고(전 열 병합)
    ws.mergeCells(1, 1, 1, COLS);
    const warn = ws.getCell(1, 1);
    warn.value = '⚠ 외부 유출 금지 · 담당 강사 본인 확인용';
    warn.font = { bold: true, color: { argb: 'FFB00020' } };
    warn.alignment = { horizontal: 'left' };

    // 2행: 프로그램명/요약
    ws.mergeCells(2, 1, 2, COLS);
    ws.getCell(2, 1).value =
      `${p.title || ''} · 접수 ${rows.filter(r => !r.is_waitlist).length}/${p.capacity || 0} · 대기 ${rows.filter(r => r.is_waitlist === true).length}/${p.waitlist_capacity || 0}`;

    // 3행: 헤더
    const header = ws.addRow({
      seq: '순번', status: '상태', student_name: '학생 이름', grade: '학년', class_no: '반',
      guardian_name: '보호자 이름', guardian_phone: '보호자 연락처', source: '경로', submitted_at: '신청일시',
      motivation: '문의사항',
    });
    header.font = { bold: true };

    rows.forEach(r => {
      const row = ws.addRow({
        seq: r.is_waitlist === true ? ++waitlistNo : ++acceptedNo,
        status: r.is_waitlist === true ? '대기' : '접수',
        student_name: r.student_name,
        grade: r.grade,
        class_no: r.class_no,
        guardian_name: r.guardian_name || '',
        guardian_phone: r.guardian_phone || '',
        source: r.source === 'manual' ? '수동' : '온라인',
        submitted_at: r.submitted_at ? new Date(r.submitted_at).toLocaleString('ko-KR') : '',
        motivation: r.motivation || '',
      });
      if (r.motivation) row.getCell('motivation').alignment = { wrapText: true, vertical: 'top' };
    });

    const buf = await wb.xlsx.writeBuffer();
    const safeTitle = String(p.title || '프로그램').replace(/[\\/?*\[\]:]/g, '_').slice(0, 40);
    const fname = `${safeTitle}_신청자명단_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 한글 파일명은 RFC 5987 filename* 로 안전 전달.
    res.setHeader('Content-Disposition', `attachment; filename="roster.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[POST /api/edit/:token/roster.xlsx]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
