(() => {
  let programs = [];
  const selected = new Set();

  const listEl = document.getElementById('program-list');
  const cartEl = document.getElementById('cart');
  const form = document.getElementById('apply-form');
  const submitBtn = document.getElementById('submit-btn');
  const resultArea = document.getElementById('result-area');

  async function loadPrograms() {
    try {
      const res = await fetch('/api/public/programs');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      programs = j.data || [];
      renderPrograms();
      renderCart();
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  }

  function renderPrograms() {
    if (!programs.length) {
      listEl.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    listEl.innerHTML = programs.map(p => {
      const isFull = p.is_full || p.remaining <= 0;
      const checked = selected.has(p.id);
      const cls = ['program'];
      if (checked) cls.push('selected');
      if (isFull) cls.push('disabled');
      return `
        <div class="${cls.join(' ')}" data-id="${p.id}">
          <label class="check">
            <input type="checkbox" data-id="${p.id}" ${checked ? 'checked' : ''} ${isFull ? 'disabled' : ''}>
            <div class="body">
              <div class="title">${esc(p.title)} ${isFull ? '<span class="badge full">마감</span>' : '<span class="badge open">모집중</span>'}</div>
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
            <div class="seats">
              남은자리<br><strong>${p.remaining}</strong> / ${p.capacity}
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
        renderPrograms();
        renderCart();
      });
    });
  }

  function renderCart() {
    const chosen = programs.filter(p => selected.has(p.id));
    if (chosen.length === 0) {
      cartEl.innerHTML = '<div class="empty">아직 선택한 프로그램이 없습니다.</div>';
      return;
    }
    cartEl.innerHTML = `
      <b>${chosen.length}개 프로그램 신청 예정:</b>
      <ul>
        ${chosen.map(p => `<li>${esc(p.title)} <span class="muted">(${p.grade_min}~${p.grade_max}학년 · ${esc(p.schedule || '')})</span></li>`).join('')}
      </ul>
    `;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const program_ids = Array.from(selected);
    if (program_ids.length === 0) {
      alert('신청할 프로그램을 1개 이상 선택해 주세요.');
      return;
    }

    const grade = Number(document.getElementById('grade').value);
    const out = [];
    for (const pid of program_ids) {
      const p = programs.find(x => x.id === pid);
      if (!p) continue;
      if (grade < p.grade_min || grade > p.grade_max) {
        out.push(`"${p.title}"은(는) ${p.grade_min}~${p.grade_max}학년 대상입니다.`);
      }
    }
    if (out.length > 0) {
      alert('학년이 맞지 않는 프로그램이 있습니다:\n\n' + out.join('\n'));
      return;
    }

    const payload = {
      program_ids,
      student_name: document.getElementById('student_name').value.trim(),
      grade,
      class_no: Number(document.getElementById('class_no').value),
      guardian_name: document.getElementById('guardian_name').value.trim(),
      guardian_phone: document.getElementById('guardian_phone').value.trim(),
      student_phone: document.getElementById('student_phone').value.trim() || null,
      motivation: document.getElementById('motivation').value.trim() || null,
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
    const { accepted = [], rejected = [] } = result;
    let html = '<div class="result-box">';
    html += '<h2>✅ 신청 결과</h2>';
    html += `<div class="muted" style="margin-bottom:10px;">${esc(payload.student_name)} (${payload.grade}학년 ${payload.class_no}반)</div>`;

    if (accepted.length > 0) {
      html += '<div style="margin-top:8px;"><b>접수된 프로그램</b></div>';
      accepted.forEach(a => {
        html += `<div class="item">
          ✓ ${esc(a.title)}
          <div class="sub">${esc(a.schedule || '')} · 접수시각: ${formatTime(a.submitted_at)}</div>
        </div>`;
      });
    }
    if (rejected.length > 0) {
      html += '<div style="margin-top:14px;"><b class="reject">접수되지 않은 프로그램</b></div>';
      rejected.forEach(r => {
        html += `<div class="item reject">✗ ${esc(r.title)} <div class="sub">${esc(r.reason)}</div></div>`;
      });
    }
    if (accepted.length === 0 && rejected.length === 0) {
      html += '<div class="item">접수 결과가 없습니다.</div>';
    }
    html += '<div class="item" style="margin-top:14px; background:var(--primary-soft); padding:12px; border-radius:8px;">';
    html += '<b>선정된 학생에게만 따로 연락드립니다.</b><br><span class="sub">결과 발표 전까지 보호자 연락처를 확인해 주세요.</span>';
    html += '</div>';
    html += '<div class="submit-row"><button class="btn" onclick="location.reload()">다른 신청 하기</button></div>';
    html += '</div>';
    resultArea.innerHTML = html;
    document.getElementById('apply-form').style.display = 'none';
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return iso; }
  }

  loadPrograms();
})();
