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
              <div class="app-title">${esc(program.title || '(프로그램)')} ${statusLabel(r.status)}</div>
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
          <li>여기에 보이는 상태는 <b>접수 완료</b> 또는 <b>취소됨</b>만 표시돼요. 선정 결과는 따로 안내드립니다.</li>
          <li>취소·수정 시에는 신청할 때 정한 <b>확인 비밀번호</b>가 필요합니다.</li>
        </ul>
      </div>
    `;

    el.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => onCancelClick(b.dataset.cancel)));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => onEditClick(b.dataset.edit)));
  }

  // ===== PIN 모달 =====
  let pinResolve = null;
  function askPin({ title, msg }) {
    return new Promise(resolve => {
      pinResolve = resolve;
      document.getElementById('pin-dialog-title').textContent = title || '확인 비밀번호';
      document.getElementById('pin-dialog-msg').textContent = msg || '신청할 때 설정한 4자리 확인 비밀번호를 입력해 주세요.';
      document.getElementById('pin-input').value = '';
      document.getElementById('pin-err').textContent = '';
      document.getElementById('pin-dialog').classList.add('open');
      setTimeout(() => document.getElementById('pin-input').focus(), 50);
    });
  }
  function closePinDialog(result) {
    document.getElementById('pin-dialog').classList.remove('open');
    if (pinResolve) { const r = pinResolve; pinResolve = null; r(result); }
  }
  document.getElementById('pin-cancel').addEventListener('click', () => closePinDialog(null));
  document.getElementById('pin-confirm').addEventListener('click', () => {
    const v = document.getElementById('pin-input').value.trim();
    if (!/^\d{4}$/.test(v)) {
      document.getElementById('pin-err').textContent = '숫자 4자리를 입력해 주세요.';
      return;
    }
    closePinDialog(v);
  });
  document.getElementById('pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pin-confirm').click();
  });

  // ===== 취소 =====
  async function onCancelClick(id) {
    const ok = confirm('취소하면 자리가 사라지고, 다시 신청할 때 정원이 찼을 수 있어요. 취소할까요?');
    if (!ok) return;
    const pin = await askPin({ title: '신청 취소', msg: '확인 비밀번호를 입력해 주세요. (취소는 되돌릴 수 없어요)' });
    if (!pin) return;
    try {
      const res = await fetch(`/api/public/applications/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '취소 실패'); return; }
      toast(j.already ? '이미 취소된 신청입니다.' : '신청이 취소되었습니다.');
      await loadLookup();
    } catch (err) { alert('서버 오류: ' + err.message); }
  }

  // ===== 수정 =====
  let editingId = null;
  let editingPin = null;
  async function onEditClick(id) {
    const pin = await askPin({ title: '정보 수정', msg: '신청할 때 설정한 확인 비밀번호를 입력해 주세요.' });
    if (!pin) return;
    editingId = id;
    editingPin = pin;
    const row = lastList.find(r => r.id === id);
    if (!row) { alert('신청을 찾을 수 없습니다.'); return; }
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
    editingId = null; editingPin = null;
  }));
  attachPhoneFormatter(document.querySelector('#edit-form [name="guardian_phone"]'));
  attachPhoneFormatter(document.querySelector('#edit-form [name="student_phone"]'));

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingId || !editingPin) return;
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
      const res = await fetch(`/api/public/applications/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: editingPin, patch }),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '수정 실패'); return; }
      toast('수정되었습니다.');
      document.getElementById('edit-dialog').classList.remove('open');
      editingId = null; editingPin = null;
      // 보호자 연락처가 바뀌었으면 그 값으로 다시 조회
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
