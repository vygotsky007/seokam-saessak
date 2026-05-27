(() => {
  // === 운영 문구 ===
  const PRIVACY_TEXT = {
    intro: '다음 개인정보 수집·이용 및 초상권에 동의하십니까?',
    items: [
      '수집·이용 목적: 출석부 작성, 학생 관리, 결과보고서 제출',
      '수집 항목: 학년, 반, 번호, 학생 성명, 보호자 성명, 보호자 휴대폰 번호, 학생과의 관계',
      '이용·보유 기간 및 처리 방법: 2026. 9. 1. ~ 2026. 12. 31. (이용 기간 후 파기)',
      '교육 활동 과정 및 결과에 참여 학생 얼굴이 나올 수 있습니다.',
    ],
  };

  // === 휴대폰 포맷팅/검증 ===
  function formatPhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length < 4) return digits;
    if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  function isValidPhone(s) { return /^010-\d{4}-\d{4}$/.test(String(s || '')); }
  function attachPhoneFormatter(input) {
    if (!input || input.dataset.phoneFormatter === '1') return;
    input.dataset.phoneFormatter = '1';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', '13');
    input.setAttribute('placeholder', '010-XXXX-XXXX');
    input.addEventListener('input', () => {
      const f = formatPhone(input.value);
      if (input.value !== f) input.value = f;
    });
  }

  // === 공용 유틸 ===
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return iso; }
  }
  function typeBadge(t) {
    if (t === 'multicultural') return '<span class="badge tag-multicultural">다문화 우대</span>';
    if (t === 'sibling') return '<span class="badge tag-sibling">형제 우대</span>';
    return '';
  }

  // === 상태 ===
  let programs = [];
  // students[i] = { id, selected:Set<programId>, cache:{name,grade,class_no,student_phone,motivation,is_multicultural}, same_as_prev:bool }
  const students = [];
  let counter = 0;
  const MAX_STUDENTS = 4;

  // === DOM ===
  const detailListEl = document.getElementById('program-detail-list');
  const studentsArea = document.getElementById('students-area');
  const programsArea = document.getElementById('programs-area');
  const summaryArea  = document.getElementById('summary-area');
  const form = document.getElementById('apply-form');
  const submitBtn = document.getElementById('submit-btn');
  const resultArea = document.getElementById('result-area');
  const addSiblingBtn = document.getElementById('add-sibling-btn');
  const studentTpl = document.getElementById('student-block-tpl');

  // === 학생/학년 계산 ===
  function gradeOf(s) {
    if (!s) return '';
    const idx = students.indexOf(s);
    if (s.same_as_prev && idx > 0) return gradeOf(students[idx - 1]);
    return s.cache.grade || '';
  }
  function classOf(s) {
    if (!s) return '';
    const idx = students.indexOf(s);
    if (s.same_as_prev && idx > 0) return classOf(students[idx - 1]);
    return s.cache.class_no || '';
  }
  function effGradeForStudent(idx) {
    const s = students[idx];
    if (!s) return null;
    if (s.same_as_prev && idx > 0) {
      const g = Number(gradeOf(students[idx - 1]));
      return Number.isFinite(g) && g > 0 ? g : null;
    }
    const g = Number(s.cache.grade);
    return Number.isFinite(g) && g > 0 ? g : null;
  }
  function allStudentsEmpty() {
    if (students.length === 0) return true;
    return students.every((s, i) => {
      const noName = !(s.cache.name || '').trim();
      const noGrade = effGradeForStudent(i) == null;
      return noName && noGrade;
    });
  }
  function reconcileSelections() {
    // 모든 학생에 대해 자기 학년 안 맞는 program_id를 selected에서 제거
    students.forEach((s, i) => {
      const g = effGradeForStudent(i);
      if (g == null) return;
      for (const pid of Array.from(s.selected)) {
        const p = programs.find(x => x.id === pid);
        if (!p) { s.selected.delete(pid); continue; }
        if (g < p.grade_min || g > p.grade_max) s.selected.delete(pid);
      }
    });
  }

  // === 상단: 안내 카드 ===
  function renderDetailList() {
    if (!programs.length) {
      detailListEl.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    detailListEl.innerHTML = programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      const meta = [];
      if (p.schedule)    meta.push(`<span>📅 ${esc(p.schedule)}</span>`);
      if (p.location)    meta.push(`<span>📍 ${esc(p.location)}</span>`);
      meta.push(`<span>👶 ${p.grade_min}~${p.grade_max}학년</span>`);
      meta.push(`<span>👥 정원 ${p.capacity}명</span>`);
      if (p.instructors) meta.push(`<span>🧑‍🏫 ${esc(p.instructors)}</span>`);
      return `
        <article class="program-card ${isFull ? 'disabled' : ''}">
          <header class="pc-head">
            <div class="pc-title">
              ${esc(p.title)}
              ${typeBadge(p.program_type)}
              ${isFull ? '<span class="badge full">마감</span>' : '<span class="badge open">모집중</span>'}
            </div>
            <div class="pc-seats">남은자리 <strong>${p.remaining}</strong> / ${p.capacity}</div>
          </header>
          <div class="pc-meta">${meta.join('')}</div>
          ${p.description ? `<div class="pc-body">${esc(p.description)}</div>` : ''}
        </article>
      `;
    }).join('');
  }

  // === 1단계: 학생 블록 ===
  function addStudent() {
    counter += 1;
    students.push({
      id: counter,
      selected: new Set(),
      cache: {},
      same_as_prev: students.length >= 1,
    });
    renderStudents();
    renderStep2();
    renderSummary();
  }
  function removeStudent(id) {
    const idx = students.findIndex(s => s.id === id);
    if (idx < 0) return;
    students.splice(idx, 1);
    renderStudents();
    renderStep2();
    renderSummary();
  }

  function renderStudents() {
    studentsArea.innerHTML = '';
    students.forEach((s, i) => {
      const node = studentTpl.content.firstElementChild.cloneNode(true);
      node.dataset.sid = s.id;
      node.querySelector('.idx').textContent = i === 0 ? '1 (본인)' : (i + 1);

      const rmBtn = node.querySelector('.remove-student');
      if (students.length > 1) {
        rmBtn.hidden = false;
        rmBtn.addEventListener('click', () => removeStudent(s.id));
      }

      const sapRow = node.querySelector('.same-as-prev-row');
      const sapCb = node.querySelector('.f-same-as-prev');
      const gradeInput = node.querySelector('.f-grade');
      const classInput = node.querySelector('.f-class');

      if (i >= 1) {
        sapRow.hidden = false;
        sapCb.checked = !!s.same_as_prev;
        sapCb.addEventListener('change', () => {
          s.same_as_prev = sapCb.checked;
          if (s.same_as_prev) {
            s.cache.grade = gradeOf(students[i - 1]);
            s.cache.class_no = classOf(students[i - 1]);
          }
          reconcileSelections();
          renderStudents();
          renderStep2();
          renderSummary();
        });
      }

      // 기본값 채우기
      node.querySelector('.f-name').value = s.cache.name || '';
      const effGrade = (i >= 1 && s.same_as_prev) ? gradeOf(students[i - 1]) : (s.cache.grade || '');
      const effClass = (i >= 1 && s.same_as_prev) ? classOf(students[i - 1]) : (s.cache.class_no || '');
      gradeInput.value = effGrade;
      classInput.value = effClass;
      if (i >= 1 && s.same_as_prev) {
        gradeInput.readOnly = true;
        classInput.readOnly = true;
        gradeInput.classList.add('locked');
        classInput.classList.add('locked');
      }
      node.querySelector('.f-sphone').value = s.cache.student_phone || '';
      node.querySelector('.f-motivation').value = s.cache.motivation || '';

      // 입력 이벤트
      node.querySelector('.f-name').addEventListener('input', (e) => {
        s.cache.name = e.target.value.trim();
        renderStep2(); // 학생 라벨 갱신
        renderSummary();
      });
      gradeInput.addEventListener('input', () => {
        if (gradeInput.readOnly) return;
        s.cache.grade = gradeInput.value;
        propagateGradeClassDown(i);
        reconcileSelections();
        renderStep2();
        renderSummary();
      });
      classInput.addEventListener('input', () => {
        if (classInput.readOnly) return;
        s.cache.class_no = classInput.value;
        propagateGradeClassDown(i);
        renderStep2(); // 학년-반 라벨 갱신
        renderSummary();
      });
      attachPhoneFormatter(node.querySelector('.f-sphone'));
      node.querySelector('.f-sphone').addEventListener('input', (e) => {
        s.cache.student_phone = e.target.value.trim();
      });
      node.querySelector('.f-motivation').addEventListener('input', (e) => {
        s.cache.motivation = e.target.value.trim();
      });

      // 선택 정보 접기/펼치기 (상태는 students[i].optional_open 에 보존)
      const optToggle = node.querySelector('.optional-toggle');
      const optFields = node.querySelector('.optional-fields');
      if (optToggle && optFields) {
        if (s.optional_open === undefined) {
          s.optional_open = !!(s.cache.student_phone || s.cache.motivation);
        }
        const applyOptState = () => {
          if (s.optional_open) {
            optFields.hidden = false;
            optToggle.textContent = '− 추가 정보 접기';
            optToggle.classList.add('open');
          } else {
            optFields.hidden = true;
            optToggle.textContent = '+ 추가 정보 입력 (연락처·문의사항)';
            optToggle.classList.remove('open');
          }
        };
        applyOptState();
        optToggle.addEventListener('click', () => {
          s.optional_open = !s.optional_open;
          applyOptState();
        });
      }

      studentsArea.appendChild(node);
    });
  }

  function propagateGradeClassDown(parentIdx) {
    const blocks = studentsArea.querySelectorAll('.student-block');
    for (let j = parentIdx + 1; j < students.length; j++) {
      const child = students[j];
      if (!child.same_as_prev) break;
      const childBlock = blocks[j];
      if (!childBlock) continue;
      childBlock.querySelector('.f-grade').value = gradeOf(students[j - 1]);
      childBlock.querySelector('.f-class').value = classOf(students[j - 1]);
    }
  }

  // === 2단계: 프로그램 카드 + 학생 체크 ===
  function studentDisplayName(s, i) {
    const name = (s.cache.name || '').trim() || `학생 ${i + 1}`;
    const g = (i >= 1 && s.same_as_prev) ? gradeOf(students[i - 1]) : (s.cache.grade || '');
    const c = (i >= 1 && s.same_as_prev) ? classOf(students[i - 1]) : (s.cache.class_no || '');
    if (g && c) return `${name} ${g}-${c}`;
    if (g) return `${name} ${g}학년`;
    return name;
  }

  function renderStep2() {
    if (!programs.length) {
      programsArea.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    if (students.length === 0) {
      programsArea.innerHTML = '<div class="empty-state muted">먼저 위에서 신청 학생을 등록해 주세요.</div>';
      return;
    }
    const noStudentInfo = allStudentsEmpty();

    programsArea.innerHTML = programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      const tags = [
        typeBadge(p.program_type),
        isFull ? '<span class="badge full">마감</span>' : '<span class="badge open">모집중</span>',
      ].filter(Boolean).join(' ');

      // 자격 학생 인덱스
      const eligibleIdxs = [];
      students.forEach((s, i) => {
        const eff = effGradeForStudent(i);
        if (eff != null && eff >= p.grade_min && eff <= p.grade_max) eligibleIdxs.push(i);
      });
      const allEligibleSelected = eligibleIdxs.length > 0 &&
        eligibleIdxs.every(i => students[i].selected.has(p.id));
      const selectAllLabel = allEligibleSelected ? '전체 해제' : '신청 가능한 학생 모두 선택';
      const selectAllDisabled = isFull || eligibleIdxs.length === 0;

      let body;
      if (noStudentInfo) {
        body = `<div class="s2-empty-hint">먼저 위에서 신청 학생 정보를 입력해 주세요</div>`;
      } else {
        const studentRows = students.map((s, i) => {
          const eff = effGradeForStudent(i);
          const gradeOk = eff != null && eff >= p.grade_min && eff <= p.grade_max;
          const disabled = isFull || !gradeOk;
          const checked = s.selected.has(p.id);
          const cls = ['s2-row'];
          if (checked) cls.push('selected');
          if (disabled) cls.push('disabled');
          const noGrade = eff == null;
          const reason = noGrade ? '<span class="s2-note">학년 입력 후 선택 가능</span>'
            : (!gradeOk ? '<span class="s2-note bad">대상 학년 아님</span>' : '');
          return `
            <label class="${cls.join(' ')}">
              <input type="checkbox" data-pid="${esc(p.id)}" data-sid="${s.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
              <span class="s2-name">${esc(studentDisplayName(s, i))}</span>
              ${reason}
            </label>
          `;
        }).join('');
        body = `
          <div class="s2-actions">
            <button type="button" class="s2-select-all" data-pid="${esc(p.id)}" ${selectAllDisabled ? 'disabled' : ''}>${selectAllLabel}</button>
          </div>
          <div class="s2-students">${studentRows}</div>
        `;
      }

      return `
        <div class="step2-card ${isFull ? 'disabled' : ''}">
          <header class="s2-head">
            <div class="s2-title">${esc(p.title)} ${tags}</div>
            <div class="s2-meta">
              👶 ${p.grade_min}~${p.grade_max}학년 · 남은자리 <strong>${p.remaining}</strong>/${p.capacity}
            </div>
          </header>
          <div class="s2-sub">이 프로그램을 신청할 학생</div>
          ${body}
        </div>
      `;
    }).join('');

    // 체크박스 이벤트
    programsArea.querySelectorAll('input[type="checkbox"][data-pid]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const pid = e.target.dataset.pid;
        const sid = Number(e.target.dataset.sid);
        const s = students.find(x => x.id === sid);
        if (!s) return;
        if (e.target.checked) s.selected.add(pid);
        else s.selected.delete(pid);
        renderStep2();
        renderSummary();
      });
    });

    // 일괄 선택 버튼 이벤트
    programsArea.querySelectorAll('button.s2-select-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        const p = programs.find(x => x.id === pid);
        if (!p) return;
        const eligible = [];
        students.forEach((s, i) => {
          const eff = effGradeForStudent(i);
          if (eff != null && eff >= p.grade_min && eff <= p.grade_max) eligible.push(s);
        });
        if (eligible.length === 0) return;
        const allChecked = eligible.every(s => s.selected.has(pid));
        if (allChecked) eligible.forEach(s => s.selected.delete(pid));
        else eligible.forEach(s => s.selected.add(pid));
        renderStep2();
        renderSummary();
      });
    });
  }

  function updateSubmitState(totalCount) {
    const hint = document.getElementById('submit-hint');
    if (totalCount === 0) {
      submitBtn.disabled = true;
      if (hint) hint.style.display = '';
    } else {
      submitBtn.disabled = false;
      if (hint) hint.style.display = 'none';
    }
  }

  // === 3단계: 신청 내용 확인 (학생별 요약) + 다문화 질문 ===
  function renderSummary() {
    if (students.length === 0) {
      summaryArea.innerHTML = '<div class="empty">먼저 위에서 학생과 프로그램을 선택해 주세요.</div>';
      updateSubmitState(0);
      return;
    }
    const totalCount = students.reduce((acc, s) => acc + s.selected.size, 0);
    updateSubmitState(totalCount);
    const groupTag = students.length >= 2
      ? `<div class="summary-group-tag">형제·자매 ${students.length}명 묶음 신청</div>` : '';

    const blocks = students.map((s, i) => {
      const dispName = studentDisplayName(s, i);
      const list = Array.from(s.selected);
      const programLine = list.length === 0
        ? '<span class="muted">선택한 프로그램 없음</span>'
        : list.map(pid => {
            const p = programs.find(x => x.id === pid);
            return p ? esc(p.title) : '?';
          }).join(', ');

      const hasMc = list.some(pid => {
        const p = programs.find(x => x.id === pid);
        return p && p.program_type === 'multicultural';
      });
      if (!hasMc) s.cache.is_multicultural = false;
      const mcBlock = hasMc ? `
        <label class="summary-mc">
          <input type="checkbox" class="f-mc" data-sid="${s.id}" ${s.cache.is_multicultural ? 'checked' : ''}>
          <span>다문화가정 여부 <span class="muted">(선택)</span></span>
        </label>
      ` : '';

      return `
        <div class="summary-student ${list.length === 0 ? 'empty' : ''}">
          <div class="ss-head"><b>${esc(dispName)}</b></div>
          <div class="ss-line">신청 프로그램: ${programLine}</div>
          ${mcBlock}
        </div>
      `;
    }).join('');

    summaryArea.innerHTML = `
      ${groupTag}
      ${blocks}
      <div class="summary-total">총 <strong>${totalCount}</strong>건 신청 예정</div>
    `;

    summaryArea.querySelectorAll('input.f-mc[data-sid]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const sid = Number(e.target.dataset.sid);
        const s = students.find(x => x.id === sid);
        if (s) s.cache.is_multicultural = e.target.checked;
      });
    });
  }

  // === 데이터 로드 ===
  async function loadPrograms() {
    try {
      const res = await fetch('/api/public/programs');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      programs = j.data || [];
      renderDetailList();
      if (students.length === 0) addStudent();
      else { renderStudents(); renderStep2(); renderSummary(); }
    } catch (err) {
      detailListEl.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다: ${esc(err.message)}</div>`;
      programsArea.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다.</div>`;
    }
  }

  // === 동의 텍스트 ===
  function renderPrivacyText() {
    const el = document.getElementById('privacy-text');
    if (!el) return;
    const items = PRIVACY_TEXT.items.map((s, i) => `<li><b>${i + 1}.</b> ${esc(s)}</li>`).join('');
    el.innerHTML = `
      <div style="margin-bottom:6px;">${esc(PRIVACY_TEXT.intro)}</div>
      <ol style="padding-left:18px; list-style:none;">${items}</ol>
    `;
  }

  // === 학생 추가 버튼 ===
  addSiblingBtn.addEventListener('click', () => {
    if (students.length >= MAX_STUDENTS) {
      alert(`한 번에 최대 ${MAX_STUDENTS}명까지 신청할 수 있습니다.`);
      return;
    }
    addStudent();
  });

  // === 제출 ===
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const studentsPayload = [];
    let validationErr = null;

    students.forEach((s, i) => {
      if (validationErr) return;
      const name = (s.cache.name || '').trim();
      const grade = Number(effGradeForStudent(i));
      const cls = Number((s.same_as_prev && i > 0) ? classOf(students[i - 1]) : s.cache.class_no);
      const sphone = (s.cache.student_phone || '').trim() || null;
      const mot = (s.cache.motivation || '').trim() || null;
      const isMc = !!s.cache.is_multicultural;
      const program_ids = Array.from(s.selected);

      if (!name) { validationErr = `학생 ${i + 1}의 이름을 입력해 주세요.`; return; }
      if (!grade || grade < 1 || grade > 6) { validationErr = `${name}의 학년을 1~6 사이로 입력해 주세요.`; return; }
      if (!cls || cls < 1 || cls > 30) { validationErr = `${name}의 반을 1~30 사이로 입력해 주세요.`; return; }
      if (program_ids.length === 0) { validationErr = `${name}이(가) 신청할 프로그램을 1개 이상 선택해 주세요. (② 영역에서 체크)`; return; }
      if (sphone && !isValidPhone(sphone)) { validationErr = `${name}의 학생 연락처가 올바르지 않습니다(010-XXXX-XXXX).`; return; }

      for (const pid of program_ids) {
        const p = programs.find(x => x.id === pid);
        if (!p) continue;
        if (grade < p.grade_min || grade > p.grade_max) {
          validationErr = `${name}: "${p.title}"은(는) ${p.grade_min}~${p.grade_max}학년 대상입니다.`;
          return;
        }
      }

      studentsPayload.push({
        student_name: name,
        grade, class_no: cls,
        student_phone: sphone,
        motivation: mot,
        program_ids,
        is_multicultural: isMc,
      });
    });

    if (validationErr) { alert(validationErr); return; }
    if (studentsPayload.length === 0) { alert('학생 정보가 없습니다.'); return; }

    const guardianName = document.getElementById('guardian_name').value.trim();
    const guardianPhone = document.getElementById('guardian_phone').value.trim();
    if (!guardianName) { alert('보호자 이름을 입력해 주세요.'); return; }
    if (!isValidPhone(guardianPhone)) {
      alert('올바른 휴대폰 번호를 입력해 주세요(010-XXXX-XXXX).');
      document.getElementById('guardian_phone').focus();
      return;
    }
    if (!document.getElementById('privacy_agreed').checked) {
      alert('개인정보 수집·이용 동의가 필요합니다.');
      return;
    }

    const payload = {
      students: studentsPayload,
      guardian_name: guardianName,
      guardian_phone: guardianPhone,
      privacy_agreed: true,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중…';
    try {
      const res = await fetch('/api/public/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error || '신청 처리 중 오류가 발생했습니다.');
        submitBtn.disabled = false;
        submitBtn.textContent = '신청하기';
        return;
      }
      renderResult(j, payload);
      window.scrollTo({ top: resultArea.offsetTop - 20, behavior: 'smooth' });
    } catch (err) {
      alert('서버에 연결할 수 없습니다: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '신청하기';
    }
  });

  function renderResult(result, payload) {
    const { accepted = [], rejected = [], sibling_group_id } = result;
    let html = '<div class="result-box">';
    html += '<h2>✅ 신청 결과</h2>';
    if (sibling_group_id) {
      html += `<div class="muted" style="margin-bottom:10px;">형제·자매 ${payload.students.length}명 묶음 접수</div>`;
    }
    const byStudent = {};
    accepted.forEach(a => { (byStudent[a.student_name] = byStudent[a.student_name] || { accepted: [], rejected: [] }).accepted.push(a); });
    rejected.forEach(r => { (byStudent[r.student_name] = byStudent[r.student_name] || { accepted: [], rejected: [] }).rejected.push(r); });

    Object.keys(byStudent).forEach(name => {
      const g = byStudent[name];
      html += `<div style="margin-top:14px;"><b>${esc(name)}</b></div>`;
      g.accepted.forEach(a => {
        html += `<div class="item">
          ✓ ${esc(a.title)}
          <div class="sub">${esc(a.schedule || '')} · 접수시각: ${fmtTime(a.submitted_at)}</div>
        </div>`;
      });
      g.rejected.forEach(r => {
        html += `<div class="item reject">✗ ${esc(r.title)} <div class="sub">${esc(r.reason)}</div></div>`;
      });
    });

    if (accepted.length === 0 && rejected.length === 0) {
      html += '<div class="item">접수 결과가 없습니다.</div>';
    }
    html += '<div class="item" style="margin-top:14px; background:var(--primary-soft); padding:12px; border-radius:8px;">';
    html += '<b>선정된 학생에게만 따로 연락드립니다.</b><br><span class="sub">결과 발표 전까지 보호자 연락처를 확인해 주세요.</span>';
    html += '</div>';
    html += '<div class="item" style="margin-top:10px; background:#F8FAFC; padding:12px; border-radius:8px;">';
    html += '🔎 내 신청은 상단 <a href="/me"><b>내 신청 확인</b></a> 메뉴에서 <b>보호자 연락처와 학생 이름</b>으로 조회·취소할 수 있어요.';
    html += '</div>';
    html += '<div class="submit-row"><a class="btn" href="/me">내 신청 확인</a><button class="btn" onclick="location.reload()">다른 신청 하기</button></div>';
    html += '</div>';
    resultArea.innerHTML = html;
    form.style.display = 'none';
  }

  // === 초기화 ===
  renderPrivacyText();
  attachPhoneFormatter(document.getElementById('guardian_phone'));
  loadPrograms();
})();
