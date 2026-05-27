const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const supabase = require('../utils/supabase');

router.get('/me', (req, res) => {
  res.json({ ok: true, isAdmin: true, loggedAt: req.session.loggedAt });
});

router.get('/programs', async (req, res) => {
  try {
    const { data: programs, error } = await supabase
      .from('saessak_programs')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const ids = (programs || []).map(p => p.id);
    let counts = {};
    let selectedCounts = {};
    if (ids.length > 0) {
      const { data: apps, error: aErr } = await supabase
        .from('saessak_applications')
        .select('program_id, status')
        .in('program_id', ids);
      if (aErr) throw aErr;
      (apps || []).forEach(a => {
        if (a.status !== 'cancelled') {
          counts[a.program_id] = (counts[a.program_id] || 0) + 1;
        }
        if (a.status === 'selected') {
          selectedCounts[a.program_id] = (selectedCounts[a.program_id] || 0) + 1;
        }
      });
    }

    const result = (programs || []).map(p => ({
      ...p,
      applied_count: counts[p.id] || 0,
      selected_count: selectedCounts[p.id] || 0,
      remaining: Math.max(0, (p.capacity || 0) - (counts[p.id] || 0)),
    }));

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[GET admin/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/programs', async (req, res) => {
  try {
    const {
      title, description, schedule, location,
      grade_min, grade_max, capacity, instructors, is_open,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, error: '프로그램명을 입력하세요.' });
    }
    const payload = {
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      schedule: schedule ? String(schedule).trim() : null,
      location: location ? String(location).trim() : null,
      grade_min: Number(grade_min) || 1,
      grade_max: Number(grade_max) || 6,
      capacity: Number(capacity) || 0,
      instructors: instructors ? String(instructors).trim() : null,
      is_open: is_open === true || is_open === 'true',
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
      'grade_min', 'grade_max', 'capacity', 'instructors', 'is_open'];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if ('grade_min' in patch) patch.grade_min = Number(patch.grade_min);
    if ('grade_max' in patch) patch.grade_max = Number(patch.grade_max);
    if ('capacity' in patch) patch.capacity = Number(patch.capacity);
    if ('is_open' in patch) patch.is_open = patch.is_open === true || patch.is_open === 'true';

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

router.patch('/programs/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur, error: e1 } = await supabase
      .from('saessak_programs')
      .select('is_open')
      .eq('id', id)
      .single();
    if (e1) throw e1;
    const { data, error } = await supabase
      .from('saessak_programs')
      .update({ is_open: !cur.is_open })
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ ok: true, data: data[0] });
  } catch (err) {
    console.error('[PATCH admin/programs/:id/toggle]', err.message);
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
    res.json({ ok: true, data });
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
      status, source,
    } = req.body || {};
    if (!program_id) return res.status(400).json({ ok: false, error: 'program_id가 필요합니다.' });
    if (!student_name) return res.status(400).json({ ok: false, error: '학생 이름이 필요합니다.' });

    const payload = {
      program_id,
      student_name: String(student_name).trim(),
      grade: Number(grade) || null,
      class_no: Number(class_no) || null,
      guardian_name: guardian_name ? String(guardian_name).trim() : null,
      guardian_phone: guardian_phone ? String(guardian_phone).trim() : null,
      student_phone: student_phone ? String(student_phone).trim() : null,
      motivation: motivation ? String(motivation).trim() : null,
      privacy_agreed: true,
      status: status || 'applied',
      source: source || 'manual',
      submitted_at: new Date().toISOString(),
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
      'guardian_phone', 'student_phone', 'motivation', 'status', 'display_order'];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if ('grade' in patch) patch.grade = Number(patch.grade) || null;
    if ('class_no' in patch) patch.class_no = Number(patch.class_no) || null;
    if ('display_order' in patch) patch.display_order = Number(patch.display_order);

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
      return {
        id: p.id,
        title: p.title,
        capacity: p.capacity,
        applied: list.length,
        remaining: Math.max(0, p.capacity - list.length),
        selected: list.filter(a => a.status === 'selected').length,
        is_open: p.is_open,
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

    res.json({
      ok: true,
      data: {
        programs: programSummary,
        gradeStats,
        multiStudents,
        totals: {
          programs: programs.length,
          openPrograms: programs.filter(p => p.is_open).length,
          applications: active.length,
          selected: active.filter(a => a.status === 'selected').length,
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
          { header: '신청동기', key: 'motivation', width: 32 },
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

module.exports = router;
