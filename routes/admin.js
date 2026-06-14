const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

    // 개설 위임 라벨: program_creators 에서 누가 개설했는지(위임 개설분 구분/검토용).
    let creatorLabels = {};
    {
      const { data: pcs } = await supabase.from('program_creators').select('program_id, created_by_label');
      (pcs || []).forEach(pc => { creatorLabels[pc.program_id] = pc.created_by_label || ''; });
    }

    const result = (programs || []).map(p => ({
      ...p,
      applied_count: appliedCounts[p.id] || 0,
      waitlist_count: waitlistCounts[p.id] || 0,
      selected_count: selectedCounts[p.id] || 0,
      remaining: Math.max(0, (p.capacity || 0) - (appliedCounts[p.id] || 0)),
      waitlist_remaining: Math.max(0, (p.waitlist_capacity || 0) - (waitlistCounts[p.id] || 0)),
      created_by_label: (p.id in creatorLabels) ? creatorLabels[p.id] : null, // 위임 개설분이면 라벨, 아니면 null
    }));

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[GET admin/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 산출물(결과물 링크) — program_outputs 만 읽고/쓴다(신청 테이블 무변경). =====
function normOutputUrl(v) {
  const s = (v == null ? '' : String(v)).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : ('https://' + s);
}
// GET /api/program-outputs — 전체 산출물(관리자 입력 폼 프리필용).
router.get('/program-outputs', async (req, res) => {
  try {
    const { data, error } = await supabase.from('program_outputs').select('*');
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[GET admin/program-outputs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
// POST /api/program-outputs — program_id 기준 upsert(관리자). program_name 은 서버에서 프로그램명으로 채움.
router.post('/program-outputs', async (req, res) => {
  try {
    const b = req.body || {};
    const program_id = b.program_id ? String(b.program_id) : '';
    if (!program_id) return res.status(400).json({ ok: false, error: 'program_id 가 필요합니다.' });
    const { data: prog } = await supabase.from('saessak_programs').select('title').eq('id', program_id).maybeSingle();
    const row = {
      program_id,
      program_name: prog ? prog.title : (b.program_name || null),
      summary: b.summary ? String(b.summary).trim() : null,
      output_url: normOutputUrl(b.output_url),
      created_by: '관리자',
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('program_outputs').upsert(row, { onConflict: 'program_id' });
    if (error) throw error;
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[POST admin/program-outputs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 개설자 토큰 관리(프로그램 개설 위임) — 관리자 전용. creator_tokens 만 읽고/쓴다. =====
// GET /api/creator-tokens — 토큰 목록 + 토큰별 개설 프로그램 수.
router.get('/creator-tokens', async (req, res) => {
  try {
    const { data: tokens, error } = await supabase
      .from('creator_tokens').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    const { data: pcs } = await supabase.from('program_creators').select('created_by_token');
    const counts = {};
    (pcs || []).forEach(pc => { counts[pc.created_by_token] = (counts[pc.created_by_token] || 0) + 1; });
    const out = (tokens || []).map(t => ({
      id: t.id, label: t.label, token: t.token, enabled: t.enabled === true,
      created_at: t.created_at, program_count: counts[t.token] || 0,
    }));
    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('[GET admin/creator-tokens]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/creator-tokens — 토큰 발급(라벨 필수). 기본 enabled=false(관리자가 켜야 접근 가능).
router.post('/creator-tokens', async (req, res) => {
  try {
    const label = (req.body || {}).label ? String(req.body.label).trim() : '';
    if (!label) return res.status(400).json({ ok: false, error: '대상 이름/업체명(라벨)을 입력하세요.' });
    const row = { token: genEditToken(), label, enabled: false };
    const { data, error } = await supabase.from('creator_tokens').insert([row]).select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[POST admin/creator-tokens]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/creator-tokens/:id — 허용(enabled) 토글.
router.patch('/creator-tokens/:id', async (req, res) => {
  try {
    const enabled = (req.body || {}).enabled === true || (req.body || {}).enabled === 'true';
    const { data, error } = await supabase
      .from('creator_tokens').update({ enabled }).eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ ok: true, data: data && data[0] });
  } catch (err) {
    console.error('[PATCH admin/creator-tokens/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/creator-tokens/:id/regenerate — 토큰 재발급(기존 링크 즉시 무효).
router.post('/creator-tokens/:id/regenerate', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_tokens').update({ token: genEditToken() }).eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ ok: true, data: data && data[0] });
  } catch (err) {
    console.error('[POST admin/creator-tokens/:id/regenerate]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/creator-tokens/:id — 토큰 삭제(즉시 차단). 개설된 프로그램 자체는 보존(관리자 관리).
router.delete('/creator-tokens/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('creator_tokens').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE admin/creator-tokens/:id]', err.message);
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

// ===== 학생 기록(긍정/부정) — 내부 관리용. 공개/내신청 화면에는 절대 노출 안 함. =====
// student_notes 테이블만 읽고/쓴다(신청 테이블 무변경). 매칭 식별값: 이름+학년+반(+연락처).
// 유형→polarity 매핑(프론트 NOTE_TYPE_GROUPS 와 동일하게 유지).
const NOTE_TYPE_POLARITY = {
  excellent: '긍정', active: '긍정', praise: '긍정', // 긍정
  noshow: '부정', attitude: '부정',                  // 부정
  etc: '중립',                                        // 중립
};
const NOTE_TYPES = Object.keys(NOTE_TYPE_POLARITY);
const POLARITIES = ['긍정', '부정', '중립'];
function polarityForType(t) { return NOTE_TYPE_POLARITY[t] || '중립'; }
// 표시/집계용: 저장된 polarity 우선, 없으면(기존 행) note_type 으로 추론.
function notePolarity(n) { return (n && POLARITIES.includes(n.polarity)) ? n.polarity : polarityForType(n && n.note_type); }
// 학생 매칭: 연락처 양쪽 다 있으면 이름+연락처(학년/반 무관), 없으면 이름+학년+반.
function rowContact(r) { return (r && (r.guardian_contact || r.guardian_phone)) || null; }
function rowMatchesStudent(stu, r) {
  if (String(r.student_name || '').trim() !== stu.name) return false;
  const rc = rowContact(r);
  if (stu.contact && rc) return rc === stu.contact;
  return (r.grade ?? '') === (stu.grade ?? '') && (r.class_no ?? '') === (stu.class_no ?? '');
}

// polarity 컬럼이 아직 없는 DB에서도 동작하도록 resilient insert(없으면 polarity 빼고 재시도).
async function insertStudentNote(row) {
  let { data, error } = await supabase.from('student_notes').insert([row]).select();
  if (error && /polarity/i.test(error.message || '')) {
    const rest = Object.assign({}, row);
    delete rest.polarity;
    ({ data, error } = await supabase.from('student_notes').insert([rest]).select());
  }
  return { data, error };
}

// GET /api/student-notes
//  - 파라미터 없음: 전체 반환(명단 일괄 매칭용 — 학생마다 N번 호출 방지)
//  - student_name(+grade,class_no): 특정 학생 이력만 반환
router.get('/student-notes', async (req, res) => {
  try {
    const { student_name, grade, class_no } = req.query;
    let q = supabase.from('student_notes').select('*').order('created_at', { ascending: true });
    if (student_name) q = q.eq('student_name', String(student_name).trim());
    if (grade !== undefined && grade !== '') q = q.eq('grade', Number(grade));
    if (class_no !== undefined && class_no !== '') q = q.eq('class_no', Number(class_no));
    const { data, error } = await q;
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[GET admin/student-notes]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/student-notes — 참고기록 추가(관리자). 작성자는 '관리자'.
router.post('/student-notes', async (req, res) => {
  try {
    const b = req.body || {};
    const student_name = b.student_name ? String(b.student_name).trim() : '';
    if (!student_name) return res.status(400).json({ ok: false, error: '학생 이름이 필요합니다.' });
    const note_type = NOTE_TYPES.includes(b.note_type) ? b.note_type : 'etc';
    const polarity = POLARITIES.includes(b.polarity) ? b.polarity : polarityForType(note_type);
    const content = b.content ? String(b.content).trim() : '';
    const row = {
      student_name,
      grade: (b.grade === undefined || b.grade === null || b.grade === '') ? null : Number(b.grade),
      class_no: (b.class_no === undefined || b.class_no === null || b.class_no === '') ? null : Number(b.class_no),
      guardian_contact: b.guardian_contact ? String(b.guardian_contact).trim() : null, // 동명이인 구분용
      program_id: b.program_id || null,
      note_type,
      polarity,
      content,
      created_by: '관리자',
    };
    const { data, error } = await insertStudentNote(row);
    if (error) throw error;
    res.json({ ok: true, data: (data && data[0]) || null });
  } catch (err) {
    console.error('[POST admin/student-notes]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/student-board — 학생 단위 집계(일괄 조회 후 1회 집계, 학생마다 N번 호출 금지).
// 신청/도장/기록을 읽기만 해서 학생별로 묶는다(신청 테이블 무변경).
router.get('/student-board', async (req, res) => {
  try {
    const [appsRes, notesRes, stampsRes, progsRes] = await Promise.all([
      supabase.from('saessak_applications').select('*, program:saessak_programs(title)'),
      supabase.from('student_notes').select('*'),
      supabase.from('completion_stamps').select('*'),
      supabase.from('saessak_programs').select('id, title, schedule, session_dates, start_time, end_time, extra_sessions'),
    ]);
    if (appsRes.error) throw appsRes.error;
    if (notesRes.error) throw notesRes.error;
    if (stampsRes.error) throw stampsRes.error;
    if (progsRes.error) throw progsRes.error;
    const apps = appsRes.data || [];
    const notes = notesRes.data || [];
    const stamps = stampsRes.data || [];
    // 프로그램 일정 정보(석암새싹증 기간 표시용)
    const progInfo = {};
    (progsRes.data || []).forEach(p => { progInfo[String(p.id)] = p; });
    const periodOf = (pid) => {
      const p = progInfo[String(pid)] || {};
      return { schedule: p.schedule || null, session_dates: p.session_dates || null, start_time: p.start_time || null, end_time: p.end_time || null, extra_sessions: p.extra_sessions || null };
    };

    // 1) 신청(applications) 으로 학생 집합 구성. 키: 연락처 있으면 이름+연락처, 없으면 이름+학년+반.
    const students = new Map();
    const keyOf = (name, grade, classNo, contact) =>
      contact ? `c:${name}|${contact}` : `n:${name}|${grade ?? ''}|${classNo ?? ''}`;
    apps.forEach(a => {
      const name = String(a.student_name || '').trim();
      if (!name) return;
      const contact = a.guardian_phone || null;
      const key = keyOf(name, a.grade, a.class_no, contact);
      let s = students.get(key);
      if (!s) {
        s = { key, name, grade: a.grade ?? null, class_no: a.class_no ?? null, contact, guardian_phone: contact, _latest: a.submitted_at || '', _apps: [] };
        students.set(key, s);
      }
      // 최신 신청의 학년/반을 대표값으로
      if ((a.submitted_at || '') >= (s._latest || '')) { s.grade = a.grade ?? s.grade; s.class_no = a.class_no ?? s.class_no; s._latest = a.submitted_at || s._latest; }
      s._apps.push(a);
    });

    // 2) 학생별 프로그램(신청/선정) 집계
    students.forEach(s => {
      const progMap = new Map();
      const selected = new Set();
      s._apps.forEach(a => {
        if (a.status === 'cancelled') return;
        const pid = String(a.program_id);
        if (!progMap.has(pid)) progMap.set(pid, { program_id: pid, title: (a.program && a.program.title) || (progInfo[pid] && progInfo[pid].title) || '', selected: false, stamped: false, stamped_at: null, ...periodOf(pid) });
        if (a.status === 'selected') selected.add(pid);
      });
      selected.forEach(pid => { if (progMap.has(pid)) progMap.get(pid).selected = true; });
      s._progMap = progMap;
      s.applied_count = progMap.size;
      s.selected_count = selected.size;
    });

    // 3) 도장(completion_stamps) 매칭 → 이수 횟수 + 프로그램에 도장 표시
    students.forEach(s => {
      const pids = new Set();
      stamps.forEach(st => {
        if (!rowMatchesStudent(s, st)) return;
        const pid = String(st.program_id);
        pids.add(pid);
        if (s._progMap.has(pid)) { const e = s._progMap.get(pid); e.stamped = true; e.stamped_at = st.stamped_at || e.stamped_at; }
        else s._progMap.set(pid, { program_id: pid, title: st.program_name || (progInfo[pid] && progInfo[pid].title) || '', selected: false, stamped: true, stamped_at: st.stamped_at || null, ...periodOf(pid) });
      });
      s.stamp_count = pids.size;
      s.programs = Array.from(s._progMap.values());
    });

    // 4) 기록(student_notes) 매칭 → 긍정/부정 수, 최근 기록일, 타임라인
    students.forEach(s => {
      const matched = notes.filter(n => rowMatchesStudent(s, n));
      let pos = 0, neg = 0, neu = 0, recent = null;
      matched.forEach(n => {
        const pol = notePolarity(n);
        if (pol === '긍정') pos++; else if (pol === '부정') neg++; else neu++;
        if (n.created_at && (!recent || n.created_at > recent)) recent = n.created_at;
      });
      s.pos_count = pos; s.neg_count = neg; s.neu_count = neu; s.recent_note_at = recent;
      s.notes = matched
        .slice()
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        .map(n => ({
          note_type: n.note_type, polarity: notePolarity(n), content: n.content,
          created_at: n.created_at, created_by: n.created_by, program_id: n.program_id,
        }));
    });

    const out = Array.from(students.values()).map(s => ({
      key: s.key, name: s.name, grade: s.grade, class_no: s.class_no, guardian_phone: s.guardian_phone,
      stamp_count: s.stamp_count, applied_count: s.applied_count, selected_count: s.selected_count,
      pos_count: s.pos_count, neg_count: s.neg_count, neu_count: s.neu_count, recent_note_at: s.recent_note_at,
      programs: s.programs, notes: s.notes,
    }));
    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('[GET admin/student-board]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 문의사항 게시판 — 관리자 전용. 공개/내신청 화면엔 절대 노출 안 함. =====
// 문의 원본은 saessak_applications.motivation 컬럼(읽기 전용). 답변 상태만 inquiry_status 에 기록.
// inquiry_status(application_id text PK, answered bool, answered_by, answered_at) 만 읽고/쓴다.

// GET /api/inquiries — motivation 이 비어있지 않은 신청 + 답변상태 조인(일괄 조회 후 매칭).
router.get('/inquiries', async (req, res) => {
  try {
    const { data: apps, error: aErr } = await supabase
      .from('saessak_applications')
      .select('*, program:saessak_programs(*)')
      .not('motivation', 'is', null)
      .order('submitted_at', { ascending: false });
    if (aErr) throw aErr;

    const { data: statuses, error: sErr } = await supabase
      .from('inquiry_status')
      .select('*');
    if (sErr) throw sErr;
    const statusMap = {};
    (statuses || []).forEach(s => { statusMap[String(s.application_id)] = s; });

    const out = (apps || [])
      .filter(a => a.motivation && String(a.motivation).trim()) // 빈 문자열 제외
      .map(a => {
        const st = statusMap[String(a.id)];
        return {
          id: a.id,
          program_title: (a.program && a.program.title) || '(삭제된 프로그램)',
          student_name: a.student_name,
          grade: a.grade,
          class_no: a.class_no,
          guardian_name: a.guardian_name,
          guardian_phone: a.guardian_phone,
          motivation: a.motivation, // 읽기 전용
          submitted_at: a.submitted_at,
          status: a.status,
          answered: !!(st && st.answered),
          answered_by: st ? st.answered_by : null,
          answered_at: st ? st.answered_at : null,
        };
      });
    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('[GET admin/inquiries]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/inquiries/status — 답변 상태 upsert(application_id 기준). 신청 데이터는 건드리지 않음.
router.post('/inquiries/status', async (req, res) => {
  try {
    const { application_id, answered } = req.body || {};
    if (!application_id) return res.status(400).json({ ok: false, error: 'application_id 가 필요합니다.' });
    const row = {
      application_id: String(application_id),
      answered: answered === true || answered === 'true',
      answered_by: '관리자',
      answered_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('inquiry_status')
      .upsert(row, { onConflict: 'application_id' });
    if (error) throw error;
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[POST admin/inquiries/status]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 이수 도장(마일리지) — completion_stamps 만 읽고/쓴다. 신청 테이블 무변경. =====
// unique: (student_name, grade, class_no, program_id). 확인증 출력 화면에서 도장 찍기/취소.
function gradeOrNull(v) { return (v === undefined || v === null || v === '') ? null : Number(v); }

// GET /api/completion-stamps — 전체 도장(확인증 도장판 매칭/집계용, 일괄 조회).
router.get('/completion-stamps', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('completion_stamps')
      .select('*')
      .order('stamped_at', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[GET admin/completion-stamps]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/completion-stamps — 도장 찍기(이수) upsert.
router.post('/completion-stamps', async (req, res) => {
  try {
    const b = req.body || {};
    const student_name = b.student_name ? String(b.student_name).trim() : '';
    const program_id = b.program_id != null ? String(b.program_id) : '';
    if (!student_name || !program_id) return res.status(400).json({ ok: false, error: '학생·프로그램 정보가 필요합니다.' });
    const row = {
      student_name,
      grade: gradeOrNull(b.grade),
      class_no: gradeOrNull(b.class_no),
      guardian_contact: b.guardian_contact ? String(b.guardian_contact).trim() : null,
      program_id,
      program_name: b.program_name ? String(b.program_name).trim() : null,
      stamped_by: '관리자',
      stamped_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('completion_stamps')
      .upsert(row, { onConflict: 'student_name,grade,class_no,program_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST admin/completion-stamps]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/completion-stamps/remove — 도장 취소(삭제). unique 키로만 삭제.
router.post('/completion-stamps/remove', async (req, res) => {
  try {
    const b = req.body || {};
    const student_name = b.student_name ? String(b.student_name).trim() : '';
    const program_id = b.program_id != null ? String(b.program_id) : '';
    if (!student_name || !program_id) return res.status(400).json({ ok: false, error: '학생·프로그램 정보가 필요합니다.' });
    let q = supabase.from('completion_stamps').delete()
      .eq('student_name', student_name).eq('program_id', program_id);
    const g = gradeOrNull(b.grade), c = gradeOrNull(b.class_no);
    q = (g === null) ? q.is('grade', null) : q.eq('grade', g);
    q = (c === null) ? q.is('class_no', null) : q.eq('class_no', c);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST admin/completion-stamps/remove]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 앱 공통 설정(app_settings) — key-value(JSON). 확인증 공통 이미지 등 =====
// value 컬럼은 text/jsonb 어느 쪽이든 JSON 문자열로 저장하고 읽을 때 방어적으로 파싱한다.
function parseSettingValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

router.get('/app-settings/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'key가 필요합니다.' });
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    res.json({ ok: true, value: parseSettingValue(data && data.value) });
  } catch (err) {
    console.error('[GET admin/app-settings]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/app-settings/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'key가 필요합니다.' });
    const value = (req.body && 'value' in req.body) ? req.body.value : null;
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT admin/app-settings]', err.message);
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
        recruit_status: p.recruit_status, // 표시용: 종합 탭 상태 배지가 실제 5단계를 읽도록 노출
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

// 새싹(KOFAC) 등록양식 드롭다운 목록 (D열=지역, F열=학년)
const SAESSAK_REGION_LIST = ['서울특별시','인천광역시','경기도','대전광역시','세종특별자치시','강원특별자치도','충청북도','충청남도','부산광역시','대구광역시','울산광역시','경상북도','경상남도','광주광역시','전북특별자치도','전라남도','제주특별자치도'];
const SAESSAK_GRADE_LIST = ['초등학교 1학년','초등학교 2학년','초등학교 3학년','초등학교 4학년','초등학교 5학년','초등학교 6학년','중학교 1학년','중학교 2학년','중학교 3학년','고등학교 1학년','고등학교 2학년','고등학교 3학년'];
const SAESSAK_REGION_FORMULA = `"${SAESSAK_REGION_LIST.join(',')}"`;
const SAESSAK_GRADE_FORMULA  = `"${SAESSAK_GRADE_LIST.join(',')}"`;
const SAESSAK_HEADER = ['학생명','연락처','이메일','지역','학교','학년','반','일반학생 여부'];
const SAESSAK_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'saessak_kofac_template.xlsx');

// 공식 양식 풀-컬럼 데이터유효성(D2:D1048576, F2:F1048576)만 남긴다.
// exceljs 는 양식을 "읽을 때" 풀-컬럼 범위를 셀 단위(약 200만 개)로 폭발시키므로,
// 양식 그대로 다시 쓰면 잘리고/중복된 거대한 파일이 된다(=KOFAC '초과인원' 거부).
// → 읽은 뒤 데이터유효성을 비우고 공식 범위를 단일 항목으로 재설정한다.
function saessakApplyCleanDV(ws) {
  ws.dataValidations.model = {};
  ws.dataValidations.add('D2:D1048576', { type: 'list', allowBlank: true, formulae: [SAESSAK_REGION_FORMULA] });
  ws.dataValidations.add('F2:F1048576', { type: 'list', allowBlank: true, formulae: [SAESSAK_GRADE_FORMULA] });
}

// 학생 행을 2행부터 채운다(매핑은 기존과 동일). 헤더·데이터유효성·서식은 건드리지 않음.
function saessakFillRows(ws, rows) {
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.student_name;                                   // 학생명
    row.getCell(2).value = r.guardian_phone;                                 // 연락처(보호자)
    row.getCell(3).value = 'abc@gmail.com';                                  // 이메일(고정)
    row.getCell(4).value = '인천광역시';                                      // 지역(고정)
    row.getCell(5).value = '인천석암초등학교';                                // 학교(고정)
    row.getCell(6).value = (r.grade === null || r.grade === undefined || r.grade === '')
      ? '' : `초등학교 ${r.grade}학년`;                                       // 학년
    row.getCell(7).value = r.class_no;                                       // 반
    row.getCell(8).value = r.is_multicultural ? '' : 'Y';                    // 일반학생 여부(다문화면 빈칸)
  });
}

function saessakSheetName(title, idx, used) {
  // 엑셀 금지문자(\ / ? * [ ] : !) 제거, 31자 이내
  let base = String(title || '').replace(/[\\/?*\[\]:!]/g, '').trim().slice(0, 31) || `프로그램${idx + 1}`;
  let name = base, n = 2;
  while (used.has(name)) {
    const suffix = `_${n}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(name);
  return name;
}

// 공식 KOFAC 양식을 불러와 구조(시트·데이터유효성·서식) 보존한 채 학생 행만 채운다.
// 양식이 없으면 공식 사양(헤더 + 풀-컬럼 드롭다운)에 맞춰 깨끗하게 생성하는 폴백.
async function buildSaessakWorkbook(grouped, opts) {
  const pids = Object.keys(grouped);
  const used = new Set();

  // 1) 공식 양식 로드 시도
  let tplWb = null, tplModel = null;
  try {
    if (fs.existsSync(SAESSAK_TEMPLATE_PATH)) {
      tplWb = new ExcelJS.Workbook();
      await tplWb.xlsx.readFile(SAESSAK_TEMPLATE_PATH);
      const base = tplWb.worksheets[0];
      saessakApplyCleanDV(base);                       // 읽으며 폭발한 DV 제거 → 공식 풀-컬럼만
      tplModel = JSON.parse(JSON.stringify(base.model)); // 전체 프로그램용 시트 복제 원본(헤더·서식·DV 포함)
    }
  } catch (e) {
    console.warn('[saessak export] 공식 양식 로드 실패, 폴백 생성:', e.message);
    tplWb = null;
  }

  if (tplWb) {
    const base = tplWb.worksheets[0];
    pids.forEach((pid, idx) => {
      const g = grouped[pid];
      let ws;
      if (idx === 0) {
        ws = base;
        // 특정 프로그램 1개 → 공식 시트명 그대로 유지. 전체 → 프로그램명으로 변경.
        if (!opts.singleProgram) ws.name = saessakSheetName(g.title, idx, used);
        else used.add(ws.name);
      } else {
        const name = saessakSheetName(g.title, idx, used);
        ws = tplWb.addWorksheet(name);
        const m = JSON.parse(JSON.stringify(tplModel)); // 공식 양식 시트 구조 복제(헤더+두 드롭다운)
        m.name = name; m.id = ws.id;
        ws.model = m; ws.name = name;
      }
      saessakApplyCleanDV(ws);  // 모든 시트에 공식 풀-컬럼 드롭다운만 보장
      saessakFillRows(ws, g.rows);
    });
    return tplWb;
  }

  // 2) 폴백: 양식 없이 공식 사양대로 깨끗하게 생성
  const wb = new ExcelJS.Workbook();
  wb.creator = '석암 디지털새싹';
  wb.created = new Date();
  const widths = [12, 16, 20, 14, 18, 14, 6, 12];
  pids.forEach((pid, idx) => {
    const g = grouped[pid];
    const name = saessakSheetName(g.title, idx, used);
    const ws = wb.addWorksheet(name);
    ws.getRow(1).values = SAESSAK_HEADER;
    ws.getRow(1).font = { bold: true };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    saessakApplyCleanDV(ws);
    saessakFillRows(ws, g.rows);
  });
  return wb;
}

router.get('/export', async (req, res) => {
  try {
    const { program_id, only_selected, saessak } = req.query;
    const isSaessak = saessak === '1' || saessak === 'true';

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

    let wb = new ExcelJS.Workbook();
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
    } else if (isSaessak) {
      // ===== 새싹(KOFAC) 등록양식: 공식 양식을 채워서 내보내기 =====
      wb = await buildSaessakWorkbook(grouped, { singleProgram: !!program_id });
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
    const fname = `saessak_${isSaessak ? 'kofac_' : ''}${only_selected ? 'selected_' : ''}${new Date().toISOString().slice(0,10)}.xlsx`;
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
