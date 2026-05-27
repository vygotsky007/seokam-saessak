(() => {
  let programs = [];
  const students = []; // [{ id, selected:Set<programId> }]
  let counter = 0;

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

  async function loadPrograms() {
    try {
      const res = await fetch('/api/public/programs');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      programs = j.data || [];
      if (students.length === 0) addStudent();
      renderAllStudents();
      renderCart();
    } catch (err) {
      studentsArea.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  }

  function addStudent() {
    counter += 1;
    students.push({ id: counter, selected: new Set() });
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
      // 입력값 복원
      const cache = s.cache || {};
      node.querySelector('.f-name').value = cache.name || '';
      node.querySelector('.f-grade').value = cache.grade || '';
      node.querySelector('.f-class').value = cache.class_no || '';
      node.querySelector('.f-sphone').value = cache.student_phone || '';
      node.querySelector('.f-motivation').value = cache.motivation || '';

      const plist = node.querySelector('.student-programs');
      plist.innerHTML = renderProgramList(s);

      // 체크박스 이벤트
      plist.querySelectorAll('input[type="checkbox"][data-pid]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const pid = e.target.dataset.pid;
          if (e.target.checked) s.selected.add(pid);
          else s.selected.delete(pid);
          updateMulticulturalBlock(node, s);
          renderAllStudents();
          renderCart();
        });
      });

      // 입력 캐싱
      node.querySelectorAll('input, textarea').forEach(el => {
        if (el.classList.contains('f-multicultural')) {
          el.checked = !!cache.is_multicultural;
          el.addEventListener('change', () => {
            s.cache = collectCache(node, s);
          });
        } else {
          el.addEventListener('input', () => {
            s.cache = collectCache(node, s);
          });
        }
      });

      updateMulticulturalBlock(node, s);

      studentsArea.appendChild(node);
    });
  }

  function collectCache(node, s) {
    return {
      name: node.querySelector('.f-name').value.trim(),
      grade: node.querySelector('.f-grade').value,
      class_no: node.querySelector('.f-class').value,
      student_phone: node.querySelector('.f-sphone').value.trim(),
      motivation: node.querySelector('.f-motivation').value.trim(),
      is_multicultural: node.querySelector('.f-multicultural').checked,
    };
  }

  function renderProgramList(s) {
    if (!programs.length) {
      return '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
    }
    return programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      const checked = s.selected.has(p.id);
      const cls = ['program'];
      if (checked) cls.push('selected');
      if (isFull) cls.push('disabled');
      return `
        <div class="${cls.join(' ')}">
          <label class="check">
            <input type="checkbox" data-pid="${p.id}" ${checked ? 'checked' : ''} ${isFull ? 'disabled' : ''}>
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
          </label>
          <div class="right">
            <div class="seats">남은자리<br><strong>${p.remaining}</strong> / ${p.capacity}</div>
          </div>
        </div>
      `;
    }).join('');
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
      if (s.cache) s.cache.is_multicultural = false;
    }
  }

  function renderCart() {
    const total = students.reduce((acc, s) => acc + s.selected.size, 0);
    if (total === 0) {
      cartEl.innerHTML = '<div class="empty">아직 선택한 프로그램이 없습니다.</div>';
      return;
    }
    const lines = [];
    students.forEach((s, i) => {
      const name = (s.cache && s.cache.name) || `학생 ${i + 1}`;
      const list = Array.from(s.selected).map(pid => {
        const p = programs.find(x => x.id === pid);
        if (!p) return null;
        return `<li>${esc(p.title)} <span class="muted">(${p.grade_min}~${p.grade_max}학년 · ${esc(p.schedule || '')})</span></li>`;
      }).filter(Boolean).join('');
      if (list) lines.push(`<div style="margin-bottom:6px;"><b>${esc(name)}</b><ul>${list}</ul></div>`);
    });
    cartEl.innerHTML = `<b>총 ${total}건 신청 예정${students.length >= 2 ? ` (형제·자매 ${students.length}명)` : ''}:</b>${lines.join('')}`;
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

    // 학생별 collect & validate
    const blocks = studentsArea.querySelectorAll('.student-block');
    const studentsPayload = [];
    let validationErr = null;

    blocks.forEach((node, i) => {
      if (validationErr) return;
      const s = students[i];
      if (!s) return;
      const name = node.querySelector('.f-name').value.trim();
      const grade = Number(node.querySelector('.f-grade').value);
      const classNo = Number(node.querySelector('.f-class').value);
      const sphone = node.querySelector('.f-sphone').value.trim() || null;
      const mot = node.querySelector('.f-motivation').value.trim() || null;
      const isMc = node.querySelector('.f-multicultural').checked;
      const program_ids = Array.from(s.selected);

      if (!name) { validationErr = `학생 ${i + 1}의 이름을 입력해 주세요.`; return; }
      if (!grade || grade < 1 || grade > 6) { validationErr = `${name}의 학년을 1~6 사이로 입력해 주세요.`; return; }
      if (!classNo || classNo < 1 || classNo > 30) { validationErr = `${name}의 반을 1~30 사이로 입력해 주세요.`; return; }
      if (program_ids.length === 0) { validationErr = `${name}이(가) 신청할 프로그램을 1개 이상 선택해 주세요.`; return; }

      // 학년 범위 검증
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
        class_no: classNo,
        student_phone: sphone,
        motivation: mot,
        program_ids,
        is_multicultural: isMc,
      });
    });

    if (validationErr) { alert(validationErr); return; }
    if (studentsPayload.length === 0) { alert('학생 정보가 없습니다.'); return; }

    const payload = {
      students: studentsPayload,
      guardian_name: document.getElementById('guardian_name').value.trim(),
      guardian_phone: document.getElementById('guardian_phone').value.trim(),
      privacy_agreed: document.getElementById('privacy_agreed').checked,
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
    // by student
    const byStudent = {};
    accepted.forEach(a => {
      (byStudent[a.student_name] = byStudent[a.student_name] || { accepted: [], rejected: [] }).accepted.push(a);
    });
    rejected.forEach(r => {
      (byStudent[r.student_name] = byStudent[r.student_name] || { accepted: [], rejected: [] }).rejected.push(r);
    });

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

  loadPrograms();
})();
