// 공개 "내 신청 조회/취소/수정" 라우터 — /api/public prefix 아래에 마운트됨.
// 본인 확인: guardian_phone + student_name 조합 일치 (PIN 없음).
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../utils/supabase');
const { normalizeMobile, isValidMobile } = require('../utils/phone');

// 취소·수정 등 본인 확인 동반 라우트 — IP 기준 15분 5회.
const ownerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '본인 확인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

router.post('/lookup', async (req, res) => {
  try {
    const { guardian_phone, guardian_name } = req.body || {};
    const phone = normalizeMobile(guardian_phone);
    if (!isValidMobile(phone)) {
      return res.status(400).json({ ok: false, error: '올바른 보호자 연락처를 입력해 주세요(010-XXXX-XXXX).' });
    }
    const gname = String(guardian_name || '').trim();
    if (!gname) {
      return res.status(400).json({ ok: false, error: '보호자 이름을 입력해 주세요.' });
    }

    // 보호자 연락처 + 보호자 이름 둘 다 일치해야 조회
    const { data: own, error: e1 } = await supabase
      .from('saessak_applications')
      .select('*, program:saessak_programs(id, title, schedule, location, program_type, capacity, waitlist_capacity, session_dates, start_time, end_time)')
      .eq('guardian_phone', phone)
      .eq('guardian_name', gname);
    if (e1) throw e1;

    const list = (own || []).slice().sort((a, b) => {
      if (a.student_name !== b.student_name) return (a.student_name || '').localeCompare(b.student_name || '');
      return new Date(a.submitted_at) - new Date(b.submitted_at);
    });

    if (list.length === 0) {
      return res.json({ ok: true, data: [], message: '입력하신 보호자 정보로 신청된 내역이 없습니다. 연락처와 이름을 다시 확인해 주세요.' });
    }

    // 각 신청의 접수/대기 순번(slot_number)을 그 program 안에서 계산
    const programIds = Array.from(new Set(list.map(r => r.program_id)));
    let peers = [];
    if (programIds.length > 0) {
      const { data, error } = await supabase
        .from('saessak_applications')
        .select('*')
        .in('program_id', programIds);
      if (error) throw error;
      peers = data || [];
    }
    list.forEach(r => {
      if (r.status === 'cancelled') { r.slot_number = null; return; }
      const group = peers
        .filter(a => a.program_id === r.program_id
                  && a.status !== 'cancelled'
                  && !!a.is_waitlist === !!r.is_waitlist)
        .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
      const idx = group.findIndex(a => a.id === r.id);
      r.slot_number = idx >= 0 ? idx + 1 : null;
    });

    res.json({ ok: true, data: list });
  } catch (err) {
    console.error('[POST /api/public/lookup]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 본인 확인: 요청 본문의 guardian_phone + guardian_name 둘 다 해당 신청행과 일치해야 통과.
async function verifyOwnership(applicationId, body) {
  const phone = normalizeMobile((body || {}).guardian_phone);
  const gname = String(((body || {}).guardian_name) || '').trim();
  if (!isValidMobile(phone) || !gname) {
    return { ok: false, status: 400, error: '본인 확인 정보(보호자 연락처/이름)가 올바르지 않습니다.' };
  }
  const { data, error } = await supabase
    .from('saessak_applications')
    .select('id, guardian_phone, guardian_name, student_name, status, program_id, sibling_group_id')
    .eq('id', applicationId)
    .single();
  if (error || !data) {
    return { ok: false, status: 404, error: '신청을 찾을 수 없습니다.' };
  }
  if (data.guardian_phone !== phone || String(data.guardian_name || '').trim() !== gname) {
    return { ok: false, status: 401, error: '본인 확인 정보가 일치하지 않습니다.' };
  }
  return { ok: true, row: data };
}

router.post('/applications/:id/cancel', ownerLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const v = await verifyOwnership(id, req.body);
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    if (v.row.status === 'cancelled') {
      return res.json({ ok: true, already: true });
    }

    const { error } = await supabase
      .from('saessak_applications')
      .update({ status: 'cancelled' })
      .eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/public/applications/:id/cancel]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/applications/:id', ownerLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const v = await verifyOwnership(id, req.body);
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    const { patch } = req.body || {};
    const allowed = ['student_name', 'grade', 'class_no', 'guardian_name', 'guardian_phone', 'student_phone', 'motivation'];
    const updates = {};
    const p = patch || {};
    for (const k of allowed) {
      if (k in p) updates[k] = p[k];
    }

    if ('student_name' in updates) {
      updates.student_name = String(updates.student_name || '').trim();
      if (!updates.student_name) return res.status(400).json({ ok: false, error: '학생 이름을 입력해 주세요.' });
    }
    if ('grade' in updates) {
      const g = Number(updates.grade);
      if (!Number.isInteger(g) || g < 1 || g > 6) return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력해 주세요.' });
      updates.grade = g;
    }
    if ('class_no' in updates) {
      const c = Number(updates.class_no);
      if (!Number.isInteger(c) || c < 1 || c > 30) return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력해 주세요.' });
      updates.class_no = c;
    }
    if ('guardian_name' in updates) {
      updates.guardian_name = String(updates.guardian_name || '').trim();
      if (!updates.guardian_name) return res.status(400).json({ ok: false, error: '보호자 이름을 입력해 주세요.' });
    }
    if ('guardian_phone' in updates) {
      const norm = normalizeMobile(updates.guardian_phone);
      if (!isValidMobile(norm)) return res.status(400).json({ ok: false, error: '올바른 보호자 연락처를 입력해 주세요(010-XXXX-XXXX).' });
      updates.guardian_phone = norm;
    }
    if ('student_phone' in updates) {
      const raw = updates.student_phone;
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        updates.student_phone = null;
      } else {
        const norm = normalizeMobile(raw);
        if (!isValidMobile(norm)) return res.status(400).json({ ok: false, error: '올바른 학생 연락처를 입력해 주세요(010-XXXX-XXXX).' });
        updates.student_phone = norm;
      }
    }
    if ('motivation' in updates) {
      const m = String(updates.motivation || '').trim();
      updates.motivation = m || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, noop: true });
    }

    // 학년 변경 시 신청 프로그램 grades 배열 검증
    if ('grade' in updates) {
      const { data: prog, error: pErr } = await supabase
        .from('saessak_programs')
        .select('grades, title')
        .eq('id', v.row.program_id)
        .single();
      if (pErr) throw pErr;
      const gs = Array.isArray(prog && prog.grades) ? prog.grades : [];
      if (prog && !gs.includes(updates.grade)) {
        const sorted = [...new Set(gs)].sort((a, b) => a - b);
        const contiguous = sorted.length >= 2 && sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
        const label = sorted.length === 0 ? '' : (contiguous ? `${sorted[0]}~${sorted[sorted.length - 1]}학년` : `${sorted.join(',')}학년`);
        return res.status(400).json({ ok: false, error: `"${prog.title}"은(는) ${label} 대상입니다.` });
      }
    }

    const { data, error } = await supabase
      .from('saessak_applications')
      .update(updates)
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH /api/public/applications/:id]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
