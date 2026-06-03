// 프로그램 개설 위임 라우터 — /api/create 아래 마운트(관리자 인증 없음).
// 보안: 무작위 토큰(creator_tokens.token) + enabled=true + 개설자 비밀번호(CREATOR_PASSWORD_HASH).
// 강사 수정 페이지(routes/edit.js)의 토큰+허용+비번 게이트 패턴을 그대로 본떴다.
// 중요: 개설분은 항상 '숨김'으로 생성, 본인이 만든 프로그램만 스코프(서버 강제). 학생 개인정보 접근 없음.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const router = express.Router();
const supabase = require('../utils/supabase');
const { normalizeMobile } = require('../utils/phone');
const { buildCreatePayload, buildCreatorUpdatePatch } = require('../utils/program-fields');

const MIN_TOKEN_LEN = 16;

function creatorPassConfigured() {
  return !!(process.env.CREATOR_PASSWORD_HASH && process.env.CREATOR_PASSWORD_HASH.trim());
}
async function checkCreatorPass(pw) {
  if (!creatorPassConfigured()) return false;
  if (!pw || typeof pw !== 'string') return false;
  try { return await bcrypt.compare(pw, process.env.CREATOR_PASSWORD_HASH); }
  catch { return false; }
}
async function findCreatorToken(token) {
  if (!token || String(token).length < MIN_TOKEN_LEN) return null;
  const { data, error } = await supabase
    .from('creator_tokens').select('*').eq('token', token).maybeSingle();
  if (error) return null;
  return data || null;
}
// 공통 게이트: 토큰 유효 + enabled=true + 개설자 비번 일치. 통과 시 토큰행 반환, 실패 시 res 응답 후 null.
async function gateCreator(req, res) {
  if (!creatorPassConfigured()) {
    res.status(503).json({ ok: false, error: '개설 기능이 아직 설정되지 않았습니다. 관리자에게 문의하세요.' });
    return null;
  }
  const t = await findCreatorToken(req.params.token);
  if (!t) { res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' }); return null; }
  if (t.enabled !== true) { res.status(403).json({ ok: false, error: '현재 비활성화된 링크입니다. 관리자에게 문의하세요.' }); return null; }
  const ok = await checkCreatorPass((req.body || {}).password);
  if (!ok) { res.status(401).json({ ok: false, error: '개설자 비밀번호가 올바르지 않습니다.' }); return null; }
  return t;
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 80, keyGenerator: (req) => req.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

// 개설자에게 보여줄 프로그램 필드만(개인정보 없음 — 애초에 프로그램 테이블엔 학생정보 없음).
function pickProgram(p) {
  return {
    id: p.id, title: p.title, description: p.description, schedule: p.schedule, location: p.location,
    grades: p.grades, capacity: p.capacity, waitlist_capacity: p.waitlist_capacity,
    instructors: p.instructors, organization: p.organization,
    session_dates: p.session_dates, start_time: p.start_time, end_time: p.end_time, extra_sessions: p.extra_sessions,
    is_type_multicultural: p.is_type_multicultural, is_type_sibling: p.is_type_sibling, type_custom: p.type_custom,
    program_type: p.program_type, multicultural_min: p.multicultural_min, recruit_status: p.recruit_status,
  };
}

// GET /api/create/:token — 페이지 부트스트랩(비번 없이): 토큰 유효/활성 + 라벨만.
router.get('/:token', async (req, res) => {
  try {
    if (!creatorPassConfigured()) return res.status(503).json({ ok: false, error: '개설 기능이 아직 설정되지 않았습니다.' });
    const t = await findCreatorToken(req.params.token);
    if (!t) return res.status(404).json({ ok: false, error: '유효하지 않은 링크입니다.' });
    if (t.enabled !== true) return res.status(403).json({ ok: false, error: '현재 비활성화된 링크입니다. 관리자에게 문의하세요.' });
    res.json({ ok: true, label: t.label || '', needsPassword: true });
  } catch (err) {
    console.error('[GET /api/create/:token]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/create/:token/programs/list — 내가 만든 프로그램만(비번 게이트).
router.post('/:token/programs/list', limiter, async (req, res) => {
  try {
    const t = await gateCreator(req, res);
    if (!t) return;
    const { data: links, error: lErr } = await supabase
      .from('program_creators').select('program_id').eq('created_by_token', t.token);
    if (lErr) throw lErr;
    const ids = (links || []).map(l => l.program_id);
    let programs = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from('saessak_programs').select('*').in('id', ids).order('created_at', { ascending: false });
      if (error) throw error;
      programs = (data || []).map(pickProgram);
    }
    res.json({ ok: true, label: t.label || '', data: programs });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/list]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/create/:token/programs — 새 프로그램 개설. 항상 '숨김'으로 생성 + program_creators 기록.
router.post('/:token/programs', limiter, async (req, res) => {
  try {
    const t = await gateCreator(req, res);
    if (!t) return;
    const { payload, error: vErr } = buildCreatePayload(req.body, { forceStatus: 'hidden' }); // ★ 무조건 숨김
    if (vErr) return res.status(400).json({ ok: false, error: vErr });
    const { data, error } = await supabase.from('saessak_programs').insert([payload]).select();
    if (error) throw error;
    const created = data[0];
    // 개설자 귀속 기록(누가 만들었는지) — 스코프/검토용
    const { error: cErr } = await supabase.from('program_creators').insert([{
      program_id: created.id,
      created_by_token: t.token,
      created_by_label: t.label || null,
    }]);
    if (cErr) throw cErr;
    res.json({ ok: true, data: pickProgram(created) });
  } catch (err) {
    console.error('[POST /api/create/:token/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/create/:token/programs/:id — 본인 프로그램만 수정(서버에서 스코프 강제).
router.put('/:token/programs/:id', limiter, async (req, res) => {
  try {
    const t = await gateCreator(req, res);
    if (!t) return;
    // ★ 스코프: 이 토큰이 개설한 프로그램인지 program_creators 로 검증(클라 필터 의존 금지)
    const { data: link, error: lErr } = await supabase
      .from('program_creators').select('program_id')
      .eq('created_by_token', t.token).eq('program_id', req.params.id).maybeSingle();
    if (lErr) throw lErr;
    if (!link) return res.status(403).json({ ok: false, error: '본인이 개설한 프로그램만 수정할 수 있습니다.' });
    const { patch, error: vErr } = buildCreatorUpdatePatch(req.body);
    if (vErr) return res.status(400).json({ ok: false, error: vErr });
    // recruit_status/is_open/edit_enabled 등은 patch 에 포함되지 않음(공개 전환은 관리자만).
    const { data, error } = await supabase
      .from('saessak_programs').update(patch).eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ ok: true, data: data && data[0] ? pickProgram(data[0]) : null });
  } catch (err) {
    console.error('[PUT /api/create/:token/programs/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 자기 프로그램 신청자·문의 관리 (개설자) =====
// 모든 동작: gateCreator(토큰+허용+비번) 통과 + program_creators 에 (내 토큰, :id) 링크 있어야 함.
// 학생 개인정보(명단)는 본인이 개설한 프로그램에 한해서만 노출. 모집상태 변경 권한은 없음(관리자 전용).

// 게이트 통과한 토큰 t 가 program(:id) 의 소유주인지 확인하고 프로그램 행 반환. 아니면 403/404.
async function loadOwnedProgram(req, res, t) {
  const pid = req.params.id;
  const { data: link, error: lErr } = await supabase
    .from('program_creators').select('program_id')
    .eq('created_by_token', t.token).eq('program_id', pid).maybeSingle();
  if (lErr) throw lErr;
  if (!link) { res.status(403).json({ ok: false, error: '본인이 개설한 프로그램만 관리할 수 있습니다.' }); return null; }
  const { data: p, error: pErr } = await supabase
    .from('saessak_programs').select('*').eq('id', pid).maybeSingle();
  if (pErr) throw pErr;
  if (!p) { res.status(404).json({ ok: false, error: '프로그램을 찾을 수 없습니다.' }); return null; }
  return p;
}
// gateCreator + loadOwnedProgram 을 한 번에. 실패 시 res 처리 후 null.
async function gateOwned(req, res) {
  const t = await gateCreator(req, res);
  if (!t) return null;
  const p = await loadOwnedProgram(req, res, t);
  if (!p) return null;
  return { t, p };
}

function pickRosterRow(a) {
  return {
    id: a.id, student_name: a.student_name, grade: a.grade, class_no: a.class_no,
    guardian_name: a.guardian_name, guardian_phone: a.guardian_phone,
    is_waitlist: a.is_waitlist === true, status: a.status, source: a.source,
    submitted_at: a.submitted_at, motivation: a.motivation || null,
  };
}
function creatorActor(t, token) {
  const label = (t && t.label && String(t.label).trim()) || '';
  return label ? `개설자(${label})` : `개설자(${String(token).slice(0, 8)})`;
}
const APP_STATUSES = ['applied', 'selected', 'waiting', 'cancelled'];
const NOTE_TYPES = ['noshow', 'attitude', 'etc'];

// 이 프로그램의 수동 신청 행만(온라인 보호). 통과 시 행, 실패 시 res 후 null.
async function findManualRow(programId, appId, res) {
  const { data, error } = await supabase.from('saessak_applications').select('*').eq('id', appId).maybeSingle();
  if (error) throw error;
  if (!data || String(data.program_id) !== String(programId)) { res.status(404).json({ ok: false, error: '신청 건을 찾을 수 없습니다.' }); return null; }
  if (data.source !== 'manual') { res.status(409).json({ ok: false, error: '온라인 신청 건은 관리자에게 문의해 주세요.' }); return null; }
  return data;
}

// POST /:token/programs/:id/roster — 신청자 명단(본인 프로그램만).
router.post('/:token/programs/:id/roster', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const { data, error } = await supabase
      .from('saessak_applications').select('*').eq('program_id', p.id)
      .order('is_waitlist', { ascending: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (error) throw error;
    const rows = (data || []).map(pickRosterRow);
    let acceptedNo = 0, waitlistNo = 0;
    const list = rows.map(r => {
      let seq = '';
      if (r.status !== 'cancelled') seq = r.is_waitlist ? ++waitlistNo : ++acceptedNo;
      return { ...r, seq };
    });
    res.json({
      ok: true,
      program: { title: p.title || '', capacity: p.capacity || 0, waitlist_capacity: p.waitlist_capacity || 0, grades: p.grades || [], recruit_status: p.recruit_status || (p.is_open ? 'recruiting' : 'hidden') },
      accepted_count: acceptedNo, waitlist_count: waitlistNo, data: list,
    });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/roster]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/applications — 수동 신청 입력(본인 프로그램만).
router.post('/:token/programs/:id/applications', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const b = req.body || {};
    const studentName = b.student_name ? String(b.student_name).trim() : '';
    if (!studentName) return res.status(400).json({ ok: false, error: '학생 이름을 입력하세요.' });
    const grade = Number(b.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력하세요.' });
    const classNo = Number(b.class_no);
    if (!Number.isInteger(classNo) || classNo < 1 || classNo > 30) return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력하세요.' });
    const grades = Array.isArray(p.grades) ? p.grades : [];
    if (!grades.includes(grade)) return res.status(400).json({ ok: false, error: `이 프로그램은 ${grades.join(',')}학년 대상입니다.` });
    const guardianName = b.guardian_name ? String(b.guardian_name).trim() : null;
    const guardianPhone = b.guardian_phone ? normalizeMobile(b.guardian_phone) : null;
    const { data: apps, error: cErr } = await supabase.from('saessak_applications').select('*').eq('program_id', p.id);
    if (cErr) throw cErr;
    let aCount = 0, wCount = 0;
    (apps || []).forEach(a => { if (a.status === 'cancelled') return; if (a.is_waitlist) wCount++; else aCount++; });
    const dup = (apps || []).some(a => a.status !== 'cancelled' && a.student_name === studentName && (guardianPhone ? a.guardian_phone === guardianPhone : true));
    if (dup) return res.status(409).json({ ok: false, error: '이미 이 프로그램에 등록된 학생입니다.' });
    const cap = Number(p.capacity) || 0, wcap = Number(p.waitlist_capacity) || 0;
    let isWait, slotNumber;
    if (aCount < cap) { isWait = false; slotNumber = aCount + 1; }
    else if (wCount < wcap) { isWait = true; slotNumber = wCount + 1; }
    else return res.status(409).json({ ok: false, error: '정원과 대기 인원이 모두 찼습니다.' });
    const { data: inserted, error: iErr } = await supabase.from('saessak_applications').insert([{
      program_id: p.id, student_name: studentName, grade, class_no: classNo,
      guardian_name: guardianName, guardian_phone: guardianPhone, student_phone: null, motivation: null,
      privacy_agreed: true, status: 'applied', source: 'manual', submitted_at: new Date().toISOString(),
      is_multicultural: false, sibling_group_id: null, is_waitlist: isWait,
    }]).select();
    if (iErr) throw iErr;
    res.json({ ok: true, is_waitlist: isWait, slot_number: slotNumber, data: pickRosterRow(inserted[0]) });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/applications]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /:token/programs/:id/applications/:appId — 수동 신청 수정.
router.put('/:token/programs/:id/applications/:appId', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const row = await findManualRow(p.id, req.params.appId, res); if (!row) return;
    const b = req.body || {};
    const patch = {};
    if ('student_name' in b) { const name = b.student_name ? String(b.student_name).trim() : ''; if (!name) return res.status(400).json({ ok: false, error: '학생 이름을 입력하세요.' }); patch.student_name = name; }
    const grades = Array.isArray(p.grades) ? p.grades : [];
    if ('grade' in b) { const grade = Number(b.grade); if (!Number.isInteger(grade) || grade < 1 || grade > 6) return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력하세요.' }); if (!grades.includes(grade)) return res.status(400).json({ ok: false, error: `이 프로그램은 ${grades.join(',')}학년 대상입니다.` }); patch.grade = grade; }
    if ('class_no' in b) { const classNo = Number(b.class_no); if (!Number.isInteger(classNo) || classNo < 1 || classNo > 30) return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력하세요.' }); patch.class_no = classNo; }
    if ('guardian_name' in b) patch.guardian_name = b.guardian_name ? String(b.guardian_name).trim() : null;
    if ('guardian_phone' in b) patch.guardian_phone = b.guardian_phone ? normalizeMobile(b.guardian_phone) : null;
    const { data, error } = await supabase.from('saessak_applications').update(patch).eq('id', row.id).eq('program_id', p.id).eq('source', 'manual').select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '수정에 실패했습니다.' });
    res.json({ ok: true, data: pickRosterRow(data[0]) });
  } catch (err) {
    console.error('[PUT /api/create/:token/programs/:id/applications/:appId]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /:token/programs/:id/applications/:appId — 수동 신청 삭제.
router.delete('/:token/programs/:id/applications/:appId', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const row = await findManualRow(p.id, req.params.appId, res); if (!row) return;
    const { error } = await supabase.from('saessak_applications').delete().eq('id', row.id).eq('program_id', p.id).eq('source', 'manual');
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/create/:token/programs/:id/applications/:appId]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /:token/programs/:id/applications/:appId/status — 선정/상태 변경(온라인·수동 모두, status 만).
router.patch('/:token/programs/:id/applications/:appId/status', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const status = (req.body || {}).status;
    if (!APP_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: '유효하지 않은 상태입니다.' });
    const { data: row, error: e0 } = await supabase.from('saessak_applications').select('id, program_id').eq('id', req.params.appId).maybeSingle();
    if (e0) throw e0;
    if (!row || String(row.program_id) !== String(p.id)) return res.status(404).json({ ok: false, error: '신청 건을 찾을 수 없습니다.' });
    const { data, error } = await supabase.from('saessak_applications').update({ status }).eq('id', row.id).eq('program_id', p.id).select();
    if (error) throw error;
    if (!data || !data[0]) return res.status(409).json({ ok: false, error: '상태 변경에 실패했습니다.' });
    res.json({ ok: true, data: pickRosterRow(data[0]) });
  } catch (err) {
    console.error('[PATCH /api/create/:token/programs/:id/applications/:appId/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/roster.xlsx — 명단 엑셀 다운로드(읽기 전용).
router.post('/:token/programs/:id/roster.xlsx', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const { data, error } = await supabase.from('saessak_applications').select('*').eq('program_id', p.id)
      .order('is_waitlist', { ascending: true }).order('display_order', { ascending: true, nullsFirst: false }).order('submitted_at', { ascending: true });
    if (error) throw error;
    const rows = (data || []).filter(a => a.status !== 'cancelled');
    let acceptedNo = 0, waitlistNo = 0;
    const wb = new ExcelJS.Workbook(); wb.creator = '석암 디지털새싹'; wb.created = new Date();
    const ws = wb.addWorksheet('신청자명단');
    ws.columns = [
      { key: 'seq', width: 6 }, { key: 'status', width: 8 }, { key: 'student_name', width: 12 },
      { key: 'grade', width: 6 }, { key: 'class_no', width: 6 }, { key: 'guardian_name', width: 12 },
      { key: 'guardian_phone', width: 18 }, { key: 'source', width: 10 }, { key: 'submitted_at', width: 22 }, { key: 'motivation', width: 36 },
    ];
    const COLS = ws.columns.length;
    ws.mergeCells(1, 1, 1, COLS);
    const warn = ws.getCell(1, 1); warn.value = '⚠ 외부 유출 금지 · 개설자 본인 확인용'; warn.font = { bold: true, color: { argb: 'FFB00020' } };
    ws.mergeCells(2, 1, 2, COLS);
    ws.getCell(2, 1).value = `${p.title || ''} · 접수 ${rows.filter(r => !r.is_waitlist).length}/${p.capacity || 0} · 대기 ${rows.filter(r => r.is_waitlist === true).length}/${p.waitlist_capacity || 0}`;
    const header = ws.addRow({ seq: '순번', status: '상태', student_name: '학생 이름', grade: '학년', class_no: '반', guardian_name: '보호자 이름', guardian_phone: '보호자 연락처', source: '경로', submitted_at: '신청일시', motivation: '문의사항' });
    header.font = { bold: true };
    rows.forEach(r => {
      const row = ws.addRow({
        seq: r.is_waitlist === true ? ++waitlistNo : ++acceptedNo, status: r.is_waitlist === true ? '대기' : '접수',
        student_name: r.student_name, grade: r.grade, class_no: r.class_no, guardian_name: r.guardian_name || '',
        guardian_phone: r.guardian_phone || '', source: r.source === 'manual' ? '수동' : '온라인',
        submitted_at: r.submitted_at ? new Date(r.submitted_at).toLocaleString('ko-KR') : '', motivation: r.motivation || '',
      });
      if (r.motivation) row.getCell('motivation').alignment = { wrapText: true, vertical: 'top' };
    });
    const buf = await wb.xlsx.writeBuffer();
    const safeTitle = String(p.title || '프로그램').replace(/[\\/?*\[\]:]/g, '_').slice(0, 40);
    const fname = `${safeTitle}_신청자명단_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="roster.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/roster.xlsx]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/student-notes/list — 참고기록 일괄 조회(매칭용).
router.post('/:token/programs/:id/student-notes/list', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { data, error } = await supabase.from('student_notes').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/student-notes/list]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/student-notes — 참고기록 추가(개설자).
router.post('/:token/programs/:id/student-notes', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { t, p } = g;
    const b = req.body || {};
    const student_name = b.student_name ? String(b.student_name).trim() : '';
    if (!student_name) return res.status(400).json({ ok: false, error: '학생 이름이 필요합니다.' });
    const note_type = NOTE_TYPES.includes(b.note_type) ? b.note_type : 'etc';
    const content = b.content ? String(b.content).trim() : '';
    const row = {
      student_name,
      grade: (b.grade === undefined || b.grade === null || b.grade === '') ? null : Number(b.grade),
      class_no: (b.class_no === undefined || b.class_no === null || b.class_no === '') ? null : Number(b.class_no),
      guardian_contact: b.guardian_contact ? String(b.guardian_contact).trim() : null,
      program_id: p.id, note_type, content, created_by: creatorActor(t, req.params.token),
    };
    const { data, error } = await supabase.from('student_notes').insert([row]).select();
    if (error) throw error;
    res.json({ ok: true, data: (data && data[0]) || null });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/student-notes]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/inquiries/list — 이 프로그램 문의 + 답변상태(일괄).
router.post('/:token/programs/:id/inquiries/list', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { p } = g;
    const { data: apps, error: aErr } = await supabase.from('saessak_applications').select('*')
      .eq('program_id', p.id).not('motivation', 'is', null).order('submitted_at', { ascending: false });
    if (aErr) throw aErr;
    const filtered = (apps || []).filter(a => a.motivation && String(a.motivation).trim());
    const ids = filtered.map(a => String(a.id));
    const statusMap = {};
    if (ids.length) {
      const { data: st, error: sErr } = await supabase.from('inquiry_status').select('*').in('application_id', ids);
      if (sErr) throw sErr;
      (st || []).forEach(s => { statusMap[String(s.application_id)] = s; });
    }
    const out = filtered.map(a => {
      const s = statusMap[String(a.id)];
      return {
        id: a.id, student_name: a.student_name, grade: a.grade, class_no: a.class_no,
        guardian_name: a.guardian_name, guardian_phone: a.guardian_phone, motivation: a.motivation,
        submitted_at: a.submitted_at, status: a.status,
        answered: !!(s && s.answered), answered_by: s ? s.answered_by : null, answered_at: s ? s.answered_at : null,
      };
    });
    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/inquiries/list]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:token/programs/:id/inquiries/status — 답변 상태 토글(이 프로그램 문의만).
router.post('/:token/programs/:id/inquiries/status', limiter, async (req, res) => {
  try {
    const g = await gateOwned(req, res); if (!g) return;
    const { t, p } = g;
    const { application_id, answered } = req.body || {};
    if (!application_id) return res.status(400).json({ ok: false, error: 'application_id 가 필요합니다.' });
    const { data: app, error: gErr } = await supabase.from('saessak_applications').select('id, program_id').eq('id', application_id).maybeSingle();
    if (gErr) throw gErr;
    if (!app || String(app.program_id) !== String(p.id)) return res.status(403).json({ ok: false, error: '이 프로그램의 문의가 아닙니다.' });
    const row = {
      application_id: String(application_id),
      answered: answered === true || answered === 'true',
      answered_by: creatorActor(t, req.params.token),
      answered_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('inquiry_status').upsert(row, { onConflict: 'application_id' });
    if (error) throw error;
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[POST /api/create/:token/programs/:id/inquiries/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
