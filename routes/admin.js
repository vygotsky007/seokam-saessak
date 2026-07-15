const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const QRCode = require('qrcode');
const supabase = require('../utils/supabase');
const { normalizeMobile } = require('../utils/phone');
const { makeReviewToken } = require('../utils/review-token');
const { isValidAppStatus, normalizeAppStatus, appStatusLabel, validateStudentName } = require('../utils/app-status');

// 강사용 수정 링크 토큰: 48자 hex(24바이트) — 추측 불가능한 길이.
function genEditToken() {
  return crypto.randomBytes(24).toString('hex');
}

const RECRUIT_STATUSES = ['recruiting', 'upcoming', 'full', 'closed', 'hidden'];
function normalizeRecruitStatus(v) {
  return RECRUIT_STATUSES.includes(v) ? v : null;
}

// 새싹 레이더 요약 프록시 (CORS 회피). RADAR_URL/api/summary 를 서버측 fetch로 그대로 반환.
// 5초 타임아웃, 미설정/실패 시 { ok:false } 계열 반환.
router.get('/radar-summary', async (req, res) => {
  const base = (process.env.RADAR_URL || '').trim();
  if (!base) return res.json({ ok: false, reason: 'unset' });
  const url = base.replace(/\/+$/, '') + '/api/summary';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return res.json({ ok: false, reason: 'error', status: r.status });
    const data = await r.json();
    return res.json(data); // 요약 JSON 그대로 반환 (radarUrl 은 아래에서 별도 제공)
  } catch (e) {
    return res.json({ ok: false, reason: 'error' });
  } finally {
    clearTimeout(timer);
  }
});

// 탭에서 "레이더 열기" 링크에 쓸 RADAR_URL 공개용 (비밀 아님)
router.get('/radar-url', (req, res) => {
  res.json({ ok: true, url: (process.env.RADAR_URL || '').trim() || null });
});

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

// 프로그램 사진 배열 정규화: 우리 program-photos 버킷의 public URL 문자열만, 순서 유지, 최대 5장, 중복 제거.
// (업로드는 /program-photos/upload 에서 이미 끝났고, 여기선 저장할 URL 목록만 검증한다.)
function normalizePhotos(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const v of input) {
    const url = String(v || '').trim();
    if (!url) continue;
    if (!supabase.programPhotoPath(url)) continue; // 우리 버킷 URL 이 아니면 버림
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 5) break;
  }
  return out;
}

// 프로그램 사진 1장 업로드 — 클라이언트가 리사이즈(긴 변 1200px)·JPEG 0.85 압축한 dataURL 을 받아
// program-photos 버킷에 올리고 public URL 을 돌려준다. 폼에서 파일 선택 즉시 호출.
router.post('/program-photos/upload', async (req, res) => {
  try {
    const dataUrl = (req.body || {}).photo;
    if (!dataUrl) return res.status(400).json({ ok: false, error: '사진 데이터가 없습니다.' });
    const url = await supabase.uploadProgramPhoto(dataUrl);
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[POST admin/program-photos/upload]', err.message, '| hasServiceKey=', supabase.hasServiceKey);
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
      photos,
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
      photos: normalizePhotos(photos),
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
      'organization',
      'photos'];
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
    // 사진: 저장 목록 정규화. 수정 전 사진과 비교해 빠진(삭제된) 파일은 Storage 에서 정리.
    let removedPhotos = [];
    if ('photos' in patch) {
      patch.photos = normalizePhotos(patch.photos);
      const { data: before } = await supabase
        .from('saessak_programs')
        .select('photos')
        .eq('id', id)
        .single();
      const oldPhotos = (before && Array.isArray(before.photos)) ? before.photos : [];
      const keep = new Set(patch.photos);
      removedPhotos = oldPhotos.filter(u => !keep.has(u));
    }

    const { data, error } = await supabase
      .from('saessak_programs')
      .update(patch)
      .eq('id', id)
      .select();
    if (error) throw error;
    if (removedPhotos.length) await supabase.deleteProgramPhotos(removedPhotos);
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
    // 삭제 전 사진 URL 확보 → 프로그램 삭제 후 Storage 파일도 정리.
    const { data: before } = await supabase
      .from('saessak_programs')
      .select('photos')
      .eq('id', id)
      .single();
    const photos = (before && Array.isArray(before.photos)) ? before.photos : [];
    await supabase.from('saessak_applications').delete().eq('program_id', id);
    const { error } = await supabase
      .from('saessak_programs')
      .delete()
      .eq('id', id);
    if (error) throw error;
    if (photos.length) await supabase.deleteProgramPhotos(photos);
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

// ===== 프로그램 후기(리뷰) 관리 =====

// 후기 작성 링크 + QR(dataURL PNG). 이수 학생에게 배포(인쇄/공유)용.
router.get('/programs/:id/review-link', async (req, res) => {
  try {
    const { id } = req.params;
    const token = makeReviewToken(id);
    if (!token) return res.status(400).json({ ok: false, error: '프로그램 id가 올바르지 않습니다.' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/review/${token}`;
    const qr = await QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
    // 후기 받기 상태(review_open). 컬럼이 아직 없으면(마이그레이션 전) 기본 true 로 간주.
    let reviewOpen = true;
    try {
      const { data: prog } = await supabase
        .from('saessak_programs').select('review_open').eq('id', id).maybeSingle();
      if (prog && prog.review_open === false) reviewOpen = false;
    } catch (e) { /* 컬럼 없음 등 → 기본 true */ }
    res.json({ ok: true, url, qr, review_open: reviewOpen });
  } catch (err) {
    console.error('[GET admin/programs/:id/review-link]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 후기 받기 활성화/비활성화 토글(관리자 전용 — 라우터가 requireAdmin 뒤에 마운트됨).
// body.review_open(불리언)이 오면 그 값으로, 없으면 현재값을 뒤집는다.
router.patch('/programs/:id/review-open', async (req, res) => {
  try {
    const { id } = req.params;
    let next;
    if (typeof (req.body || {}).review_open === 'boolean') {
      next = req.body.review_open;
    } else {
      const { data: cur, error: curErr } = await supabase
        .from('saessak_programs').select('review_open').eq('id', id).maybeSingle();
      if (curErr) throw curErr;
      if (!cur) return res.status(404).json({ ok: false, error: '프로그램을 찾을 수 없습니다.' });
      next = !(cur.review_open === true); // NULL/undefined(기본 열림)에서 누르면 닫기로.
    }
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ review_open: next })
      .eq('id', id)
      .select('id, review_open');
    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ ok: false, error: '프로그램을 찾을 수 없습니다.' });
    res.json({ ok: true, review_open: data[0].review_open });
  } catch (err) {
    console.error('[PATCH admin/programs/:id/review-open]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 프로그램 후기 전체(게시+숨김) — 모더레이션용.
router.get('/programs/:id/reviews', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('program_reviews')
      .select('*')
      .eq('program_id', String(req.params.id))
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[GET admin/programs/:id/reviews]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 후기 상태 변경(게시/숨김). 숨김은 학부모 화면에서 즉시 제외.
router.patch('/reviews/:id', async (req, res) => {
  try {
    const status = (req.body || {}).status;
    if (status !== '게시' && status !== '숨김') {
      return res.status(400).json({ ok: false, error: '유효하지 않은 상태값입니다.' });
    }
    const { data, error } = await supabase
      .from('program_reviews')
      .update({ status })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ ok: false, error: '후기를 찾을 수 없습니다.' });
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH admin/reviews/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 후기 삭제.
router.delete('/reviews/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('program_reviews').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE admin/reviews/:id]', err.message);
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

// GET /applicants-records — 선정 보조용 학생 기록 집계(교사 전용·비공개).
// 현재 프로그램 신청자에 한해, 학생 기록(student_notes)에서 학생별 긍정/부정 개수를 집계해
// 신청 건별 점수(= 긍정 − 부정)를 돌려준다. 매칭은 이름+학년+반(동명이인 안전).
//   긍정/부정 매핑은 코드 기존 정의(NOTE_TYPE_POLARITY)를 따른다:
//   우수·적극참여·칭찬 = 긍정, 노쇼·태도 = 부정, 기타 = 중립(점수 무영향).
// ⚠ 이 집계·점수는 교사 전용이다. 공개(/api/public)·내신청(/api/me) 응답에는 절대 포함하지 않는다.
router.get('/applicants-records', async (req, res) => {
  // requireAdmin 뒤에 마운트되지만, 평가(민감) 데이터이므로 본 엔드포인트에서도 명시적으로 403.
  if (!(req.session && req.session.isAdmin === true)) {
    return res.status(403).json({ ok: false, error: '관리자 전용 기능입니다.' });
  }
  try {
    const { program_id } = req.query;
    if (!program_id) return res.status(400).json({ ok: false, error: 'program_id가 필요합니다.' });

    const [appsRes, notesRes] = await Promise.all([
      supabase.from('saessak_applications')
        .select('id, student_name, grade, class_no, status')
        .eq('program_id', program_id),
      supabase.from('student_notes')
        .select('student_name, grade, class_no, note_type, polarity'),
    ]);
    if (appsRes.error) throw appsRes.error;
    if (notesRes.error) throw notesRes.error;

    // 기록을 이름+학년+반 키로 집계(동명이인은 학년·반으로 구분).
    const recKey = (name, g, c) => `${String(name || '').trim()}|${g ?? ''}|${c ?? ''}`;
    const agg = new Map(); // key → {pos,neg,neu}
    (notesRes.data || []).forEach(n => {
      const k = recKey(n.student_name, n.grade, n.class_no);
      let e = agg.get(k);
      if (!e) { e = { pos: 0, neg: 0, neu: 0 }; agg.set(k, e); }
      const pol = notePolarity(n);
      if (pol === '긍정') e.pos++; else if (pol === '부정') e.neg++; else e.neu++;
    });

    // 현재 프로그램 신청자에 한정해 신청 건별 점수표 구성.
    const data = (appsRes.data || []).map(a => {
      const e = agg.get(recKey(a.student_name, a.grade, a.class_no)) || { pos: 0, neg: 0, neu: 0 };
      return {
        application_id: a.id, status: a.status,
        pos: e.pos, neg: e.neg, neu: e.neu, score: e.pos - e.neg,
      };
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[GET admin/applicants-records]', err.message);
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
    const nameCheck = validateStudentName(student_name);
    if (!nameCheck.ok) return res.status(400).json({ ok: false, error: nameCheck.error });

    const payload = {
      program_id,
      student_name: nameCheck.name,
      grade: Number(grade) || null,
      class_no: Number(class_no) || null,
      guardian_name: guardian_name ? String(guardian_name).trim() : null,
      guardian_phone: guardian_phone ? normalizeMobile(guardian_phone) : null,
      student_phone: student_phone ? normalizeMobile(student_phone) : null,
      motivation: motivation ? String(motivation).trim() : null,
      privacy_agreed: true,
      status: normalizeAppStatus(status),
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
    if ('student_name' in patch) {
      const nameCheck = validateStudentName(patch.student_name);
      if (!nameCheck.ok) return res.status(400).json({ ok: false, error: nameCheck.error });
      patch.student_name = nameCheck.name;
    }
    if ('status' in patch) {
      if (!isValidAppStatus(patch.status)) return res.status(400).json({ ok: false, error: '유효하지 않은 status' });
      patch.status = normalizeAppStatus(patch.status);
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
    if (!isValidAppStatus(status)) {
      return res.status(400).json({ ok: false, error: '유효하지 않은 status' });
    }
    const canonical = normalizeAppStatus(status);
    const patch = { status: canonical };
    // 대기(waitlisted) 일 때만 순번 저장, 그 외 상태로 바뀌면 순번 비움.
    if (canonical === 'waitlisted') {
      if ('waitlist_order' in (req.body || {})) {
        const n = Number(req.body.waitlist_order);
        patch.waitlist_order = Number.isInteger(n) && n > 0 ? n : null;
      }
    } else {
      patch.waitlist_order = null;
    }
    const { data, error } = await supabase
      .from('saessak_applications')
      .update(patch)
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
      status: 'received',
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

    // 이중 안전장치: 같은 학생·같은 유형·같은 메모가 최근 몇 초 내 들어오면 더블클릭으로 보고 무시.
    // (프론트 버튼 비활성화가 1차, 서버 중복 차단이 2차.)
    const DUP_WINDOW_MS = 8000;
    try {
      const since = new Date(Date.now() - DUP_WINDOW_MS).toISOString();
      let dq = supabase.from('student_notes').select('*')
        .eq('student_name', student_name)
        .eq('note_type', note_type)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);
      if (row.grade === null) dq = dq.is('grade', null); else dq = dq.eq('grade', row.grade);
      if (row.class_no === null) dq = dq.is('class_no', null); else dq = dq.eq('class_no', row.class_no);
      const { data: recent } = await dq;
      const last = recent && recent[0];
      if (last && String(last.content || '').trim() === content) {
        // 최근 동일 기록이 이미 있음 → 두 번째는 무시하고 기존 기록을 그대로 반환.
        return res.json({ ok: true, data: last, deduped: true });
      }
    } catch (dupErr) {
      // 중복 검사 실패는 저장을 막지 않는다(베스트 에포트).
      console.error('[POST admin/student-notes dup-check]', dupErr.message);
    }

    const { data, error } = await insertStudentNote(row);
    if (error) throw error;
    res.json({ ok: true, data: (data && data[0]) || null });
  } catch (err) {
    console.error('[POST admin/student-notes]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/student-notes/:id — 참고기록 개별 삭제(관리자 전용).
// 라우터가 requireAdmin 뒤에 마운트되므로 비관리자 요청은 여기 닿기 전에 401/403 처리된다.
router.delete('/student-notes/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: '기록 id가 필요합니다.' });
    const { data, error } = await supabase
      .from('student_notes')
      .delete()
      .eq('id', id)
      .select();
    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ ok: false, error: '해당 기록을 찾을 수 없습니다.' });
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[DELETE admin/student-notes]', err.message);
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
          id: n.id, note_type: n.note_type, polarity: notePolarity(n), content: n.content,
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

// ===== 증서 로고/마스코트 업로드 — cert-assets 버킷(public). dataURL 받아 public URL 반환. =====
router.post('/cert-assets/upload', async (req, res) => {
  try {
    const dataUrl = req.body && req.body.dataUrl;
    if (!dataUrl) return res.status(400).json({ ok: false, error: '이미지 데이터가 필요합니다.' });
    const url = await supabase.uploadCertAsset(dataUrl);
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[POST admin/cert-assets/upload]', err.message);
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

    // 확인 필요(동명이인 의심) 건수 — GET /applications 의 name_conflict 와 동일 기준.
    const conflictBuckets = {};
    active.forEach(a => {
      if (!a.student_name || !a.guardian_phone) return;
      const k = `${a.guardian_phone}::${a.student_name}`;
      (conflictBuckets[k] = conflictBuckets[k] || new Set()).add(`${a.grade ?? '?'}-${a.class_no ?? '?'}`);
    });
    const conflictKeys = new Set(
      Object.entries(conflictBuckets).filter(([, s]) => s.size >= 2).map(([k]) => k)
    );
    const needsReview = active.filter(
      a => a.student_name && a.guardian_phone && conflictKeys.has(`${a.guardian_phone}::${a.student_name}`)
    ).length;

    // 선정 미처리 프로그램 — 모집이 끝났는데(full/closed) 선정 0명.
    const selectionPending = programSummary.filter(
      p => (p.recruit_status === 'full' || p.recruit_status === 'closed') && (p.selected || 0) === 0 && (p.applied || 0) > 0
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
          needsReview,
        },
        actionCenter: {
          multiShortage: multiShortagePrograms.map(p => ({ id: p.id, title: p.title, count: p.multicultural_count, min: p.multicultural_min })),
          selectionPending: selectionPending.map(p => ({ id: p.id, title: p.title, applied: p.applied, recruit_status: p.recruit_status })),
          needsReview,
        },
      },
    });
  } catch (err) {
    console.error('[GET admin/dashboard]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 공식 KOFAC 등록양식 원본(zip). 이 파일을 거의 그대로 두고 학생 행만 끼운다.
const SAESSAK_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'saessak_kofac_template.xlsx');

function saessakXmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function saessakGradeText(grade) {
  return (grade === null || grade === undefined || grade === '') ? '' : `초등학교 ${grade}학년`;
}

// 공식 양식 zip을 열어 xl/worksheets/sheet1.xml 과 xl/sharedStrings.xml "두 파일만" 최소 수정한다.
// - sheet1.xml: sheetData 2행부터 학생 <row> 추가 + <dimension>을 A1:I{마지막행}(I1 메모 포함)로 갱신.
// - sharedStrings.xml: 새 문자열 <si> 추가 + count/uniqueCount 갱신.
// 나머지(workbook.xml=Sheet0, comments1.xml, vmlDrawing1.vml, styles.xml, [Content_Types].xml 등)와
// sheet1.xml 안의 데이터유효성·I1 메모 영역은 원본 그대로 보존(재직렬화 없음). 시트명 Sheet0 절대 변경 안 함.
async function buildSaessakXlsxBuffer(rows) {
  if (!fs.existsSync(SAESSAK_TEMPLATE_PATH)) {
    throw new Error('공식 양식 파일이 없습니다: templates/saessak_kofac_template.xlsx 를 추가해주세요.');
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(SAESSAK_TEMPLATE_PATH));

  const SHEET_PATH = 'xl/worksheets/sheet1.xml';
  const SST_PATH = 'xl/sharedStrings.xml';
  const sheetFile = zip.file(SHEET_PATH);
  const sstFile = zip.file(SST_PATH);
  if (!sheetFile) throw new Error('양식 구조 오류: xl/worksheets/sheet1.xml 없음');
  if (!sstFile) throw new Error('양식 구조 오류: xl/sharedStrings.xml 없음(공식 양식 필요)');

  let sheetXml = await sheetFile.async('string');
  let sstXml = await sstFile.async('string');

  // --- sharedStrings: 기존 count/uniqueCount 파악 ---
  const sstOpen = (sstXml.match(/<sst\b[^>]*>/) || [])[0];
  if (!sstOpen) throw new Error('sharedStrings.xml 형식 오류');
  const uMatch = sstOpen.match(/uniqueCount="(\d+)"/);
  const cMatch = sstOpen.match(/\bcount="(\d+)"/);
  const existingUnique = uMatch ? parseInt(uMatch[1], 10) : (sstXml.match(/<si\b/g) || []).length;
  const existingCount = cMatch ? parseInt(cMatch[1], 10) : existingUnique;

  // 내가 추가하는 문자열만 모은 테이블(중복 제거). 인덱스는 기존 uniqueCount 뒤에 이어붙임.
  const newStrings = [];
  const newIndex = new Map();
  function internString(v) {
    const key = String(v);
    if (newIndex.has(key)) return newIndex.get(key);
    const idx = existingUnique + newStrings.length;
    newStrings.push(key);
    newIndex.set(key, idx);
    return idx;
  }

  // --- sheet1.xml 파싱: sheetData 영역 + 공식 행/열 서식(s=) 확보 ---
  sheetXml = sheetXml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
  const sdMatch = sheetXml.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sdMatch) throw new Error('sheet1.xml: sheetData 영역을 찾을 수 없음');
  const sdInner = sdMatch[1];

  // 공식 양식의 첫 데이터행(r>=2)에서 행 속성(spans·dyDescent 등)과 열별 셀 스타일을 캡처해
  // 새로 채우는 행에 그대로 적용한다(서식 보존 = 최소 수정).
  const dataRowMatch = sdInner.match(/<row\b([^>]*)\br="(?:[2-9]|[1-9]\d+)"([^>]*)>([\s\S]*?)<\/row>/);
  let rowAttr = ' spans="1:9"';
  const colStyle = {};
  if (dataRowMatch) {
    const rawAttr = (dataRowMatch[1] + ' ' + dataRowMatch[2]).replace(/\s+/g, ' ').trim();
    if (rawAttr) rowAttr = ' ' + rawAttr;
    const cellRe = /<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(dataRowMatch[3]))) {
      colStyle[cm[1]] = (cm[2].match(/\bs="\d+"/) || [''])[0]; // 예: 's="2"'
    }
  }
  const styleOf = (col) => (colStyle[col] ? ' ' + colStyle[col] : '');

  // --- 학생 행 XML 만들기(2행부터). 매핑은 기존과 동일, 공식 서식 유지 ---
  let stringCellRefs = 0;
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const rowXmls = rows.map((r, i) => {
    const rowNo = i + 2;
    const valueOf = {
      A: { t: 's', v: r.student_name },               // 학생명
      B: { t: 's', v: r.guardian_phone },             // 연락처(보호자)
      C: { t: 's', v: 'abc@gmail.com' },              // 이메일(고정)
      D: { t: 's', v: '인천광역시' },                  // 지역(고정)
      E: { t: 's', v: '인천석암초등학교' },            // 학교(고정)
      F: { t: 's', v: saessakGradeText(r.grade) },    // 학년
      G: { t: 'n', v: r.class_no },                   // 반(숫자)
      H: { t: 's', v: (r.is_multicultural ? '' : 'Y') }, // 일반학생 여부: 다문화면 빈칸
    };
    const cells = COLS.map((col) => {
      const ref = `${col}${rowNo}`;
      const st = styleOf(col);
      const cell = valueOf[col];
      const blank = cell.v === '' || cell.v === null || cell.v === undefined;
      if (blank) return `<c r="${ref}"${st}/>`;                        // 빈 셀(공식 서식 유지)
      if (cell.t === 'n') {
        const n = Number(cell.v);
        if (Number.isFinite(n)) return `<c r="${ref}"${st}><v>${n}</v></c>`;
      }
      stringCellRefs++;
      return `<c r="${ref}"${st} t="s"><v>${internString(cell.v)}</v></c>`;
    }).join('');
    return `<row r="${rowNo}"${rowAttr}>${cells}</row>`;
  });

  // --- sharedStrings.xml 갱신 ---
  if (newStrings.length) {
    const siXml = newStrings.map(s => `<si><t xml:space="preserve">${saessakXmlEscape(s)}</t></si>`).join('');
    sstXml = sstXml.replace(/<\/sst>\s*$/, siXml + '</sst>');
  }
  const newUnique = existingUnique + newStrings.length;
  const newCount = existingCount + stringCellRefs;
  let sstOpenNew = sstOpen;
  sstOpenNew = /\bcount="\d+"/.test(sstOpenNew)
    ? sstOpenNew.replace(/\bcount="\d+"/, `count="${newCount}"`)
    : sstOpenNew.replace(/<sst\b/, `<sst count="${newCount}"`);
  sstOpenNew = /uniqueCount="\d+"/.test(sstOpenNew)
    ? sstOpenNew.replace(/uniqueCount="\d+"/, `uniqueCount="${newUnique}"`)
    : sstOpenNew.replace(/<sst\b/, `<sst uniqueCount="${newUnique}"`);
  sstXml = sstXml.replace(/<sst\b[^>]*>/, sstOpenNew);

  // --- sheetData 재구성: 헤더 1행(및 기타) 보존 + 기존 빈 데이터행(r>=2) 제거 후 내 행 삽입 ---
  const preserved = sdInner.replace(
    /<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g,
    (m, rn) => (parseInt(rn, 10) >= 2 ? '' : m)
  );
  const newSdInner = preserved + rowXmls.join('');
  sheetXml = sheetXml.replace(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${newSdInner}</sheetData>`);

  // --- dimension 갱신: I1 메모 포함 A1:I{마지막행} ---
  const lastRow = rows.length + 1;
  if (/<dimension\b[^>]*\/>/.test(sheetXml)) {
    sheetXml = sheetXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:I${lastRow}"/>`);
  } else if (/<dimension\b[^>]*>[\s\S]*?<\/dimension>/.test(sheetXml)) {
    sheetXml = sheetXml.replace(/<dimension\b[^>]*>[\s\S]*?<\/dimension>/, `<dimension ref="A1:I${lastRow}"/>`);
  }

  // 딱 두 파일만 교체. 나머지는 원본 그대로 다시 압축.
  zip.file(SHEET_PATH, sheetXml);
  zip.file(SST_PATH, sstXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// 내보내기 정렬 비교자 — 학년 오름차순 → 반 오름차순 → 이름 가나다(동점 안정화).
// (학년/반 null 은 맨 뒤로 보낸다.)
function cmpGradeClass(a, b) {
  return (a.grade ?? 99) - (b.grade ?? 99)
      || (a.class_no ?? 999) - (b.class_no ?? 999)
      || String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ko');
}

// 학생 기록(student_notes) 매칭 키: 이름+학년+반(동명이인 안전). student-board 의 기준과 동일.
function exportNoteKey(name, grade, classNo) {
  return `${String(name || '').trim()}|${grade ?? ''}|${classNo ?? ''}`;
}

router.get('/export', async (req, res) => {
  // 내보내기/연락처·평가 등 민감정보 포함은 관리자 전용. requireAdmin 으로 이미 게이트되지만,
  // 요구사항(서버 403)에 맞춰 본 엔드포인트에서도 명시적으로 403 을 반환한다.
  if (!(req.session && req.session.isAdmin === true)) {
    return res.status(403).json({ ok: false, error: '관리자 전용 기능입니다.' });
  }
  try {
    const { program_id, only_selected, saessak } = req.query;
    const isSaessak = saessak === '1' || saessak === 'true';

    // 대상(다중): 전체 / 선정자만(selected) / 취소 제외(exclude_cancel) / 다문화만(multi). AND 결합.
    const targetSet = new Set(String(req.query.targets || '').split(',').map(s => s.trim()).filter(Boolean));
    if (only_selected === '1' || only_selected === 'true') targetSet.add('selected'); // 구버전 파라미터 호환

    // 정렬 기준(택1): grade_class(학년·반순) | positive(긍정평가순) | name(가나다) | submitted(신청순).
    const sort = String(req.query.sort || '').trim();

    // 형식/포함(다중): contact(연락처) | motivation(신청동기) | eval(평가기록). 모두 관리자 전용(위 403).
    const includeSet = new Set(String(req.query.include || '').split(',').map(s => s.trim()).filter(Boolean));
    const incContact = includeSet.has('contact');
    const incMotivation = includeSet.has('motivation');
    const incEval = includeSet.has('eval');

    // 기본 정렬은 program_id → display_order → 접수시각(기존 동작). 그룹 내 재정렬은 아래 sortRows 가 처리.
    let appQ = supabase
      .from('saessak_applications')
      .select('*, program:saessak_programs(*)')
      .order('program_id')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('submitted_at', { ascending: true });
    if (program_id) appQ = appQ.eq('program_id', program_id);
    const { data, error } = await appQ;
    if (error) throw error;

    // 대상 필터 적용(AND). '전체'는 무필터(아무 것도 안 좁힘).
    let rowsAll = data || [];
    if (targetSet.has('selected')) rowsAll = rowsAll.filter(r => r.status === 'selected');
    if (targetSet.has('exclude_cancel')) rowsAll = rowsAll.filter(r => r.status !== 'cancelled');
    if (targetSet.has('multi')) rowsAll = rowsAll.filter(r => r.is_multicultural);

    // 긍정평가순 정렬 또는 평가기록 포함 시에만 student_notes 를 읽어 점수표 구성.
    // 점수 = 긍정 개수 − 부정 개수(내림차순). 동점이면 긍정 개수 많은 순, 그래도 동점이면 학년·반순.
    // 긍정/부정 매핑은 코드 기존 정의(NOTE_TYPE_POLARITY)를 따른다:
    //   우수·적극참여·칭찬 = 긍정, 노쇼·태도 = 부정, 기타 = 중립.
    const scoreByKey = new Map();
    const needNotes = sort === 'positive' || incEval;
    if (needNotes) {
      const { data: notes, error: nErr } = await supabase
        .from('student_notes')
        .select('student_name, grade, class_no, note_type, polarity, content, created_at');
      if (nErr) throw nErr;
      (notes || []).forEach(n => {
        const key = exportNoteKey(n.student_name, n.grade, n.class_no);
        let e = scoreByKey.get(key);
        if (!e) { e = { pos: 0, neg: 0, neu: 0, notes: [] }; scoreByKey.set(key, e); }
        const pol = notePolarity(n);
        if (pol === '긍정') e.pos++; else if (pol === '부정') e.neg++; else e.neu++;
        e.notes.push(n);
      });
    }
    const scoreOf = (r) => scoreByKey.get(exportNoteKey(r.student_name, r.grade, r.class_no))
      || { pos: 0, neg: 0, neu: 0, notes: [] };

    function sortRows(rows) {
      if (sort === 'grade_class') return rows.slice().sort(cmpGradeClass);
      if (sort === 'name') {
        return rows.slice().sort((a, b) =>
          String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ko') || cmpGradeClass(a, b));
      }
      if (sort === 'submitted') {
        return rows.slice().sort((a, b) => String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')));
      }
      if (sort === 'positive') {
        return rows.slice().sort((a, b) => {
          const sa = scoreOf(a), sb = scoreOf(b);
          return (sb.pos - sb.neg) - (sa.pos - sa.neg) || (sb.pos - sa.pos) || cmpGradeClass(a, b);
        });
      }
      return rows; // 기본: 쿼리 순서 유지
    }

    // ===== 새싹(KOFAC) 등록양식: 공식 양식 zip의 XML만 최소 수정해 내보내기 =====
    // KOFAC 업로드 단위는 "프로그램 1개"라서 특정 프로그램 선택만 지원(전체는 프로그램별로 따로).
    // 공식 양식의 "컬럼 구성·헤더·순서"는 그대로 보존한다(buildSaessakXlsxBuffer 가 A~H 매핑 고정).
    // → 컬럼 관련 포함 옵션(연락처/신청동기/평가기록)은 새싹용에 적용하지 않는다(클라에서 비활성화).
    //   단, 정렬은 "데이터 행 순서"에만 영향하고 컬럼 규격과 무관하므로 새싹용에서도 그대로 적용한다.
    //   (KOFAC 업로드는 행 순서를 가리지 않으며, 코드/주석 어디에도 행 순서가 업로드에 영향을
    //    준다는 근거가 없다 — 양식은 컬럼만 고정.)
    if (isSaessak) {
      if (!program_id) {
        return res.status(400).json({
          ok: false,
          error: '새싹용은 프로그램을 1개 선택해 받아주세요. 전체는 프로그램별로 따로 받으세요.',
        });
      }
      // 취소(cancelled) 제외(KOFAC). 다문화 판정은 기존 is_multicultural 플래그 재사용.
      // 정렬 옵션(학년·반순/긍정평가순/이름순/신청순)은 행 순서에 반영.
      const rows = sortRows(rowsAll.filter(r => r.status !== 'cancelled'));
      const buf = await buildSaessakXlsxBuffer(rows);
      const fname = `saessak_kofac_${targetSet.has('selected') ? 'selected_' : ''}${new Date().toISOString().slice(0,10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      return res.send(Buffer.from(buf));
    }

    let wb = new ExcelJS.Workbook();
    wb.creator = '석암 디지털새싹';
    wb.created = new Date();

    const grouped = {};
    rowsAll.forEach(row => {
      const pid = row.program_id;
      if (!grouped[pid]) grouped[pid] = { title: row.program ? row.program.title : '미상', rows: [] };
      grouped[pid].rows.push(row);
    });

    // 포함 옵션에 따라 컬럼 구성(대상 필터 → 정렬 → 포함 컬럼 순으로 적용).
    const baseCols = [
      { header: '번호', key: 'no', width: 6 },
      { header: '학생이름', key: 'student_name', width: 12 },
      { header: '학년', key: 'grade', width: 6 },
      { header: '반', key: 'class_no', width: 6 },
      { header: '보호자', key: 'guardian_name', width: 12 },
      { header: '상태', key: 'status', width: 10 },
      { header: '경로', key: 'source', width: 8 },
      { header: '프로그램유형', key: 'program_type', width: 12 },
      { header: '다문화여부', key: 'is_multicultural', width: 10 },
      { header: '형제묶음ID', key: 'sibling_group_id', width: 36 },
    ];
    const contactCols = [
      { header: '보호자연락처', key: 'guardian_phone', width: 16 },
      { header: '학생연락처', key: 'student_phone', width: 16 },
    ];
    const motivationCols = [{ header: '신청동기', key: 'motivation', width: 36 }];
    const evalCols = [
      { header: '긍정평가수', key: 'eval_pos', width: 10 },
      { header: '부정평가수', key: 'eval_neg', width: 10 },
      { header: '평가점수', key: 'eval_score', width: 10 },
      { header: '평가내용', key: 'eval_notes', width: 44 },
    ];
    const submittedCol = [{ header: '접수시각', key: 'submitted_at', width: 22 }];
    const columns = [
      ...baseCols,
      ...(incContact ? contactCols : []),
      ...(incMotivation ? motivationCols : []),
      ...(incEval ? evalCols : []),
      ...submittedCol,
    ];

    if (Object.keys(grouped).length === 0) {
      const ws = wb.addWorksheet('명단');
      ws.addRow(['데이터가 없습니다.']);
    } else {
      Object.keys(grouped).forEach((pid, idx) => {
        const g = grouped[pid];
        const safe = g.title.replace(/[\\/?*\[\]:]/g, '_').slice(0, 28) || `프로그램${idx + 1}`;
        const ws = wb.addWorksheet(safe);
        ws.columns = columns;
        ws.getRow(1).font = { bold: true };
        sortRows(g.rows).forEach((r, i) => {
          const row = {
            no: i + 1,
            student_name: r.student_name,
            grade: r.grade,
            class_no: r.class_no,
            guardian_name: r.guardian_name,
            status: statusLabel(r.status),
            source: r.source === 'manual' ? '수동' : '온라인',
            program_type: programTypeLabel(r.program ? r.program.program_type : null),
            is_multicultural: r.is_multicultural ? 'O' : '',
            sibling_group_id: r.sibling_group_id || '',
            submitted_at: r.submitted_at ? new Date(r.submitted_at).toLocaleString('ko-KR') : '',
          };
          if (incContact) {
            row.guardian_phone = r.guardian_phone;
            row.student_phone = r.student_phone;
          }
          if (incMotivation) row.motivation = r.motivation;
          if (incEval) {
            const s = scoreOf(r);
            row.eval_pos = s.pos;
            row.eval_neg = s.neg;
            row.eval_score = s.pos - s.neg;
            row.eval_notes = s.notes
              .slice()
              .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
              .map(n => `${notePolarity(n)}:${n.note_type}${n.content ? '(' + n.content + ')' : ''}`)
              .join(' / ');
          }
          ws.addRow(row);
        });
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const fname = `saessak_${targetSet.has('selected') ? 'selected_' : ''}${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[GET admin/export]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function statusLabel(s) {
  return appStatusLabel(s);
}
function programTypeLabel(t) {
  return {
    general:       '일반형',
    multicultural: '다문화 우대',
    sibling:       '형제 우대',
  }[t] || (t || '일반형');
}

module.exports = router;
