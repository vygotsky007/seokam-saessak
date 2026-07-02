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
  // 신청 상태 모델(통일): received/selected/waitlisted/confirmed/rejected/cancelled (+ 옛 값 매핑)
  const APP_STATUS_LEGACY = { applied: 'received', waiting: 'waitlisted' };
  function waitNo(r) { return r.waitlist_order || r.slot_number || null; }
  function statusInfo(r) {
    const s = APP_STATUS_LEGACY[r.status] || r.status || 'received';
    const wn = waitNo(r);
    switch (s) {
      case 'cancelled':  return { s, badge: '취소됨',  cls: 'cancelled', msg: '신청이 취소되었어요.' };
      case 'selected':   return { s, badge: '선정',    cls: 'selected',  msg: '축하해요! 선정되었어요. 자세한 내용은 보호자 연락처로 개별 안내드려요.' };
      case 'confirmed':  return { s, badge: '확정',    cls: 'selected',  msg: '참여가 확정되었어요. 일정에 맞춰 만나요!' };
      case 'waitlisted': return { s, badge: wn ? `대기 ${wn}번` : '대기', cls: 'waiting', msg: wn ? `대기 ${wn}번이에요. 빈자리가 나면 순서대로 안내드려요.` : '대기로 접수됐어요. 빈자리가 나면 순서대로 안내드려요.' };
      case 'rejected':   return { s, badge: '미선정',  cls: 'cancelled', msg: '이번에는 함께하지 못하게 되었어요. 다음 기회에 다시 만나요.' };
      case 'received':
      default:           return { s, badge: '접수됨',  cls: 'open',      msg: '접수되었어요. 선정 결과는 프로그램 시작 1주일 전쯤 개별 안내드려요. (접수는 확정이 아니에요)' };
    }
  }
  function statusBadgeHtml(r) {
    const info = statusInfo(r);
    return `<span class="badge ${info.cls}">${esc(info.badge)}</span>`;
  }
  // 상세 타임라인(접수됨 → 선정 → 확정). 대기/미선정/취소는 별도 표현.
  function timelineHtml(r) {
    const info = statusInfo(r);
    const step = (label, state) => `<span class="tl-step ${state}">${esc(label)}</span>`;
    const sep = '<span class="tl-sep">→</span>';
    let steps;
    if (info.s === 'cancelled') {
      steps = step('취소됨', 'end');
    } else if (info.s === 'rejected') {
      steps = [step('접수됨', 'done'), step('미선정', 'end')].join(sep);
    } else if (info.s === 'waitlisted') {
      const wn = waitNo(r);
      steps = [step('접수됨', 'done'), step(wn ? `대기 ${wn}번` : '대기', 'cur')].join(sep);
    } else {
      const order = ['received', 'selected', 'confirmed'];
      const labels = { received: '접수됨', selected: '선정', confirmed: '확정' };
      const cur = order.indexOf(info.s);
      steps = order.map((k, i) => step(labels[k], i < cur ? 'done' : (i === cur ? 'cur' : 'todo'))).join(sep);
    }
    return `<div class="app-detail-body"><div class="tl">${steps}</div><div class="tl-msg">${esc(info.msg)}</div></div>`;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  let lastList = [];
  let lastPhone = '';
  let lastGuardianName = '';

  attachPhoneFormatter(document.getElementById('lookup_phone'));

  document.getElementById('lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('lookup_phone').value.trim();
    const gname = document.getElementById('lookup_guardian_name').value.trim();
    if (!isValidPhone(phone)) {
      alert('올바른 보호자 연락처를 입력해 주세요(010-XXXX-XXXX).');
      return;
    }
    if (!gname) { alert('보호자 이름을 입력해 주세요.'); return; }
    lastPhone = phone;
    lastGuardianName = gname;
    await loadLookup();
  });

  async function loadLookup() {
    try {
      const res = await fetch('/api/public/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardian_phone: lastPhone, guardian_name: lastGuardianName }),
      });
      const j = await res.json();
      if (!j.ok) { alert(j.error || '조회 실패'); return; }
      lastList = j.data || [];
      // 추가 신청 시 보호자 정보 자동 채움용으로 보존
      try {
        sessionStorage.setItem('saessak_guardian', JSON.stringify({ phone: lastPhone, name: lastGuardianName }));
      } catch {}
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
        const sched = (window.SaessakSchedule && window.SaessakSchedule.format(program)) || program.schedule || '';
        return `
          <div class="app-item ${isCancelled ? 'cancelled' : ''}">
            <div class="app-main app-toggle" data-detail="${r.id}" role="button" tabindex="0" aria-expanded="false">
              <div class="app-title">${esc(program.title || '(프로그램)')} ${statusBadgeHtml(r)} <span class="app-caret">▾</span></div>
              <div class="app-meta">
                ${sched ? `📅 ${esc(sched)}` : ''}
                ${program.location ? ` · 📍 ${esc(program.location)}` : ''}
                <br>접수시각: ${fmtTime(r.submitted_at)}
              </div>
              <div class="app-detail" id="detail-${r.id}" hidden>${timelineHtml(r)}</div>
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
      <div class="more-apply-cta">
        <div class="more-apply-text">다른 프로그램도 같은 보호자 연락처로 추가 신청할 수 있어요.</div>
        <a class="btn primary more-apply-btn" href="/">+ 프로그램 더 신청하기</a>
      </div>
      <div class="notice" style="margin-top:14px;">
        <strong>안내</strong>
        <ul>
          <li>각 신청을 <b>탭하면</b> 진행 단계(접수됨 → 선정 → 확정)와 안내를 볼 수 있어요.</li>
          <li><b>접수됨·대기는 확정이 아니에요.</b> 최종 결과는 담당 선생님이 개별 안내드립니다.</li>
          <li>취소·수정은 <b>조회에 사용한 보호자 연락처와 이름</b>으로 본인 확인됩니다.</li>
        </ul>
      </div>
    `;

    el.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => onCancelClick(b.dataset.cancel)));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => onEditClick(b.dataset.edit)));
    // 행 탭 → 상세 타임라인 펼치기/접기
    el.querySelectorAll('[data-detail]').forEach(row => {
      const toggle = () => {
        const box = document.getElementById('detail-' + row.dataset.detail);
        if (!box) return;
        const open = box.hidden;
        box.hidden = !open;
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('open', open);
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  // 본인 확인 키: 조회에 사용한 보호자 연락처 + 보호자 이름. 둘 다 신청 행과 일치해야 통과.
  function ownerKeyFor(_row) {
    return { guardian_phone: lastPhone, guardian_name: lastGuardianName };
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
      // 보호자 연락처/이름이 바뀌었으면 다음 조회 기준도 새 값으로 갱신
      const newPhone = patch.guardian_phone;
      if (newPhone && newPhone !== lastPhone) lastPhone = newPhone;
      const newGuardianName = (patch.guardian_name || '').trim();
      if (newGuardianName && newGuardianName !== lastGuardianName) lastGuardianName = newGuardianName;
      try {
        sessionStorage.setItem('saessak_guardian', JSON.stringify({ phone: lastPhone, name: lastGuardianName }));
      } catch {}
      await loadLookup();
    } catch (err) { alert('서버 오류: ' + err.message); }
  });

  // 모달 외부 클릭 시 닫기
  document.querySelectorAll('.dialog-mask').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
  });
})();
