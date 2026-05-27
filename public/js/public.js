(() => {
  // === 운영 문구: 보유기간 등 바뀔 수 있는 부분은 여기서만 수정하면 됨 ===
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
  function isValidPhone(s) {
    return /^010-\d{4}-\d{4}$/.test(String(s || ''));
  }
  function attachPhoneFormatter(input) {
    if (!input || input.dataset.phoneFormatter === '1') return;
    input.dataset.phoneFormatter = '1';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', '13');
    input.setAttribute('placeholder', '010-XXXX-XXXX');
    input.addEventListener('input', () => {
      const formatted = formatPhone(input.value);
      if (input.value !== formatted) input.value = formatted;
    });
  }

  let programs = [];
  // students[i] = { id, selected:Set<programId>, cache:{name,grade,class_no,student_phone,motivation,is_multicultural}, same_as_prev:bool }
  const students = [];
  let counter = 0;

  const detailListEl = document.getElementById('program-detail-list');
  const studentsArea = document.getElementById('students-area');
  const cartEl = document.getElementById('cart');
  const form = document.getElementById('apply-form');
  const submitBtn = document.getElementById('submit-btn');
  const resultArea = document.getElementById('result-area');
  const addSiblingBtn = document.getElementById('add-sibling-btn');
  const tpl = document.getElementById('student-block-tpl');

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

  function renderPrivacyText() {
    const el = document.getElementById('privacy-text');
    if (!el) return;
    const itemsHtml = PRIVACY_TEXT.items
      .map((s, i) => `<li><b>${i + 1}.</b> ${esc(s)}</li>`).join('');
    el.innerHTML = `
      <div style="margin-bottom:6px;">${esc(PRIVACY_TEXT.intro)}</div>
      <ol style="padding-left:18px; list-style:none;">${itemsHtml}</ol>
    `;
  }

  async function loadPrograms() {
    try {
      const res = await fetch('/api/public/programs');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      programs = j.data || [];
      renderDetailList();
      if (students.length === 0) addStudent();
      renderAllStudents();
      renderCart();
    } catch (err) {
      detailListEl.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  }

  function renderDetailList() {
    if (!programs.length) {
      detailListEl.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    detailListEl.innerHTML = programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      return `
        <div class="program ${isFull ? 'disabled' : ''}">
          <div class="body">
            <div class="title">${esc(p.title)} ${typeBadge(p.program_type)} ${isFull ? '<span class="badge full">마감</span>' : '<span class="badge open">모집중</span>'}</div>
            <div class="meta">
              ${p.schedule ? `📅 ${esc(p.schedule)}<br>` : ''}
              ${p.location ? `📍 ${esc(p.location)} · ` : ''}
              👶 ${p.grade_min}~${p.grade_max}학년 · 정원 ${p.capacity}명
              ${p.instructors ? `<br>🧑‍🏫 ${esc(p.instructors)}` : ''}
              ${p.description ? `<br><span class="muted">${esc(p.description)}</span>` : ''}
            </div>
          </div>
          <div class="right">
            <div class="seats">남은자리<br><strong>${p.remaining}</strong> / ${p.capacity}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function addStudent() {
    counter += 1;
    students.push({
      id: counter,
      selected: new Set(),
      cache: {},
      same_as_prev: students.length >= 1, // 형제는 기본 ON (편의)
    });
    renderAllStudents();
    renderCart();
  }

  function removeStudent(id) {
    const idx = students.findIndex(s => s.id === id);
    if (idx < 0) return;
    students.splice(idx, 1);
    renderAllStudents();
    renderCart();
  }

  function gradeOf(student) {
    // same_as_prev이면 이전 학생의 학년 사용
    if (!student) return '';
    const idx = students.indexOf(student);
    if (student.same_as_prev && idx > 0) {
      return gradeOf(students[idx - 1]);
    }
    return student.cache.grade || '';
  }
  function classOf(student) {
    if (!student) return '';
    const idx = students.indexOf(student);
    if (student.same_as_prev && idx > 0) {
      return classOf(students[idx - 1]);
    }
    return student.cache.class_no || '';
  }

  function renderAllStudents() {
    studentsArea.innerHTML = '';
    students.forEach((s, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.sid = s.id;
      node.querySelector('.idx').textContent = i === 0 ? '1 (본인)' : (i + 1);

      const rmBtn = node.querySelector('.remove-student');
      if (students.length > 1) {
        rmBtn.hidden = false;
        rmBtn.addEventListener('click', () => removeStudent(s.id));
      }

      // same-as-prev: 학생 2부터 노출
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
            // 위 학생 값 자동 복사
            s.cache.grade = gradeOf(students[i - 1]);
            s.cache.class_no = classOf(students[i - 1]);
          }
          renderAllStudents();
          renderCart();
        });
      }

      // 기본값 채우기
      node.querySelector('.f-name').value = s.cache.name || '';
      const effGrade = i >= 1 && s.same_as_prev ? gradeOf(students[i - 1]) : (s.cache.grade || '');
      const effClass = i >= 1 && s.same_as_prev ? classOf(students[i - 1]) : (s.cache.class_no || '');
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
      node.querySelector('.f-multicultural').checked = !!s.cache.is_multicultural;

      // 입력 → 캐시 (학년·반이 바뀌면 같음 체크한 자식들에게 즉시 반영)
      const onNameInput = () => { s.cache.name = node.querySelector('.f-name').value.trim(); renderCart(); };
      node.querySelector('.f-name').addEventListener('input', onNameInput);

      gradeInput.addEventListener('input', () => {
        if (gradeInput.readOnly) return;
        s.cache.grade = gradeInput.value;
        propagateGradeClassDown(i);
        // 학년이 바뀌면 그 학생의 체크 가능한 프로그램 목록이 달라지므로 그 블록만 다시 그림
        rerenderCompactListForStudent(i);
        // 자식의 학년이 바뀌었으면 자식 블록들도 다시 그려야 함 (same_as_prev=true인 동안)
        rerenderCompactListForChildren(i);
        updateMulticulturalBlock(node, s);
        renderCart();
      });
      classInput.addEventListener('input', () => {
        if (classInput.readOnly) return;
        s.cache.class_no = classInput.value;
        propagateGradeClassDown(i);
      });
      attachPhoneFormatter(node.querySelector('.f-sphone'));
      node.querySelector('.f-sphone').addEventListener('input', (e) => { s.cache.student_phone = e.target.value.trim(); });
      node.querySelector('.f-motivation').addEventListener('input', (e) => { s.cache.motivation = e.target.value.trim(); });
      node.querySelector('.f-multicultural').addEventListener('change', (e) => { s.cache.is_multicultural = e.target.checked; });

      // 컴팩트 프로그램 체크리스트
      const plist = node.querySelector('.student-programs');
      plist.innerHTML = renderCompactProgramList(s, i);
      attachCompactListHandlers(plist, s, node);

      updateMulticulturalBlock(node, s);
      studentsArea.appendChild(node);
    });
  }

  function propagateGradeClassDown(parentIdx) {
    // 부모의 학년/반이 바뀌면 same_as_prev 체크된 자식들의 입력값 DOM에 즉시 반영
    const parent = students[parentIdx];
    if (!parent) return;
    const blocks = studentsArea.querySelectorAll('.student-block');
    for (let j = parentIdx + 1; j < students.length; j++) {
      const child = students[j];
      if (!child.same_as_prev) break; // 연쇄 끊김
      const childBlock = blocks[j];
      if (!childBlock) continue;
      const g = childBlock.querySelector('.f-grade');
      const c = childBlock.querySelector('.f-class');
      const newGrade = gradeOf(students[j - 1]);
      const newClass = classOf(students[j - 1]);
      g.value = newGrade;
      c.value = newClass;
    }
  }

  function rerenderCompactListForStudent(idx) {
    const blocks = studentsArea.querySelectorAll('.student-block');
    const block = blocks[idx];
    const s = students[idx];
    if (!block || !s) return;
    const plist = block.querySelector('.student-programs');
    plist.innerHTML = renderCompactProgramList(s, idx);
    attachCompactListHandlers(plist, s, block);
    updateMulticulturalBlock(block, s);
  }
  function rerenderCompactListForChildren(parentIdx) {
    for (let j = parentIdx + 1; j < students.length; j++) {
      const child = students[j];
      if (!child.same_as_prev) break;
      rerenderCompactListForStudent(j);
    }
  }

  function effGradeForStudent(idx) {
    const s = students[idx];
    if (!s) return null;
    if (s.same_as_prev && idx > 0) return Number(gradeOf(students[idx - 1])) || null;
    return Number(s.cache.grade) || null;
  }

  function renderCompactProgramList(s, idx) {
    if (!programs.length) {
      return '<div class="empty-state muted" style="padding:14px;">모집 중인 프로그램이 없습니다.</div>';
    }
    const effGrade = effGradeForStudent(idx);
    return programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      const gradeOk = effGrade == null || (effGrade >= p.grade_min && effGrade <= p.grade_max);
      const disabled = isFull || !gradeOk;
      const checked = s.selected.has(p.id);
      const cls = ['compact-row'];
      if (checked) cls.push('selected');
      if (disabled) cls.push('disabled');
      const tags = [
        typeBadge(p.program_type),
        isFull ? '<span class="badge full">마감</span>' : '',
        (!isFull && !gradeOk) ? '<span class="badge closed">학년 안 맞음</span>' : '',
      ].filter(Boolean).join(' ');
      return `
        <label class="${cls.join(' ')}">
          <input type="checkbox" data-pid="${p.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span class="cr-title">${esc(p.title)}</span>
          <span class="cr-meta">${p.grade_min}~${p.grade_max}학년 · 남은 ${p.remaining}/${p.capacity}</span>
          <span class="cr-tags">${tags}</span>
        </label>
      `;
    }).join('');
  }

  function attachCompactListHandlers(plistEl, s, blockNode) {
    plistEl.querySelectorAll('input[type="checkbox"][data-pid]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const pid = e.target.dataset.pid;
        if (e.target.checked) s.selected.add(pid);
        else s.selected.delete(pid);
        // 시각적 selected 클래스만 토글
        cb.closest('.compact-row').classList.toggle('selected', e.target.checked);
        updateMulticulturalBlock(blockNode, s);
        renderCart();
      });
    });
  }

  function updateMulticulturalBlock(node, s) {
    const block = node.querySelector('.multicultural-q');
    if (!block) return;
    const hasMc = Array.from(s.selected).some(pid => {
      const p = programs.find(x => x.id === pid);
      return p && p.program_type === 'multicultural';
    });
    block.hidden = !hasMc;
    if (!hasMc) {
      const cb = node.querySelector('.f-multicultural');
      if (cb) cb.checked = false;
      s.cache.is_multicultural = false;
    }
  }

  function renderCart() {
    const lines = [];
    let total = 0;
    students.forEach((s, i) => {
      const name = s.cache.name || `학생 ${i + 1}`;
      Array.from(s.selected).forEach(pid => {
        const p = programs.find(x => x.id === pid);
        if (!p) return;
        total += 1;
        lines.push(`<li><b>${esc(name)}</b> — ${esc(p.title)} <span class="muted">(${esc(p.schedule || '')})</span></li>`);
      });
    });
    if (total === 0) {
      cartEl.innerHTML = '<div class="empty">아직 선택한 프로그램이 없습니다.</div>';
      return;
    }
    cartEl.innerHTML = `<b>총 ${total}건 신청 예정${students.length >= 2 ? ` (형제·자매 ${students.length}명)` : ''}:</b><ul>${lines.join('')}</ul>`;
  }

  addSiblingBtn.addEventListener('click', () => {
    if (students.length >= 6) {
      alert('한 번에 최대 6명까지 신청할 수 있습니다.');
      return;
    }
    addStudent();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const studentsPayload = [];
    let validationErr = null;

    students.forEach((s, i) => {
      if (validationErr) return;
      const name = (s.cache.name || '').trim();
      const grade = Number(effGradeForStudent(i));
      const cls = Number(
        (s.same_as_prev && i > 0) ? classOf(students[i - 1]) : s.cache.class_no
      );
      const sphone = (s.cache.student_phone || '').trim() || null;
      const mot = (s.cache.motivation || '').trim() || null;
      const isMc = !!s.cache.is_multicultural;
      const program_ids = Array.from(s.selected);

      if (!name) { validationErr = `학생 ${i + 1}의 이름을 입력해 주세요.`; return; }
      if (!grade || grade < 1 || grade > 6) { validationErr = `${name}의 학년을 1~6 사이로 입력해 주세요.`; return; }
      if (!cls || cls < 1 || cls > 30) { validationErr = `${name}의 반을 1~30 사이로 입력해 주세요.`; return; }
      if (program_ids.length === 0) { validationErr = `${name}이(가) 신청할 프로그램을 1개 이상 선택해 주세요.`; return; }
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
        grade,
        class_no: cls,
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
    html += '<div class="submit-row"><button class="btn" onclick="location.reload()">다른 신청 하기</button></div>';
    html += '</div>';
    resultArea.innerHTML = html;
    form.style.display = 'none';
  }

  renderPrivacyText();
  attachPhoneFormatter(document.getElementById('guardian_phone'));
  loadPrograms();
})();
