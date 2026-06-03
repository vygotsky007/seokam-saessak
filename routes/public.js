const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../utils/supabase');
const { normalizeMobile, isValidMobile } = require('../utils/phone');
const { programsConflict } = require('../public/js/schedule-conflict');

function formatGradesLabel(grades) {
  if (!Array.isArray(grades) || grades.length === 0) return '';
  const sorted = [...new Set(grades)].sort((a, b) => a - b);
  const isContiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  if (isContiguous && sorted.length >= 2) return `${sorted[0]}~${sorted[sorted.length - 1]}학년`;
  return `${sorted.join(',')}학년`;
}

router.get('/programs', async (req, res) => {
  try {
    // 공개 화면: hidden 은 노출하지 않음. recruiting/upcoming/closed 는 화면에서 상태별로 표시.
    // 호환: 옛 데이터(recruit_status 미설정)는 is_open 으로 추정 — true 면 recruiting, false 면 hidden.
    const { data: programs, error } = await supabase
      .from('saessak_programs')
      .select('*')
      .neq('recruit_status', 'hidden')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const ids = (programs || []).map(p => p.id);
    const appliedCounts = {};
    const waitlistCounts = {};
    if (ids.length > 0) {
      // schema cache 갱신 전에도 안전하도록 select('*')
      const { data: apps, error: aErr } = await supabase
        .from('saessak_applications')
        .select('*')
        .in('program_id', ids);
      if (aErr) throw aErr;
      (apps || []).forEach(a => {
        if (a.status === 'cancelled') return;
        if (a.is_waitlist) waitlistCounts[a.program_id] = (waitlistCounts[a.program_id] || 0) + 1;
        else appliedCounts[a.program_id] = (appliedCounts[a.program_id] || 0) + 1;
      });
    }

    const result = (programs || []).map(p => {
      const applied = appliedCounts[p.id] || 0;
      const waiting = waitlistCounts[p.id] || 0;
      const remaining = Math.max(0, (p.capacity || 0) - applied);
      const wRemaining = Math.max(0, (p.waitlist_capacity || 0) - waiting);
      const isCapacityFull = remaining <= 0;
      const isFullyClosed = isCapacityFull && wRemaining <= 0;
      // organization 은 관리자 전용 — 공개 응답에서 제거.
      const { organization, ...publicFields } = p;
      return {
        ...publicFields,
        applied_count: applied,
        waitlist_count: waiting,
        remaining,
        waitlist_remaining: wRemaining,
        is_full: isCapacityFull,         // 정원 풀 (대기는 가능할 수 있음)
        is_fully_closed: isFullyClosed,  // 정원+대기 모두 마감
      };
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[GET /api/public/programs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function normalizeStudents(body) {
  if (Array.isArray(body.students) && body.students.length > 0) {
    return body.students;
  }
  // 단일 학생 호환
  return [{
    student_name: body.student_name,
    grade: body.grade,
    class_no: body.class_no,
    motivation: body.motivation,
    program_ids: body.program_ids,
    is_multicultural: body.is_multicultural,
  }];
}

router.post('/apply', async (req, res) => {
  try {
    const body = req.body || {};
    const {
      guardian_name,
      guardian_phone,
      privacy_agreed,
    } = body;

    if (!guardian_name || !String(guardian_name).trim()) {
      return res.status(400).json({ ok: false, error: '보호자 이름을 입력해 주세요.' });
    }
    const guardianPhone = normalizeMobile(guardian_phone);
    if (!isValidMobile(guardianPhone)) {
      return res.status(400).json({ ok: false, error: '올바른 휴대폰 번호를 입력해 주세요(010-XXXX-XXXX).' });
    }
    if (privacy_agreed !== true && privacy_agreed !== 'true' && privacy_agreed !== 1 && privacy_agreed !== '1') {
      return res.status(400).json({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' });
    }

    const guardianName = String(guardian_name).trim();

    const students = normalizeStudents(body);
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ ok: false, error: '학생 정보가 없습니다.' });
    }
    if (students.length > 6) {
      return res.status(400).json({ ok: false, error: '한 번에 최대 6명까지 신청할 수 있습니다.' });
    }

    // 입력 정규화
    const normalized = [];
    let totalPrograms = 0;
    for (let i = 0; i < students.length; i++) {
      const s = students[i] || {};
      const name = s.student_name ? String(s.student_name).trim() : '';
      if (!name) {
        return res.status(400).json({ ok: false, error: `${i + 1}번째 학생의 이름을 입력해 주세요.` });
      }
      const grade = Number(s.grade);
      const classNo = Number(s.class_no);
      if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
        return res.status(400).json({ ok: false, error: `${name} 학생의 학년은 1~6 사이로 입력해 주세요.` });
      }
      if (!Number.isInteger(classNo) || classNo < 1 || classNo > 30) {
        return res.status(400).json({ ok: false, error: `${name} 학생의 반은 1~30 사이로 입력해 주세요.` });
      }
      const programIds = Array.isArray(s.program_ids) ? s.program_ids.filter(Boolean) : [];
      if (programIds.length === 0) {
        return res.status(400).json({ ok: false, error: `${name} 학생이 신청할 프로그램을 1개 이상 선택해 주세요.` });
      }
      totalPrograms += programIds.length;
      normalized.push({
        student_name: name,
        grade,
        class_no: classNo,
        motivation: s.motivation ? String(s.motivation).trim() : null,
        is_multicultural: s.is_multicultural === true || s.is_multicultural === 'true',
        program_ids: programIds,
      });
    }
    if (totalPrograms === 0) {
      return res.status(400).json({ ok: false, error: '선택된 프로그램이 없습니다.' });
    }

    // 프로그램 일괄 조회
    const allProgramIds = Array.from(new Set(normalized.flatMap(s => s.program_ids)));
    const { data: programs, error: pErr } = await supabase
      .from('saessak_programs')
      .select('*')
      .in('id', allProgramIds);
    if (pErr) throw pErr;
    if (!programs || programs.length === 0) {
      return res.status(404).json({ ok: false, error: '선택한 프로그램을 찾을 수 없습니다.' });
    }
    const programMap = {};
    programs.forEach(p => { programMap[p.id] = p; });

    // 학년 검증 (제출 전 가드)
    for (const s of normalized) {
      for (const pid of s.program_ids) {
        const p = programMap[pid];
        if (!p) {
          return res.status(400).json({ ok: false, error: '잘못된 프로그램이 포함되어 있습니다.' });
        }
        const grades = Array.isArray(p.grades) ? p.grades : [];
        if (!grades.includes(s.grade)) {
          return res.status(400).json({
            ok: false,
            error: `${s.student_name}: "${p.title}" 은(는) ${formatGradesLabel(grades)} 대상입니다.`,
          });
        }
      }
    }

    // 중복 신청 사전 체크 (학생이름+보호자연락처+program_id)
    const dupSet = new Set();
    const studentNames = Array.from(new Set(normalized.map(s => s.student_name)));
    const { data: existingApps, error: eErr } = await supabase
      .from('saessak_applications')
      .select('id, program_id, student_name')
      .in('program_id', allProgramIds)
      .in('student_name', studentNames)
      .eq('guardian_phone', guardianPhone)
      .neq('status', 'cancelled');
    if (eErr) throw eErr;
    (existingApps || []).forEach(r => dupSet.add(`${r.student_name}::${r.program_id}`));

    // 충돌 검사용: 같은 보호자+학생의 모든 비취소 신청(program_id 포함). 부족한 program 데이터는 추가 로드.
    const { data: existingForConflict, error: ceErr } = await supabase
      .from('saessak_applications')
      .select('id, program_id, student_name')
      .eq('guardian_phone', guardianPhone)
      .in('student_name', studentNames)
      .neq('status', 'cancelled');
    if (ceErr) throw ceErr;
    const needIds = Array.from(new Set(
      (existingForConflict || []).map(r => r.program_id).filter(pid => !programMap[pid])
    ));
    if (needIds.length > 0) {
      const { data: more, error: mErr } = await supabase
        .from('saessak_programs').select('*').in('id', needIds);
      if (mErr) throw mErr;
      (more || []).forEach(p => { programMap[p.id] = p; });
    }
    // student_name → Set<program_id> (이 학생이 현재 시점에 묶여 있는 모든 프로그램)
    const studentLockedPrograms = {};
    (existingForConflict || []).forEach(r => {
      (studentLockedPrograms[r.student_name] = studentLockedPrograms[r.student_name] || new Set()).add(r.program_id);
    });

    // 실시간 카운트 (자동 접수와 자동 대기를 분리해서 센다)
    const { data: allApps, error: cErr } = await supabase
      .from('saessak_applications')
      .select('*')
      .in('program_id', allProgramIds);
    if (cErr) throw cErr;
    const appliedLive = {};
    const waitlistLive = {};
    (allApps || []).forEach(a => {
      if (a.status === 'cancelled') return;
      if (a.is_waitlist) waitlistLive[a.program_id] = (waitlistLive[a.program_id] || 0) + 1;
      else appliedLive[a.program_id] = (appliedLive[a.program_id] || 0) + 1;
    });

    // 형제 묶음 UUID (학생 2명 이상이면 생성)
    const siblingGroupId = normalized.length >= 2 ? crypto.randomUUID() : null;
    const now = new Date().toISOString();

    const accepted = [];
    const rejected = [];

    for (const s of normalized) {
      for (const pid of s.program_ids) {
        const p = programMap[pid];
        // 모집 상태 검증: recruiting 만 접수, upcoming/full/closed/hidden 은 거부
        const rstatus = p.recruit_status || (p.is_open ? 'recruiting' : 'hidden');
        if (rstatus !== 'recruiting') {
          const reasonMap = {
            upcoming: '아직 모집이 시작되지 않았습니다.',
            full:     '정원이 마감되었습니다.',
            closed:   '모집이 종료되었습니다.',
            hidden:   '모집이 마감되었습니다.',
          };
          rejected.push({ student_name: s.student_name, program_id: pid, title: p.title, reason: reasonMap[rstatus] || '현재 신청할 수 없습니다.' });
          continue;
        }
        if (dupSet.has(`${s.student_name}::${pid}`)) {
          rejected.push({ student_name: s.student_name, program_id: pid, title: p.title, reason: '이미 신청한 프로그램입니다.' });
          continue;
        }
        // 시간 충돌 (이 학생이 이미 신청 중이거나 같은 제출에서 이미 접수된 프로그램들 중)
        const lockedSet = studentLockedPrograms[s.student_name]
          = studentLockedPrograms[s.student_name] || new Set();
        let conflictWith = null;
        for (const otherPid of lockedSet) {
          if (otherPid === pid) continue;
          const other = programMap[otherPid];
          if (other && programsConflict(p, other)) { conflictWith = other; break; }
        }
        if (conflictWith) {
          rejected.push({
            student_name: s.student_name, program_id: pid, title: p.title,
            reason: `이미 신청한 "${conflictWith.title}"과 시간이 겹칩니다.`,
          });
          continue;
        }
        const aCount = appliedLive[pid] || 0;
        const wCount = waitlistLive[pid] || 0;
        const cap  = Number(p.capacity) || 0;
        const wcap = Number(p.waitlist_capacity) || 0;

        let isWait;
        let slotNumber;
        if (aCount < cap) {
          isWait = false;
          slotNumber = aCount + 1; // 정원 내 N번째 접수
        } else if (wCount < wcap) {
          isWait = true;
          slotNumber = wCount + 1; // 대기 N번째
        } else {
          rejected.push({
            student_name: s.student_name, program_id: pid, title: p.title,
            reason: '정원과 대기 인원이 모두 찼습니다.',
          });
          continue;
        }

        const isMulticulturalProgram = p.is_type_multicultural === true || p.program_type === 'multicultural';
        const isMulticulturalRow = isMulticulturalProgram ? !!s.is_multicultural : false;

        const { data: inserted, error: iErr } = await supabase
          .from('saessak_applications')
          .insert([{
            program_id: pid,
            student_name: s.student_name,
            grade: s.grade,
            class_no: s.class_no,
            guardian_name: guardianName,
            guardian_phone: guardianPhone,
            student_phone: null,
            motivation: s.motivation,
            privacy_agreed: true,
            status: 'applied',
            source: 'online',
            submitted_at: now,
            is_multicultural: isMulticulturalRow,
            sibling_group_id: siblingGroupId,
            is_waitlist: isWait,
          }])
          .select();
        if (iErr) {
          console.error('[insert application]', iErr);
          rejected.push({ student_name: s.student_name, program_id: pid, title: p.title, reason: '접수 중 오류가 발생했습니다.' });
          continue;
        }
        accepted.push({
          student_name: s.student_name,
          program_id: pid,
          title: p.title,
          schedule: p.schedule,
          location: p.location,
          program_type: p.program_type,
          session_dates: p.session_dates,
          start_time: p.start_time,
          end_time: p.end_time,
          extra_sessions: p.extra_sessions,
          application_id: inserted[0].id,
          submitted_at: inserted[0].submitted_at,
          is_waitlist: isWait,
          slot_number: slotNumber,
        });
        if (isWait) waitlistLive[pid] = wCount + 1;
        else appliedLive[pid] = aCount + 1;
        // 같은 제출 안에서 같은 학생의 다음 프로그램 충돌 검사를 위해 잠금에 추가
        lockedSet.add(pid);
      }
    }

    res.json({
      ok: true,
      accepted,
      rejected,
      sibling_group_id: siblingGroupId,
      students_count: normalized.length,
    });
  } catch (err) {
    console.error('[POST /api/public/apply]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/public/outputs — 산출물 등록 프로그램 공개 목록(읽기 전용). 학생 개인정보 절대 미포함.
router.get('/outputs', async (req, res) => {
  try {
    const { data: outs, error } = await supabase.from('program_outputs').select('*');
    if (error) throw error;
    const list = (outs || []).filter(o => (o.output_url && String(o.output_url).trim()) || (o.summary && String(o.summary).trim()));
    const ids = list.map(o => o.program_id);
    const pmap = {};
    if (ids.length) {
      const { data: progs } = await supabase
        .from('saessak_programs')
        .select('id, title, instructors, schedule, session_dates, start_time, end_time, extra_sessions')
        .in('id', ids);
      (progs || []).forEach(p => { pmap[p.id] = p; });
    }
    const cards = list.map(o => {
      const p = pmap[o.program_id] || {};
      return {
        program_name: o.program_name || p.title || '',
        summary: o.summary || '',
        output_url: o.output_url || '',
        instructors: p.instructors || '',
        schedule: p.schedule || null,
        session_dates: p.session_dates || null,
        start_time: p.start_time || null,
        end_time: p.end_time || null,
        extra_sessions: p.extra_sessions || null,
        updated_at: o.updated_at || null,
      };
    }).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    res.json({ ok: true, data: cards });
  } catch (err) {
    console.error('[GET public/outputs]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
