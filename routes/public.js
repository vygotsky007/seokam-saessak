const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

router.get('/programs', async (req, res) => {
  try {
    const { data: programs, error } = await supabase
      .from('saessak_programs')
      .select('*')
      .eq('is_open', true)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const ids = (programs || []).map(p => p.id);
    let counts = {};
    if (ids.length > 0) {
      const { data: apps, error: aErr } = await supabase
        .from('saessak_applications')
        .select('program_id, status')
        .in('program_id', ids);
      if (aErr) throw aErr;
      (apps || []).forEach(a => {
        if (a.status === 'cancelled') return;
        counts[a.program_id] = (counts[a.program_id] || 0) + 1;
      });
    }

    const result = (programs || []).map(p => {
      const applied = counts[p.id] || 0;
      const remaining = Math.max(0, (p.capacity || 0) - applied);
      const isFull = remaining <= 0;
      return { ...p, applied_count: applied, remaining, is_full: isFull };
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[GET /api/public/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/apply', async (req, res) => {
  try {
    const {
      program_ids,
      student_name,
      grade,
      class_no,
      guardian_name,
      guardian_phone,
      student_phone,
      motivation,
      privacy_agreed,
    } = req.body || {};

    if (!Array.isArray(program_ids) || program_ids.length === 0) {
      return res.status(400).json({ ok: false, error: '신청할 프로그램을 1개 이상 선택해 주세요.' });
    }
    if (!student_name || !String(student_name).trim()) {
      return res.status(400).json({ ok: false, error: '학생 이름을 입력해 주세요.' });
    }
    const gradeNum = Number(grade);
    const classNum = Number(class_no);
    if (!Number.isInteger(gradeNum) || gradeNum < 1 || gradeNum > 6) {
      return res.status(400).json({ ok: false, error: '학년은 1~6 사이로 입력해 주세요.' });
    }
    if (!Number.isInteger(classNum) || classNum < 1 || classNum > 30) {
      return res.status(400).json({ ok: false, error: '반은 1~30 사이로 입력해 주세요.' });
    }
    if (!guardian_name || !String(guardian_name).trim()) {
      return res.status(400).json({ ok: false, error: '보호자 이름을 입력해 주세요.' });
    }
    if (!guardian_phone || !/^[0-9\-\s+]{8,20}$/.test(String(guardian_phone).trim())) {
      return res.status(400).json({ ok: false, error: '보호자 연락처를 정확히 입력해 주세요.' });
    }
    if (privacy_agreed !== true && privacy_agreed !== 'true' && privacy_agreed !== 1 && privacy_agreed !== '1') {
      return res.status(400).json({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' });
    }

    const studentName = String(student_name).trim();
    const guardianName = String(guardian_name).trim();
    const guardianPhone = String(guardian_phone).trim();
    const studentPhone = student_phone ? String(student_phone).trim() : null;
    const mot = motivation ? String(motivation).trim() : null;

    const { data: programs, error: pErr } = await supabase
      .from('saessak_programs')
      .select('*')
      .in('id', program_ids);
    if (pErr) throw pErr;
    if (!programs || programs.length === 0) {
      return res.status(404).json({ ok: false, error: '선택한 프로그램을 찾을 수 없습니다.' });
    }

    const programMap = {};
    programs.forEach(p => { programMap[p.id] = p; });

    for (const pid of program_ids) {
      const p = programMap[pid];
      if (!p) {
        return res.status(400).json({ ok: false, error: '잘못된 프로그램이 포함되어 있습니다.' });
      }
      if (gradeNum < p.grade_min || gradeNum > p.grade_max) {
        return res.status(400).json({
          ok: false,
          error: `"${p.title}" 은(는) ${p.grade_min}~${p.grade_max}학년 대상입니다. (입력 학년: ${gradeNum})`,
        });
      }
    }

    const { data: existingApps, error: eErr } = await supabase
      .from('saessak_applications')
      .select('id, program_id')
      .in('program_id', program_ids)
      .eq('student_name', studentName)
      .eq('guardian_phone', guardianPhone)
      .neq('status', 'cancelled');
    if (eErr) throw eErr;
    const dupSet = new Set((existingApps || []).map(r => r.program_id));

    const { data: allApps, error: cErr } = await supabase
      .from('saessak_applications')
      .select('program_id, status')
      .in('program_id', program_ids);
    if (cErr) throw cErr;
    const liveCounts = {};
    (allApps || []).forEach(a => {
      if (a.status === 'cancelled') return;
      liveCounts[a.program_id] = (liveCounts[a.program_id] || 0) + 1;
    });

    const accepted = [];
    const rejected = [];
    const now = new Date().toISOString();

    for (const pid of program_ids) {
      const p = programMap[pid];
      if (!p.is_open) {
        rejected.push({ program_id: pid, title: p.title, reason: '모집이 마감되었습니다.' });
        continue;
      }
      if (dupSet.has(pid)) {
        rejected.push({ program_id: pid, title: p.title, reason: '이미 신청한 프로그램입니다.' });
        continue;
      }
      const applied = liveCounts[pid] || 0;
      if (applied >= p.capacity) {
        rejected.push({ program_id: pid, title: p.title, reason: '정원이 마감되었습니다.' });
        continue;
      }

      const { data: inserted, error: iErr } = await supabase
        .from('saessak_applications')
        .insert([{
          program_id: pid,
          student_name: studentName,
          grade: gradeNum,
          class_no: classNum,
          guardian_name: guardianName,
          guardian_phone: guardianPhone,
          student_phone: studentPhone,
          motivation: mot,
          privacy_agreed: true,
          status: 'applied',
          source: 'online',
          submitted_at: now,
        }])
        .select();
      if (iErr) {
        console.error('[insert application]', iErr);
        rejected.push({ program_id: pid, title: p.title, reason: '접수 중 오류가 발생했습니다.' });
        continue;
      }
      accepted.push({
        program_id: pid,
        title: p.title,
        schedule: p.schedule,
        location: p.location,
        application_id: inserted[0].id,
        submitted_at: inserted[0].submitted_at,
      });
      liveCounts[pid] = applied + 1;
    }

    res.json({ ok: true, accepted, rejected });
  } catch (err) {
    console.error('[POST /api/public/apply]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
