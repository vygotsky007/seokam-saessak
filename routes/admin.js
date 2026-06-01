const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const ExcelJS = require('exceljs');
const supabase = require('../utils/supabase');
const { normalizeMobile } = require('../utils/phone');

// 강사용 수정 링크 토큰: 48자 hex(24바이트) — 추측 불가능한 길이.
function genEditToken() {
  return crypto.randomBytes(24).toString('hex');
}

const RECRUIT_STATUSES = ['recruiting', 'upcoming', 'full', 'closed', 'hidden'];
function normalizeRecruitStatus(v) {
  return RECRUIT_STATUSES.includes(v) ? v : null;
}

router.get('/me', (req, res) => {
  res.json({ ok: true, isAdmin: true, loggedAt: req.session.loggedAt });
});

router.get('/programs', async (req, res) => {
  // 관리자 화면은 닫힌 프로그램도 봐야 하므로 is_open 필터 없이 모두 반환.
  try {
    const { data: programs, error } = await supabase
      .from('saessak_programs')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const ids = (programs || []).map(p => p.id);
    let appliedCounts = {};
    let waitlistCounts = {};
    let selectedCounts = {};
    if (ids.length > 0) {
      // is_waitlist 컬럼이 PostgREST schema cache 갱신 전이라도 select('*')는 안전.
      const { data: apps, error: aErr } = await supabase
        .from('saessak_applications')
        .select('*')
        .in('program_id', ids);
      if (aErr) throw aErr;
      (apps || []).forEach(a => {
        if (a.status === 'cancelled') return;
        if (a.is_waitlist) waitlistCounts[a.program_id] = (waitlistCounts[a.program_id] || 0) + 1;
        else appliedCounts[a.program_id] = (appliedCounts[a.program_id] || 0) + 1;
        if (a.status === 'selected') {
          selectedCounts[a.program_id] = (selectedCounts[a.program_id] || 0) + 1;
        }
      });
    }

    const result = (programs || []).map(p => ({
      ...p,
      applied_count: appliedCounts[p.id] || 0,
      waitlist_count: waitlistCounts[p.id] || 0,
      selected_count: selectedCounts[p.id] || 0,
      remaining: Math.max(0, (p.capacity || 0) - (appliedCounts[p.id] || 0)),
      waitlist_remaining: Math.max(0, (p.waitlist_capacity || 0) - (waitlistCounts[p.id] || 0)),
    }));

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[GET admin/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
    input
      .map(v => String(v || '').trim())
      .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v))
  )).sort();
  return out.length > 0 ? out : null;
}

function normalizeTime(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  // HH:MM 또는 HH:MM:SS 허용 → HH:MM 으로 통일
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 보충 회차 배열 정규화: [{date:YYYY-MM-DD, start:HH:MM, end:HH:MM}, ...]
// 날짜/시작/종료가 모두 유효한 항목만 남기고 날짜+시작시각 순으로 정렬. 항상 배열 반환.
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

router.post('/programs', async (req, res) => {
  try {
    const {
      title, description, schedule, location,
      grades, capacity, waitlist_capacity, instructors, is_open,
      program_type, multicultural_min,
      session_dates, start_time, end_time,
      recruit_status,
      is_type_multicultural, is_type_sibling,
      type_custom,
      organization,
      extra_sessions,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, error: '프로그램명을 입력하세요.' });
    }
    const gradesNorm = normalizeGrades(grades);
    if (!gradesNorm) {
      return res.status(400).json({ ok: false, error: '대상 학년을 1개 이상 선택하세요.' });
    }
    // 다중 유형 입력 (없으면 program_type 에서 추정)
    const tMulti = (typeof is_type_multicultural === 'boolean')
      ? is_type_multicultural
      : program_type === 'multicultural';
    const tSib   = (typeof is_type_sibling === 'boolean')
      ? is_type_sibling
      : program_type === 'sibling';
    // 호환용 program_type: 다문화 > 형제 > 일반 우선순위
    const ptype = tMulti ? 'multicultural' : (tSib ? 'sibling' : 'general');
    const status = normalizeRecruitStatus(recruit_status) || 'hidden';
    const payload = {
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      schedule: schedule ? String(schedule).trim() : null,
      location: location ? String(location).trim() : null,
      grades: gradesNorm,
      capacity: Number(capacity) || 0,
      waitlist_capacity: waitlist_capacity === undefined || waitlist_capacity === null || waitlist_capacity === ''
        ? 10 : Math.max(0, Number(waitlist_capacity) || 0),
      instructors: instructors ? String(instructors).trim() : null,
      organization: organization ? String(organization).trim() : null,
      recruit_status: status,
      is_open: status === 'recruiting',
      program_type: ptype,
      is_type_multicultural: tMulti,
      is_type_sibling: tSib,
      type_custom: (type_custom === null || type_custom === undefined || String(type_custom).trim() === '')
        ? null : String(type_custom).trim(),
      multicultural_min: tMulti
        ? (multicultural_min === '' || multicultural_min === null || multicultural_min === undefined ? null : Number(multicultural_min))
        : null,
      session_dates: normalizeSessionDates(session_dates),
      start_time: normalizeTime(start_time),
      end_time: normalizeTime(end_time),
      extra_sessions: normalizeExtraSessions(extra_sessions),
      edit_token: genEditToken(),   // 강사용 수정 링크 토큰 자동 발급
      edit_enabled: false,          // 강사 수정 권한 기본 off
    };
    const { data, error } = await supabase
      .from('saessak_programs')
      .insert([payload])
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[POST admin/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['title', 'description', 'schedule', 'location',
      'grades', 'capacity', 'waitlist_capacity', 'instructors', 'is_open',
      'program_type', 'multicultural_min',
      'session_dates', 'start_time', 'end_time',
      'extra_sessions',
      'recruit_status',
      'is_type_multicultural', 'is_type_sibling',
      'type_custom',
      'edit_enabled',
      'organization'];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if ('grades' in patch) {
      const g = normalizeGrades(patch.grades);
      if (!g) {
        return res.status(400).json({ ok: false, error: '대상 학년을 1개 이상 선택하세요.' });
      }
      patch.grades = g;
    }
    if ('capacity' in patch) patch.capacity = Number(patch.capacity);
    if ('waitlist_capacity' in patch) patch.waitlist_capacity = Math.max(0, Number(patch.waitlist_capacity) || 0);
    if ('recruit_status' in patch) {
      const s = normalizeRecruitStatus(patch.recruit_status);
      if (!s) return res.status(400).json({ ok: false, error: '유효하지 않은 모집 상태' });
      patch.recruit_status = s;
      patch.is_open = s === 'recruiting'; // 호환 동기화
    } else if ('is_open' in patch) {
      patch.is_open = patch.is_open === true || patch.is_open === 'true';
    }
    // 다중 유형: 클라이언트가 새 boolean 들을 보냈으면 program_type 도 함께 동기화
    if ('is_type_multicultural' in patch) {
      patch.is_type_multicultural = patch.is_type_multicultural === true || patch.is_type_multicultural === 'true';
    }
    if ('is_type_sibling' in patch) {
      patch.is_type_sibling = patch.is_type_sibling === true || patch.is_type_sibling === 'true';
    }
    if ('is_type_multicultural' in patch || 'is_type_sibling' in patch) {
      const m = patch.is_type_multicultural === true;
      const s = patch.is_type_sibling === true;
      patch.program_type = m ? 'multicultural' : (s ? 'sibling' : 'general');
    } else if ('program_type' in patch) {
      if (!['general', 'multicultural', 'sibling'].includes(patch.program_type)) {
        patch.program_type = 'general';
      }
    }
    if ('multicultural_min' in patch) {
      patch.multicultural_min = (patch.multicultural_min === '' || patch.multicultural_min === null || patch.multicultural_min === undefined)
        ? null : Number(patch.multicultural_min);
    }
    // 다문화 우대가 아니면 multicultural_min 강제 null
    const isMultiAfter = ('is_type_multicultural' in patch)
      ? patch.is_type_multicultural === true
      : patch.program_type === 'multicultural';
    if (!isMultiAfter) {
      patch.multicultural_min = null;
    }
    if ('session_dates' in patch) patch.session_dates = normalizeSessionDates(patch.session_dates);
    if ('start_time' in patch) patch.start_time = normalizeTime(patch.start_time);
    if ('end_time' in patch) patch.end_time = normalizeTime(patch.end_time);
    if ('extra_sessions' in patch) patch.extra_sessions = normalizeExtraSessions(patch.extra_sessions);
    if ('organization' in patch) {
      const o = patch.organization;
      patch.organization = (o === null || o === undefined || String(o).trim() === '') ? null : String(o).trim();
    }
    if ('type_custom' in patch) {
      const tc = patch.type_custom;
      patch.type_custom = (tc === null || tc === undefined || String(tc).trim() === '') ? null : String(tc).trim();
    }
    if ('edit_enabled' in patch) {
      patch.edit_enabled = patch.edit_enabled === true || patch.edit_enabled === 'true';
    }

    const { data, error } = await supabase
      .from('saessak_programs')
      .update(patch)
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PUT admin/programs/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/programs/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeRecruitStatus((req.body || {}).recruit_status);
    if (!status) return res.status(400).json({ ok: false, error: '유효하지 않은 모집 상태' });
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ recruit_status: status, is_open: status === 'recruiting' })
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH admin/programs/:id/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('saessak_applications').delete().eq('program_id', id);
    const { error } = await supabase
      .from('saessak_programs')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE admin/programs/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 강사 수정 권한 on/off 토글
router.patch('/programs/:id/edit-permission', async (req, res) => {
  try {
    const { id } = req.params;
    const enabled = (req.body || {}).edit_enabled === true || (req.body || {}).edit_enabled === 'true';
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ edit_enabled: enabled })
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH admin/programs/:id/edit-permission]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 강사용 토큰 재발급(기존 링크 즉시 무효화)
router.post('/programs/:id/regenerate-token', async (req, res) => {
  try {
    const { id } = req.params;
    const token = genEditToken();
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ edit_token: token })
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0], edit_token: token });
  } catch (err) {
    console.error('[POST admin/programs/:id/regenerate-token]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/applications', async (req, res) => {
  try {
    const { program_id } = req.query;
    let q = supabase
      .from('saessak_applications')
      .select('*, program:saessak_programs(*)')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (program_id) q = q.eq('program_id', program_id);
    const { data, error } = await q;
    if (error) throw error;

    // 동명이인 의심: 같은 (guardian_phone, student_name) 인데 (grade, class_no) 가 둘 이상.
    // 신청 자체를 막진 않고, 관리자에게 경고 배지만 띄움.
    const { data: allApps, error: aErr } = await supabase
      .from('saessak_applications')
      .select('student_name, guardian_phone, grade, class_no, status');
    if (aErr) throw aErr;
    const buckets = {};
    (allApps || []).forEach(a => {
      if (!a.student_name || !a.guardian_phone) return;
      if (a.status === 'cancelled') return;
      const k = `${a.guardian_phone}::${a.student_name}`;
      (buckets[k] = buckets[k] || new Set()).add(`${a.grade ?? '?'}-${a.class_no ?? '?'}`);
    });
    const conflictKeys = new Set();
    Object.entries(buckets).forEach(([k, set]) => { if (set.size >= 2) conflictKeys.add(k); });

    const out = (data || []).map(a => ({
      ...a,
      name_conflict: conflictKeys.has(`${a.guardian_phone}::${a.student_name}`),
    }));
    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('[GET admin/applications]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/applications', async (req, res) => {
  try {
    const {
      program_id, student_name, grade, class_no,
      guardian_name, guardian_phone, student_phone, motivation,
      status, source, is_multicultural, sibling_group_id,
    } = req.body || {};
    if (!program_id) return res.status(400).json({ ok: false, error: 'program_id가 필요합니다.' });
    if (!student_name) return res.status(400).json({ ok: false, error: '학생 이름이 필요합니다.' });

    const payload = {
      program_id,
      student_name: String(student_name).trim(),
      grade: Number(grade) || null,
      class_no: Number(class_no) || null,
      guardian_name: guardian_name ? String(guardian_name).trim() : null,
      guardian_phone: guardian_phone ? normalizeMobile(guardian_phone) : null,
      student_phone: student_phone ? normalizeMobile(student_phone) : null,
      motivation: motivation ? String(motivation).trim() : null,
      privacy_agreed: true,
      status: status || 'applied',
      source: source || 'manual',
      submitted_at: new Date().toISOString(),
      is_multicultural: is_multicultural === true || is_multicultural === 'true',
      sibling_group_id: sibling_group_id ? String(sibling_group_id) : null,
    };
    const { data, error } = await supabase
      .from('saessak_applications')
      .insert([payload])
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[POST admin/applications]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['student_name', 'grade', 'class_no', 'guardian_name',
      'guardian_phone', 'student_phone', 'motivation', 'status', 'display_order',
      'is_multicultural', 'sibling_group_id'];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if ('grade' in patch) patch.grade = Number(patch.grade) || null;
    if ('class_no' in patch) patch.class_no = Number(patch.class_no) || null;
    if ('display_order' in patch) patch.display_order = Number(patch.display_order);
    if ('is_multicultural' in patch) patch.is_multicultural = patch.is_multicultural === true || patch.is_multicultural === 'true';
    if ('sibling_group_id' in patch) {
      patch.sibling_group_id = patch.sibling_group_id ? String(patch.sibling_group_id) : null;
    }
    if ('guardian_phone' in patch) patch.guardian_phone = patch.guardian_phone ? normalizeMobile(patch.guardian_phone) : null;
    if ('student_phone' in patch) patch.student_phone = patch.student_phone ? normalizeMobile(patch.student_phone) : null;

    const { data, error } = await supabase
      .from('saessak_applications')
      .update(patch)
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PUT admin/applications/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/applications/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['applied', 'selected', 'waiting', 'cancelled'].includes(status)) {
      return res.status(400).json({ ok: false, error: '유효하지 않은 status' });
    }
    const { data, error } = await supabase
      .from('saessak_applications')
      .update({ status })
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH admin/applications/:id/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/applications/reorder', async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: 'items 배열이 필요합니다.' });
    }
    for (const item of items) {
      if (!item.id || typeof item.display_order !== 'number') continue;
      const { error } = await supabase
        .from('saessak_applications')
        .update({ display_order: item.display_order })
        .eq('id', item.id);
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST admin/applications/reorder]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('saessak_applications')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE admin/applications/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/applications/:id/copy', async (req, res) => {
  try {
    const { id } = req.params;
    const { target_program_id } = req.body || {};
    if (!target_program_id) {
      return res.status(400).json({ ok: false, error: 'target_program_id가 필요합니다.' });
    }
    const { data: src, error: e1 } = await supabase
      .from('saessak_applications')
      .select('*')
      .eq('id', id)
      .single();
    if (e1) throw e1;
    if (!src) return res.status(404).json({ ok: false, error: '원본 신청을 찾을 수 없습니다.' });

    const { data: dup, error: e2 } = await supabase
      .from('saessak_applications')
      .select('id')
      .eq('program_id', target_program_id)
      .eq('student_name', src.student_name)
      .eq('guardian_phone', src.guardian_phone);
    if (e2) throw e2;
    if (dup && dup.length > 0) {
      return res.status(409).json({ ok: false, error: '대상 프로그램에 동일 학생이 이미 등록되어 있습니다.' });
    }

    const payload = {
      program_id: target_program_id,
      student_name: src.student_name,
      grade: src.grade,
      class_no: src.class_no,
      guardian_name: src.guardian_name,
      guardian_phone: src.guardian_phone,
      student_phone: src.student_phone,
      motivation: src.motivation,
      privacy_agreed: src.privacy_agreed,
      status: 'applied',
      source: 'manual',
      submitted_at: new Date().toISOString(),
      is_multicultural: !!src.is_multicultural,
      sibling_group_id: src.sibling_group_id || null,
    };
    const { data, error } = await supabase
      .from('saessak_applications')
      .insert([payload])
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[POST admin/applications/:id/copy]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const { data: programs, error: pErr } = await supabase
      .from('saessak_programs')
      .select('*')
      .order('created_at', { ascending: true });
    if (pErr) throw pErr;

    const { data: apps, error: aErr } = await supabase
      .from('saessak_applications')
      .select('*');
    if (aErr) throw aErr;

    const active = (apps || []).filter(a => a.status !== 'cancelled');

    const programSummary = (programs || []).map(p => {
      const list = active.filter(a => a.program_id === p.id);
      const appliedList = list.filter(a => !a.is_waitlist);
      const waitlist   = list.filter(a => a.is_waitlist);
      const multiculturalCount = list.filter(a => a.is_multicultural).length;
      return {
        id: p.id,
        title: p.title,
        capacity: p.capacity,
        waitlist_capacity: p.waitlist_capacity,
        applied: appliedList.length,
        waitlisted: waitlist.length,
        remaining: Math.max(0, p.capacity - appliedList.length),
        waitlist_remaining: Math.max(0, (p.waitlist_capacity || 0) - waitlist.length),
        selected: list.filter(a => a.status === 'selected').length,
        is_open: p.is_open,
        program_type: p.program_type || 'general',
        multicultural_min: p.multicultural_min,
        multicultural_count: multiculturalCount,
        multicultural_met: (p.program_type === 'multicultural' && p.multicultural_min != null)
          ? multiculturalCount >= p.multicultural_min
          : null,
      };
    });

    const gradeStats = { low: 0, high: 0, byGrade: {} };
    active.forEach(a => {
      const g = a.grade;
      if (!g) return;
      gradeStats.byGrade[g] = (gradeStats.byGrade[g] || 0) + 1;
      if (g <= 2) gradeStats.low++;
      else gradeStats.high++;
    });

    const studentKey = a => `${a.student_name}::${a.guardian_phone || ''}`;
    const studentMap = {};
    active.forEach(a => {
      const k = studentKey(a);
      if (!studentMap[k]) {
        studentMap[k] = {
          student_name: a.student_name,
          grade: a.grade,
          class_no: a.class_no,
          guardian_phone: a.guardian_phone,
          program_ids: [],
        };
      }
      studentMap[k].program_ids.push(a.program_id);
    });
    const programTitleMap = {};
    (programs || []).forEach(p => { programTitleMap[p.id] = p.title; });
    const multiStudents = Object.values(studentMap)
      .filter(s => s.program_ids.length >= 2)
      .map(s => ({
        ...s,
        program_titles: s.program_ids.map(pid => programTitleMap[pid] || '?'),
        count: s.program_ids.length,
      }))
      .sort((a, b) => b.count - a.count);

    // 형제 묶음 통계
    const siblingGroups = {};
    active.forEach(a => {
      if (!a.sibling_group_id) return;
      const g = siblingGroups[a.sibling_group_id] || (siblingGroups[a.sibling_group_id] = {
        sibling_group_id: a.sibling_group_id,
        students: new Set(),
        program_ids: new Set(),
        guardian_phone: a.guardian_phone,
      });
      g.students.add(a.student_name);
      g.program_ids.add(a.program_id);
    });
    const siblingList = Object.values(siblingGroups).map(g => ({
      sibling_group_id: g.sibling_group_id,
      students: Array.from(g.students),
      program_titles: Array.from(g.program_ids).map(pid => programTitleMap[pid] || '?'),
      guardian_phone: g.guardian_phone,
      student_count: g.students.size,
      application_count: Array.from(g.program_ids).length,
    })).sort((a, b) => b.student_count - a.student_count);

    const multiShortagePrograms = programSummary.filter(
      p => p.program_type === 'multicultural' && p.multicultural_min != null && p.multicultural_count < p.multicultural_min
    );

    res.json({
      ok: true,
      data: {
        programs: programSummary,
        gradeStats,
        multiStudents,
        siblings: siblingList,
        totals: {
          programs: programs.length,
          openPrograms: programs.filter(p => p.is_open).length,
          applications: active.length,
          selected: active.filter(a => a.status === 'selected').length,
          siblingGroups: siblingList.length,
          multiculturalApplicants: active.filter(a => a.is_multicultural).length,
          multiculturalShortage: multiShortagePrograms.length,
        },
      },
    });
  } catch (err) {
    console.error('[GET admin/dashboard]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/export', async (req, res) => {
  try {
    const { program_id, only_selected } = req.query;

    let appQ = supabase
      .from('saessak_applications')
      .select('*, program:saessak_programs(*)')
      .order('program_id')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (program_id) appQ = appQ.eq('program_id', program_id);
    if (only_selected === '1' || only_selected === 'true') {
      appQ = appQ.eq('status', 'selected');
    }
    const { data, error } = await appQ;
    if (error) throw error;

    const wb = new ExcelJS.Workbook();
    wb.creator = '석암 디지털새싹';
    wb.created = new Date();

    const grouped = {};
    (data || []).forEach(row => {
      const pid = row.program_id;
      if (!grouped[pid]) grouped[pid] = { title: row.program ? row.program.title : '미상', rows: [] };
      grouped[pid].rows.push(row);
    });

    if (Object.keys(grouped).length === 0) {
      const ws = wb.addWorksheet('명단');
      ws.addRow(['데이터가 없습니다.']);
    } else {
      Object.keys(grouped).forEach((pid, idx) => {
        const g = grouped[pid];
        const safe = g.title.replace(/[\\/?*\[\]:]/g, '_').slice(0, 28) || `프로그램${idx + 1}`;
        const ws = wb.addWorksheet(safe);
        ws.columns = [
          { header: '번호', key: 'no', width: 6 },
          { header: '학생이름', key: 'student_name', width: 12 },
          { header: '학년', key: 'grade', width: 6 },
          { header: '반', key: 'class_no', width: 6 },
          { header: '보호자', key: 'guardian_name', width: 12 },
          { header: '보호자연락처', key: 'guardian_phone', width: 16 },
          { header: '학생연락처', key: 'student_phone', width: 16 },
          { header: '상태', key: 'status', width: 10 },
          { header: '경로', key: 'source', width: 8 },
          { header: '프로그램유형', key: 'program_type', width: 12 },
          { header: '다문화여부', key: 'is_multicultural', width: 10 },
          { header: '형제묶음ID', key: 'sibling_group_id', width: 36 },
          { header: '문의사항', key: 'motivation', width: 36 },
          { header: '접수시각', key: 'submitted_at', width: 22 },
        ];
        ws.getRow(1).font = { bold: true };
        g.rows.forEach((r, i) => {
          ws.addRow({
            no: i + 1,
            student_name: r.student_name,
            grade: r.grade,
            class_no: r.class_no,
            guardian_name: r.guardian_name,
            guardian_phone: r.guardian_phone,
            student_phone: r.student_phone,
            status: statusLabel(r.status),
            source: r.source === 'manual' ? '수동' : '온라인',
            program_type: programTypeLabel(r.program ? r.program.program_type : null),
            is_multicultural: r.is_multicultural ? 'O' : '',
            sibling_group_id: r.sibling_group_id || '',
            motivation: r.motivation,
            submitted_at: r.submitted_at ? new Date(r.submitted_at).toLocaleString('ko-KR') : '',
          });
        });
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const fname = `saessak_${only_selected ? 'selected_' : ''}${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[GET admin/export]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function statusLabel(s) {
  return {
    applied:   '신청',
    selected:  '선정',
    waiting:   '대기',
    cancelled: '취소',
  }[s] || s;
}
function programTypeLabel(t) {
  return {
    general:       '일반형',
    multicultural: '다문화 우대',
    sibling:       '형제 우대',
  }[t] || (t || '일반형');
}

module.exports = router;
