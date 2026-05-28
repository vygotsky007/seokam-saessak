(() => {
  // === 휴대폰 포맷팅/검증 (public.js와 동일 로직) ===
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
    input.addEventListener('input', () => {
      const f = formatPhone(input.value);
      if (input.value !== f) input.value = f;
    });
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function statusLabel(s) {
    // 의도적으로 선정/대기/탈락은 노출하지 않음 — 활성 신청은 모두 "접수 완료"
    if (s === 'cancelled') return '<span class="badge cancelled">취소됨</span>';
    return '<span class="badge open">접수 완료</span>';
  }
  // 자동 접수/대기 구분 (관리자의 선정 결과는 별개 - 여기선 미노출)
  function autoSlotLabel(r) {
    if (r.status === 'cancelled') return '';
    if (r.is_waitlist) {
      const n = r.slot_number;
      return `<span class="badge waiting">대기${n ? ` ${n}번` : ''}</span>`;
    }
    const n = r.slot_number;
    return `<span class="badge open">접수${n ? ` ${n}번째` : ''}</span>`;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  let lastList = [];
  let lastPhone = '';
  let lastName = '';

  attachPhoneFormatter(document.getElementById('lookup_phone'));

  document.getElementById('lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('lookup_phone').value.trim();
    const name = document.getElementById('lookup_name').value.trim();
    if (!isValidPhone(phone)) {
      alert('올바른 보호자 연락처를 입력해 주세요(010-XXXX-XXXX).');
      return;
    }
    if (!name) { alert('학생 이름을 입력해 주세요.'); return; }
    lastPhone = phone;
    lastName = name;
    await loadLookup();
  });

  async function loadLookup() {
    try {
      const res = await fetch('/api/public/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardian_phone: lastPhone, student_name: lastName }),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '조회 실패'); return; }
      lastList = j.data || [];
      renderResult(j);
    } catch (err) { alert('서버 오류: ' + err.message); }
  }

  function renderResult(j) {
    const el = document.getElementById('lookup-result');
    if (!j.data || j.data.length === 0) {
      el.innerHTML = `<div class="panel"><div class="empty-state">${esc(j.message || '일치하는 신청을 찾을 수 없습니다.')}</div></div>`;
      return;
    }
    // 학생 이름별로 묶기
    const groups = {};
    j.data.forEach(r => {
      const k = r.student_name || '(이름 없음)';
      (groups[k] = groups[k] || []).push(r);
    });

    const blocks = Object.keys(groups).map(name => {
      const rows = groups[name];
      const items = rows.map(r => {
        const isCancelled = r.status === 'cancelled';
        const program = r.program || {};
        return `
          <div class="app-item ${isCancelled ? 'cancelled' : ''}">
            <div class="app-main">
              <div class="app-title">${esc(program.title || '(프로그램)')} ${statusLabel(r.status)} ${isCancelled ? '' : autoSlotLabel(r)}</div>
              <div class="app-meta">
                ${program.schedule ? `📅 ${esc(program.schedule)}` : ''}
                ${program.location ? ` · 📍 ${esc(program.location)}` : ''}
                <br>접수시각: ${fmtTime(r.submitted_at)}
              </div>
            </div>
            <div class="app-actions">
              ${isCancelled
                ? ''
                : `<button class="btn small" data-edit="${r.id}">정보 수정</button>
                   <button class="btn small danger" data-cancel="${r.id}">신청 취소</button>`}
            </div>
          </div>
        `;
      }).join('');
      return `<div class="app-group">
        <div class="app-group-head"><b>${esc(name)}</b> <span class="muted">${rows.length}건</span></div>
        ${items}
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="section-title" style="margin-top: 24px;">📋 신청 내역</div>
      <div class="panel result-panel">${blocks}</div>
      <div class="notice" style="margin-top:14px;">
        <strong>안내</strong>
        <ul>
          <li>여기에 보이는 상태는 <b>접수/대기/취소</b>만 표시돼요. <b>접수·대기는 확정이 아니며</b>, 최종 선정 결과는 담당 선생님이 별도로 안내드립니다.</li>
          <li>취소·수정은 본인 확인을 위해 <b>조회에 사용한 보호자 연락처와 학생 이름</b>이 신청 정보와 일치해야 가능합니다.</li>
        </ul>
      </div>
    `;

    el.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => onCancelClick(b.dataset.cancel)));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => onEditClick(b.dataset.edit)));
  }

  // 본인 확인 키는 조회에 사용한 (guardian_phone + student_name) 그대로 사용.
  // 단, 신청 행의 student_name이 조회 입력값과 달라지면(형제 신청에 다른 학생도 들어 있는 경우)
  // 해당 행의 student_name을 본인 확인 키로 보낸다.
  function ownerKeyFor(row) {
    return { guardian_phone: lastPhone, student_name: row ? row.student_name : lastName };
  }

  // ===== 취소 =====
  async function onCancelClick(id) {
    const ok = confirm('취소하면 자리가 사라지고, 다시 신청할 때 정원이 찼을 수 있어요. 취소할까요?');
    if (!ok) return;
    const row = lastList.find(r => r.id === id);
    try {
      const res = await fetch(`/api/public/applications/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ownerKeyFor(row)),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '취소 실패'); return; }
      toast(j.already ? '이미 취소된 신청입니다.' : '신청이 취소되었습니다.');
      await loadLookup();
    } catch (err) { alert('서버 오류: ' + err.message); }
  }

  // ===== 수정 =====
  let editingId = null;
  let editingRow = null;
  function onEditClick(id) {
    const row = lastList.find(r => r.id === id);
    if (!row) { alert('신청을 찾을 수 없습니다.'); return; }
    editingId = id;
    editingRow = row;
    const f = document.getElementById('edit-form');
    f.student_name.value = row.student_name || '';
    f.grade.value = row.grade ?? '';
    f.class_no.value = row.class_no ?? '';
    f.guardian_name.value = row.guardian_name || '';
    f.guardian_phone.value = row.guardian_phone || '';
    f.student_phone.value = row.student_phone || '';
    f.motivation.value = row.motivation || '';
    document.getElementById('edit-dialog').classList.add('open');
  }
  document.querySelectorAll('[data-close-edit]').forEach(b => b.addEventListener('click', () => {
    document.getElementById('edit-dialog').classList.remove('open');
    editingId = null; editingRow = null;
  }));
  attachPhoneFormatter(document.querySelector('#edit-form [name="guardian_phone"]'));
  attachPhoneFormatter(document.querySelector('#edit-form [name="student_phone"]'));

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingId || !editingRow) return;
    const f = e.target;
    const patch = {
      student_name: f.student_name.value.trim(),
      grade: Number(f.grade.value),
      class_no: Number(f.class_no.value),
      guardian_name: f.guardian_name.value.trim(),
      guardian_phone: f.guardian_phone.value.trim(),
      student_phone: f.student_phone.value.trim(),
      motivation: f.motivation.value.trim(),
    };
    if (!isValidPhone(patch.guardian_phone)) { alert('올바른 보호자 연락처를 입력해 주세요(010-XXXX-XXXX).'); return; }
    if (patch.student_phone && !isValidPhone(patch.student_phone)) { alert('학생 연락처 형식이 올바르지 않습니다.'); return; }
    try {
      const owner = ownerKeyFor(editingRow);
      const res = await fetch(`/api/public/applications/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...owner, patch }),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '수정 실패'); return; }
      toast('수정되었습니다.');
      document.getElementById('edit-dialog').classList.remove('open');
      editingId = null; editingRow = null;
      // 보호자 연락처가 바뀌었으면 다음 조회 기준도 새 값으로
      const newPhone = patch.guardian_phone;
      if (newPhone && newPhone !== lastPhone) lastPhone = newPhone;
      await loadLookup();
    } catch (err) { alert('서버 오류: ' + err.message); }
  });

  // 모달 외부 클릭 시 닫기
  document.querySelectorAll('.dialog-mask').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
  });
})();
