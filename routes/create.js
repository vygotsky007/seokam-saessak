// 프로그램 개설 위임 라우터 — /api/create 아래 마운트(관리자 인증 없음).
// 보안: 무작위 토큰(creator_tokens.token) + enabled=true + 개설자 비밀번호(CREATOR_PASSWORD_HASH).
// 강사 수정 페이지(routes/edit.js)의 토큰+허용+비번 게이트 패턴을 그대로 본떴다.
// 중요: 개설분은 항상 '숨김'으로 생성, 본인이 만든 프로그램만 스코프(서버 강제). 학생 개인정보 접근 없음.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const router = express.Router();
const supabase = require('../utils/supabase');
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

module.exports = router;
