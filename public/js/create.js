(() => {
  // /create/<token> 에서 토큰 추출
  const parts = location.pathname.split('/').filter(Boolean); // ['create','<token>']
  const token = decodeURIComponent(parts[1] || '');
  const API = '/api/create/' + encodeURIComponent(token);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function setView(which) {
    ['state-loading', 'state-blocked', 'state-auth'].forEach(id => { const el = $('#' + id); if (el) el.hidden = id !== which; });
    $('#state-main').hidden = which !== 'main';
  }
  function blocked(msg, icon) {
    $('#blocked-msg').innerHTML = `<span class="big">${icon || '🔒'}</span>${esc(msg)}`;
    setView('state-blocked');
  }

  let creatorPass = null;
  let myPrograms = [];
  let editingId = null;

  // ===== 학년/유형 =====
  function setGradeChecks(form, grades) {
    const set = new Set(Array.isArray(grades) ? grades.map(Number) : []);
    form.querySelectorAll('.grade-check').forEach(c => { c.checked = set.has(Number(c.value)); });
  }
  function readGradeChecks(form) { return $$('.grade-check', form).filter(c => c.checked).map(c => Number(c.value)); }
  function typesOf(p) {
    const m = (typeof p.is_type_multicultural === 'boolean') ? p.is_type_multicultural : (p.program_type === 'multicultural');
    const s = (typeof p.is_type_sibling === 'boolean') ? p.is_type_sibling : (p.program_type === 'sibling');
    return { multicultural: m, sibling: s };
  }
  function customTypeOf(p) { const v = p && p.type_custom; return (v && String(v).trim() !== '') ? String(v).trim() : null; }
  function updateMulticulturalMinVisibility() {
    const show = $('#type-multicultural').checked;
    $('#multi-min-label').hidden = !show; $('#multi-min-row').hidden = !show;
  }
  function updateTypeCustomVisibility() {
    const show = $('#type-custom').checked;
    $('#type-custom-label').hidden = !show; $('#type-custom-row').hidden = !show;
    if (!show) $('#type-custom-input').value = '';
  }

  // ===== 일정 빌더 (admin/edit 와 동일 규칙) =====
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function fromISO(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; }
  const SB_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function buildDayChip(iso, checked) {
    const d = fromISO(iso); if (!d) return '';
    const label = `${d.getMonth() + 1}/${d.getDate()}(${SB_WEEK[d.getDay()]})`;
    return `<label class="sb-day ${checked ? 'on' : ''}" data-iso="${iso}"><input type="checkbox" class="sb-day-cb" value="${iso}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  }
  function renderDays(items) {
    const wrap = $('#sb-days');
    wrap.innerHTML = items.map(it => buildDayChip(it.iso, it.checked)).join('');
    wrap.querySelectorAll('.sb-day-cb').forEach(cb => cb.addEventListener('change', () => { cb.closest('.sb-day').classList.toggle('on', cb.checked); updateSchedulePreview(); }));
    updateSchedulePreview();
  }
  function readSelectedDates() { return $$('#sb-days .sb-day-cb').filter(cb => cb.checked).map(cb => cb.value).sort(); }
  function autoExpandRange() {
    const s = fromISO($('#sb-start-date').value), e = fromISO($('#sb-end-date').value);
    if (!s || !e) { renderDays([]); return; }
    if (s.getTime() > e.getTime()) { toast('종료일이 시작일보다 빠릅니다.'); renderDays([]); return; }
    const items = [];
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) items.push({ iso: toISO(d), checked: true });
    renderDays(items);
  }
  function updateSchedulePreview() {
    const text = window.SaessakSchedule.format({ session_dates: readSelectedDates(), start_time: $('#sb-start-time').value || null, end_time: $('#sb-end-time').value || null, extra_sessions: readExtraSessions() });
    $('#sb-preview').textContent = text ? `미리보기: ${text}` : '미리보기: (날짜를 선택하면 표시됩니다)';
  }
  function buildExtraRow(data) {
    const d = (data && data.date) || '', s = (data && data.start) || '', e = (data && data.end) || '';
    const row = document.createElement('div');
    row.className = 'sb-extra-row';
    row.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:4px; flex-wrap:wrap;';
    row.innerHTML = `<input type="date" class="x-date" value="${d}"><input type="time" class="x-start" value="${s}"><span>~</span><input type="time" class="x-end" value="${e}"><button type="button" class="btn small danger x-del">삭제</button>`;
    row.querySelector('.x-del').addEventListener('click', () => { row.remove(); updateSchedulePreview(); });
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', updateSchedulePreview));
    return row;
  }
  function addExtraRow(data) { $('#sb-extra-list').appendChild(buildExtraRow(data)); }
  function readExtraSessions() {
    return $$('#sb-extra-list .sb-extra-row').map(r => ({ date: r.querySelector('.x-date').value, start: r.querySelector('.x-start').value, end: r.querySelector('.x-end').value })).filter(x => x.date && x.start && x.end);
  }
  function loadExtraSessions(arr) { $('#sb-extra-list').innerHTML = ''; (Array.isArray(arr) ? arr : []).forEach(x => addExtraRow(x)); }
  $('#sb-extra-add').addEventListener('click', () => addExtraRow());
  function loadScheduleBuilderFrom(p) {
    const sd = (p && Array.isArray(p.session_dates)) ? p.session_dates.slice() : [];
    $('#sb-start-time').value = (p && p.start_time) || '';
    $('#sb-end-time').value = (p && p.end_time) || '';
    loadExtraSessions(p && p.extra_sessions);
    if (sd.length === 0) { $('#sb-start-date').value = ''; $('#sb-end-date').value = ''; $('#sb-days').innerHTML = ''; updateSchedulePreview(); return; }
    const sorted = sd.slice().sort(); const first = sorted[0], last = sorted[sorted.length - 1];
    $('#sb-start-date').value = first; $('#sb-end-date').value = last;
    const set = new Set(sorted); const items = []; const s = fromISO(first), e = fromISO(last);
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) { const iso = toISO(d); items.push({ iso, checked: set.has(iso) }); }
    renderDays(items);
  }
  document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (e.target.id === 'sb-start-date' || e.target.id === 'sb-end-date') autoExpandRange();
    else if (e.target.id === 'sb-start-time' || e.target.id === 'sb-end-time') updateSchedulePreview();
  });
  $('#type-multicultural').addEventListener('change', updateMulticulturalMinVisibility);
  $('#type-custom').addEventListener('change', updateTypeCustomVisibility);

  // ===== 폼 채우기 / 읽기 =====
  function resetForm() {
    const form = $('#program-form');
    form.reset();
    setGradeChecks(form, []);
    $('#type-multicultural').checked = false; $('#type-sibling').checked = false; $('#type-custom').checked = false;
    loadScheduleBuilderFrom(null);
    updateMulticulturalMinVisibility(); updateTypeCustomVisibility();
  }
  function fillForm(p) {
    const form = $('#program-form');
    form.title.value = p.title || '';
    form.description.value = p.description || '';
    form.location.value = p.location || '';
    setGradeChecks(form, p.grades);
    form.capacity.value = p.capacity ?? 20;
    form.waitlist_capacity.value = p.waitlist_capacity ?? 10;
    form.instructors.value = p.instructors || '';
    form.organization.value = p.organization || '';
    const t = typesOf(p);
    $('#type-multicultural').checked = !!t.multicultural;
    $('#type-sibling').checked = !!t.sibling;
    const custom = customTypeOf(p);
    $('#type-custom').checked = !!custom;
    $('#type-custom-input').value = custom || '';
    form.multicultural_min.value = p.multicultural_min ?? '';
    loadScheduleBuilderFrom(p);
    updateMulticulturalMinVisibility(); updateTypeCustomVisibility();
  }
  function gatherForm() {
    const form = $('#program-form');
    return {
      title: form.title.value.trim(),
      description: form.description.value.trim() || null,
      location: form.location.value.trim() || null,
      grades: readGradeChecks(form),
      capacity: Number(form.capacity.value) || 0,
      waitlist_capacity: form.waitlist_capacity.value === '' ? 10 : Math.max(0, Number(form.waitlist_capacity.value) || 0),
      instructors: form.instructors.value.trim() || null,
      organization: form.organization.value.trim() || null,
      is_type_multicultural: $('#type-multicultural').checked,
      is_type_sibling: $('#type-sibling').checked,
      type_custom: $('#type-custom').checked ? (form.type_custom.value.trim() || null) : null,
      multicultural_min: $('#type-multicultural').checked && form.multicultural_min.value !== '' ? Number(form.multicultural_min.value) : null,
      session_dates: readSelectedDates(),
      start_time: $('#sb-start-time').value || null,
      end_time: $('#sb-end-time').value || null,
      extra_sessions: readExtraSessions(),
    };
  }

  // ===== 목록 =====
  function renderList() {
    const ul = $('#my-programs');
    if (!myPrograms.length) { ul.innerHTML = ''; $('#my-programs-empty').hidden = false; return; }
    $('#my-programs-empty').hidden = true;
    ul.innerHTML = myPrograms.map(p => {
      const sched = (window.SaessakSchedule && window.SaessakSchedule.format(p)) || '';
      const hiddenBadge = (p.recruit_status === 'hidden') ? '<span class="hidden-badge">숨김</span>' : `<span class="hidden-badge" style="background:#DCFCE7;color:#166534;">${esc(p.recruit_status || '')}</span>`;
      return `<li>
        <div>
          <b>${esc(p.title)}</b> ${hiddenBadge}
          <div class="p-meta">${esc(sched || '일정 미정')}${p.location ? ' · ' + esc(p.location) : ''}</div>
        </div>
        <div class="row" style="gap:4px; flex-wrap:wrap;">
          <button type="button" class="btn small" data-roster="${esc(p.id)}">👥 신청자</button>
          <button type="button" class="btn small" data-inq="${esc(p.id)}">💬 문의 <span class="hidden-badge inq-badge" data-inq-badge="${esc(p.id)}" style="background:var(--danger);color:#fff;" hidden></span></button>
          <button type="button" class="btn small" data-output="${esc(p.id)}">📦 산출물</button>
          <button type="button" class="btn small" data-edit="${esc(p.id)}">수정</button>
        </div>
      </li>`;
    }).join('');
    ul.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.getAttribute('data-edit'))));
    ul.querySelectorAll('[data-roster]').forEach(b => b.addEventListener('click', () => openRoster(b.getAttribute('data-roster'))));
    ul.querySelectorAll('[data-inq]').forEach(b => b.addEventListener('click', () => openInq(b.getAttribute('data-inq'))));
    ul.querySelectorAll('[data-output]').forEach(b => b.addEventListener('click', () => openOutput(b.getAttribute('data-output'))));
  }

  // ===== 산출물 입력 =====
  let outputPid = null;
  function openOutput(pid) {
    if (!creatorPass) { toast('먼저 비밀번호를 확인하세요.'); return; }
    const p = myPrograms.find(x => String(x.id) === String(pid));
    outputPid = pid;
    $('#out-title').textContent = `📦 산출물 — ${p ? p.title : ''}`;
    $('#out-summary').value = (p && p.output && p.output.summary) || '';
    $('#out-url').value = (p && p.output && p.output.output_url) || '';
    $('#output-modal').hidden = false;
  }
  $('#out-close').addEventListener('click', () => { $('#output-modal').hidden = true; });
  $('#output-modal').addEventListener('click', (e) => { if (e.target.id === 'output-modal') $('#output-modal').hidden = true; });
  $('#out-save').addEventListener('click', async () => {
    if (!outputPid || !creatorPass) return;
    try {
      const res = await fetch(`${API}/programs/${encodeURIComponent(outputPid)}/program-outputs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: creatorPass, summary: $('#out-summary').value, output_url: $('#out-url').value }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      toast('산출물을 저장했습니다 (공개 /outputs 에 노출)');
      $('#output-modal').hidden = true;
      await refreshList();
    } catch (err) { toast('서버 오류로 저장하지 못했습니다.'); }
  });

  function showForm(isEdit) {
    $('#form-title').textContent = isEdit ? '프로그램 수정' : '새 프로그램 개설';
    $('#form-save').textContent = isEdit ? '저장' : '개설하기';
    $('#program-form-card').hidden = false;
    $('#program-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hideForm() { $('#program-form-card').hidden = true; editingId = null; }

  $('#new-program-btn').addEventListener('click', () => { editingId = null; resetForm(); showForm(false); });
  $('#form-cancel').addEventListener('click', hideForm);
  function startEdit(id) {
    const p = myPrograms.find(x => String(x.id) === String(id));
    if (!p) return;
    editingId = String(id);
    fillForm(p);
    showForm(true);
  }

  // ===== 통신 =====
  async function fetchList() {
    const res = await fetch(API + '/programs/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
    const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
    return { res, j };
  }

  async function authAndLoad() {
    const pw = $('#creator-pass').value;
    if (!pw) { $('#auth-msg').textContent = '비밀번호를 입력하세요.'; return; }
    $('#auth-msg').textContent = '확인 중…';
    creatorPass = pw;
    try {
      const { res, j } = await fetchList();
      if (!j.ok) {
        creatorPass = null;
        if (res.status === 503) $('#auth-msg').textContent = j.error || '개설 기능이 설정되지 않았습니다.';
        else if (res.status === 403) blocked(j.error || '비활성화된 링크입니다.', '🔒');
        else $('#auth-msg').textContent = j.error || '확인 실패';
        return;
      }
      myPrograms = j.data || [];
      if (j.label) $('#creator-sub').textContent = `${j.label} 님 — 프로그램을 개설하고 본인 프로그램만 관리합니다.`;
      renderList();
      setView('main');
      loadInqBadges(); // 각 프로그램 미답변 문의 배지(비동기)
    } catch (err) { creatorPass = null; $('#auth-msg').textContent = '서버에 연결하지 못했습니다.'; }
  }
  $('#auth-btn').addEventListener('click', authAndLoad);
  $('#creator-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); authAndLoad(); } });

  async function refreshList() { const { j } = await fetchList(); if (j.ok) { myPrograms = j.data || []; renderList(); loadInqBadges(); } }

  $('#program-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!creatorPass) { toast('먼저 비밀번호를 확인하세요.'); return; }
    const body = gatherForm();
    if (!body.title) { toast('프로그램명을 입력하세요.'); return; }
    if (!body.grades.length) { toast('대상 학년을 1개 이상 선택하세요.'); return; }
    const save = $('#form-save'); save.disabled = true;
    try {
      let res, j;
      if (editingId) {
        res = await fetch(API + '/programs/' + encodeURIComponent(editingId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass, ...body }) });
      } else {
        res = await fetch(API + '/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass, ...body }) });
      }
      j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      toast(editingId ? '수정되었습니다' : '개설되었습니다 (숨김 상태 — 관리자 검토 후 공개)');
      hideForm();
      await refreshList();
    } catch (err) { toast('서버 오류로 저장하지 못했습니다.'); }
    finally { save.disabled = false; }
  });

  // ===== 신청자 명단 관리 (본인 프로그램) =====
  const CLASS_COUNT = { 1: 6, 2: 6, 3: 7, 4: 8, 5: 7, 6: 7 };
  let rosterPid = null;        // 현재 명단 보고 있는 program_id
  let rosterRows = [];
  let editingAppId = null;     // 수동 신청 수정 중
  let notesByKey = {};
  let noteTarget = null;

  function rApi(path) { return `${API}/programs/${encodeURIComponent(rosterPid)}${path}`; }
  function statusBadge(r) {
    if (r.status === 'cancelled') return '<span class="badge-wait" style="opacity:.7;">취소</span>';
    return r.is_waitlist ? '<span class="badge-wait">대기</span>' : '<span class="badge-ok">접수</span>';
  }
  function sourceLabel(s) { return s === 'manual' ? '수동' : '온라인'; }
  const APP_STATUS_OPTS = [{ v: 'applied', t: '신청' }, { v: 'selected', t: '선정' }, { v: 'waiting', t: '대기' }, { v: 'cancelled', t: '취소' }];
  function selectCell(r) {
    const cur = r.status || 'applied';
    return `<select class="x-status" data-status-id="${esc(r.id)}" style="font-size:12px; padding:2px 4px;">${APP_STATUS_OPTS.map(o => `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${o.t}</option>`).join('')}</select>`;
  }
  function manageCell(r) {
    const noteBtn = `<button type="button" class="btn small" data-note="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">📝 기록</button>`;
    if (r.source === 'manual') {
      return `<button type="button" class="btn small" data-app-edit="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">수정</button>
              <button type="button" class="btn small danger" data-app-del="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">삭제</button> ${noteBtn}`;
    }
    return `<span class="muted" style="font-size:11.5px;">온라인</span> ${noteBtn}`;
  }
  // 참고기록 매칭(이름+학년+반, 양쪽 연락처 있으면 일치)
  function noteKey(n, g, c) { return `${String(n || '').trim()}|${g ?? ''}|${c ?? ''}`; }
  function matchedNotes(name, grade, classNo, contact) {
    const bucket = notesByKey[noteKey(name, grade, classNo)] || [];
    return bucket.filter(x => { const nc = x.guardian_contact; return !(nc && contact) || nc === contact; });
  }

  function renderRoster(payload) {
    const tbody = $('#roster-tbody');
    const list = payload.data || [];
    rosterRows = list;
    tbody.innerHTML = list.map(r => {
      const nCount = matchedNotes(r.student_name, r.grade, r.class_no, r.guardian_phone).length;
      const flag = nCount ? ` <button type="button" class="note-flag" data-note="${esc(r.id)}" title="참고기록 ${nCount}건">⚠️ ${nCount}</button>` : '';
      return `<tr${r.status === 'cancelled' ? ' style="opacity:.6;"' : ''}>
        <td>${r.status === 'cancelled' ? '—' : r.seq}</td>
        <td>${statusBadge(r)}</td>
        <td>${esc(r.student_name)}${flag}</td>
        <td>${esc(r.grade ?? '')}학년 ${esc(r.class_no ?? '')}반</td>
        <td>${esc(r.guardian_name || '')}</td>
        <td>${esc(r.guardian_phone || '')}</td>
        <td>${esc(sourceLabel(r.source))}</td>
        <td>${selectCell(r)}</td>
        <td>${manageCell(r)}</td>
      </tr>`;
    }).join('');
    const has = list.length > 0;
    $('#roster-table').hidden = !has;
    const pr = payload.program || {};
    const hidden = (pr.recruit_status === 'hidden');
    $('#roster-empty').hidden = has;
    $('#roster-empty').textContent = hidden ? '공개 전(숨김)이라 아직 신청자가 없습니다. 관리자가 공개하면 신청이 들어옵니다.' : '아직 신청자가 없습니다.';
    $('#roster-summary').textContent = `접수 ${payload.accepted_count}/${pr.capacity ?? '-'} · 대기 ${payload.waitlist_count}/${pr.waitlist_capacity ?? '-'}`;
    $('#roster-title').textContent = `신청자 명단 — ${pr.title || ''}`;
  }

  async function fetchRoster() {
    const res = await fetch(rApi('/roster'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
    return res.json().catch(() => ({ ok: false, error: '응답 오류' }));
  }
  async function fetchNotes() {
    try {
      const res = await fetch(rApi('/student-notes/list'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
      const j = await res.json().catch(() => ({ ok: false }));
      const map = {};
      if (j.ok) (j.data || []).forEach(n => { const k = noteKey(n.student_name, n.grade, n.class_no); (map[k] = map[k] || []).push(n); });
      notesByKey = map;
    } catch { notesByKey = {}; }
  }
  async function refreshRoster() { const j = await fetchRoster(); if (j.ok) { await fetchNotes(); renderRoster(j); } }

  async function openRoster(pid) {
    if (!creatorPass) { toast('먼저 비밀번호를 확인하세요.'); return; }
    rosterPid = pid; editingAppId = null; resetMForm();
    const j = await fetchRoster();
    if (!j.ok) { toast(j.error || '명단을 불러오지 못했습니다.'); return; }
    await fetchNotes();
    renderRoster(j);
    $('#roster-modal').hidden = false;
  }
  $('#roster-close').addEventListener('click', () => { $('#roster-modal').hidden = true; });
  $('#roster-modal').addEventListener('click', (e) => { if (e.target.id === 'roster-modal') $('#roster-modal').hidden = true; });

  // 수동 신청 입력 폼
  function populateMClassOptions(grade, cur) {
    const sel = $('#m-class'); const count = CLASS_COUNT[Number(grade)] || 0;
    if (!count) { sel.innerHTML = '<option value="">학년 먼저 선택</option>'; sel.disabled = true; return; }
    sel.innerHTML = '<option value="">반 선택</option>' + Array.from({ length: count }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('');
    sel.disabled = false; if (cur) sel.value = String(cur);
  }
  $('#m-grade').addEventListener('change', function () { populateMClassOptions(this.value); });
  function resetMForm() {
    editingAppId = null;
    $('#m-name').value = ''; $('#m-grade').value = ''; populateMClassOptions(''); $('#m-guardian').value = ''; $('#m-phone').value = '';
    $('#m-form-title').textContent = '＋ 수동 신청 입력 (종이 신청서)';
    $('#m-add-btn').textContent = '신청자 추가'; $('#m-cancel-btn').hidden = true;
  }
  $('#m-cancel-btn').addEventListener('click', resetMForm);
  $('#m-add-btn').addEventListener('click', async () => {
    if (!creatorPass || !rosterPid) return;
    const name = $('#m-name').value.trim(), grade = $('#m-grade').value, classNo = $('#m-class').value;
    if (!name) { toast('학생 이름을 입력하세요.'); return; }
    if (!grade) { toast('학년을 선택하세요.'); return; }
    if (!classNo) { toast('반을 선택하세요.'); return; }
    const fields = { password: creatorPass, student_name: name, grade: Number(grade), class_no: Number(classNo), guardian_name: $('#m-guardian').value.trim() || null, guardian_phone: $('#m-phone').value.trim() || null };
    try {
      let res;
      if (editingAppId) res = await fetch(rApi('/applications/' + encodeURIComponent(editingAppId)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      else res = await fetch(rApi('/applications'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '처리 실패'); return; }
      toast(editingAppId ? '수정되었습니다' : (j.is_waitlist ? `대기 ${j.slot_number}번으로 추가` : `접수 ${j.slot_number}번으로 추가`));
      resetMForm(); await refreshRoster();
    } catch (err) { toast('서버 오류로 처리하지 못했습니다.'); }
  });

  // 명단 테이블 이벤트 위임(상태 변경 / 수정·삭제 / 참고기록)
  $('#roster-tbody').addEventListener('change', async (e) => {
    const sel = e.target.closest('.x-status'); if (!sel) return;
    try {
      const res = await fetch(rApi('/applications/' + encodeURIComponent(sel.getAttribute('data-status-id')) + '/status'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass, status: sel.value }) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '상태 변경 실패'); return; }
      toast('상태가 변경되었습니다'); await refreshRoster();
    } catch (err) { toast('서버 오류로 변경하지 못했습니다.'); }
  });
  $('#roster-tbody').addEventListener('click', async (e) => {
    const noteBtn = e.target.closest('[data-note]');
    if (noteBtn) { const r = rosterRows.find(x => String(x.id) === noteBtn.getAttribute('data-note')); if (r) openNoteModal(r); return; }
    const editBtn = e.target.closest('[data-app-edit]');
    if (editBtn) { const r = rosterRows.find(x => String(x.id) === editBtn.getAttribute('data-app-edit')); if (r) startAppEdit(r); return; }
    const delBtn = e.target.closest('[data-app-del]');
    if (delBtn) {
      if (!confirm('이 수동 신청을 삭제할까요? 복구할 수 없습니다.')) return;
      try {
        const res = await fetch(rApi('/applications/' + encodeURIComponent(delBtn.getAttribute('data-app-del'))), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
        const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!j.ok) { toast(j.error || '삭제 실패'); return; }
        toast('삭제되었습니다'); resetMForm(); await refreshRoster();
      } catch (err) { toast('서버 오류로 삭제하지 못했습니다.'); }
    }
  });
  function startAppEdit(r) {
    editingAppId = String(r.id);
    $('#m-name').value = r.student_name || ''; $('#m-grade').value = r.grade ? String(r.grade) : '';
    populateMClassOptions(r.grade, r.class_no); $('#m-guardian').value = r.guardian_name || ''; $('#m-phone').value = r.guardian_phone || '';
    $('#m-form-title').textContent = '✏️ 수동 신청 수정'; $('#m-add-btn').textContent = '수정 저장'; $('#m-cancel-btn').hidden = false;
    $('#m-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 엑셀 다운로드
  $('#roster-xlsx-btn').addEventListener('click', async () => {
    if (!creatorPass || !rosterPid) return;
    const btn = $('#roster-xlsx-btn'); btn.disabled = true;
    try {
      const res = await fetch(rApi('/roster.xlsx'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
      if (!res.ok) { toast('엑셀 다운로드 실패'); return; }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      let fname = '신청자명단.xlsx'; const m = /filename\*=UTF-8''([^;]+)/.exec(cd); if (m) { try { fname = decodeURIComponent(m[1]); } catch {} }
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) { toast('서버 오류로 다운로드하지 못했습니다.'); } finally { btn.disabled = false; }
  });

  // 참고기록 모달
  const NOTE_TYPE_LABELS = { noshow: '🚫 노쇼', attitude: '😠 태도', etc: '📝 기타' };
  function fmtNoteDate(iso) { if (!iso) return ''; const d = new Date(iso); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; }
  function renderNoteHistory(notes) {
    const list = (notes || []).slice().reverse();
    if (!list.length) return '<p class="muted" style="margin:8px 0;">아직 기록이 없습니다.</p>';
    return list.map(n => `<div class="note-item"><div class="note-item-head"><span class="note-type-tag">${NOTE_TYPE_LABELS[n.note_type] || NOTE_TYPE_LABELS.etc}</span><span class="muted">${esc(fmtNoteDate(n.created_at))} · ${esc(n.created_by || '?')}</span></div>${n.content ? `<div class="note-item-body">${esc(n.content)}</div>` : ''}</div>`).join('');
  }
  function openNoteModal(r) {
    noteTarget = { student_name: r.student_name, grade: r.grade ?? null, class_no: r.class_no ?? null, guardian_contact: r.guardian_phone || null };
    $('#note-target-info').innerHTML = `<b>${esc(r.student_name)}</b> (${esc(r.grade ?? '?')}-${esc(r.class_no ?? '?')})`;
    $('#note-history').innerHTML = renderNoteHistory(matchedNotes(r.student_name, r.grade, r.class_no, r.guardian_phone));
    $('#note-type').value = 'noshow'; $('#note-content').value = '';
    $('#note-modal').hidden = false;
  }
  $('#note-cancel').addEventListener('click', () => { $('#note-modal').hidden = true; noteTarget = null; });
  $('#note-modal').addEventListener('click', (e) => { if (e.target.id === 'note-modal') { $('#note-modal').hidden = true; noteTarget = null; } });
  $('#note-save').addEventListener('click', async () => {
    if (!noteTarget || !creatorPass || !rosterPid) return;
    try {
      const res = await fetch(rApi('/student-notes'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass, ...noteTarget, note_type: $('#note-type').value, content: $('#note-content').value.trim() }) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      toast('참고기록을 저장했습니다');
      await fetchNotes(); const rj = await fetchRoster(); if (rj.ok) renderRoster(rj);
      $('#note-history').innerHTML = renderNoteHistory(matchedNotes(noteTarget.student_name, noteTarget.grade, noteTarget.class_no, noteTarget.guardian_contact));
      $('#note-content').value = '';
    } catch (err) { toast('서버 오류로 저장하지 못했습니다.'); }
  });

  // ===== 문의사항 모달 =====
  let inqPid = null, inquiries = [], inqFilter = 'all';
  async function fetchInq(pid) {
    const res = await fetch(`${API}/programs/${encodeURIComponent(pid)}/inquiries/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass }) });
    const j = await res.json().catch(() => ({ ok: false }));
    return j.ok ? (j.data || []) : null;
  }
  function updateInqBadge(pid, list) {
    const pending = (list || []).filter(x => !x.answered).length;
    const b = document.querySelector(`[data-inq-badge="${pid}"]`);
    if (b) { if (pending > 0) { b.textContent = pending; b.hidden = false; } else { b.hidden = true; } }
  }
  function renderInqList() {
    $$('[data-inq-f]').forEach(b => b.classList.toggle('active', b.getAttribute('data-inq-f') === inqFilter));
    let list = inquiries.slice();
    if (inqFilter === 'pending') list = list.filter(x => !x.answered);
    else if (inqFilter === 'answered') list = list.filter(x => x.answered);
    const pending = inquiries.filter(x => !x.answered).length;
    $('#inq-modal-count').textContent = `· 전체 ${inquiries.length} · 대기 ${pending}`;
    const wrap = $('#inq-list');
    if (!list.length) { wrap.innerHTML = `<div class="muted" style="padding:16px; text-align:center;">표시할 문의사항이 없습니다.</div>`; return; }
    wrap.innerHTML = list.map(x => `<div class="inq-item">
      <div class="inq-item-head"><span><b>${esc(x.student_name)}</b> · ${esc(x.grade ?? '?')}-${esc(x.class_no ?? '?')} · ${esc(x.guardian_phone || '')}</span><span>${esc(fmtNoteDate(x.submitted_at))}</span></div>
      <div class="inq-item-msg">${esc(x.motivation)}</div>
      <div class="inq-item-foot">${x.answered ? `<span class="inq-st-done">✅ 답변함${x.answered_at ? ' · ' + esc(fmtNoteDate(x.answered_at)) : ''}</span>` : '<span class="inq-st-wait">⏳ 대기</span>'}
        <button type="button" class="btn small" data-inq-toggle="${esc(x.id)}" data-answered="${x.answered ? '1' : '0'}" style="padding:3px 10px; font-size:12px;">${x.answered ? '대기로' : '답변함'}</button></div>
    </div>`).join('');
  }
  async function openInq(pid) {
    if (!creatorPass) { toast('먼저 비밀번호를 확인하세요.'); return; }
    inqPid = pid;
    const list = await fetchInq(pid);
    if (list === null) { toast('문의를 불러오지 못했습니다.'); return; }
    inquiries = list; inqFilter = 'all'; updateInqBadge(pid, list);
    renderInqList();
    $('#inq-modal').hidden = false;
  }
  $('#inq-close').addEventListener('click', () => { $('#inq-modal').hidden = true; });
  $('#inq-modal').addEventListener('click', (e) => { if (e.target.id === 'inq-modal') $('#inq-modal').hidden = true; });
  $$('[data-inq-f]').forEach(b => b.addEventListener('click', () => { inqFilter = b.getAttribute('data-inq-f'); renderInqList(); }));
  $('#inq-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-inq-toggle]'); if (!btn || !inqPid) return;
    const next = btn.getAttribute('data-answered') !== '1'; btn.disabled = true;
    try {
      const res = await fetch(`${API}/programs/${encodeURIComponent(inqPid)}/inquiries/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: creatorPass, application_id: btn.getAttribute('data-inq-toggle'), answered: next }) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '처리 실패'); btn.disabled = false; return; }
      toast(next ? '답변함으로 표시했습니다' : '대기로 되돌렸습니다');
      const list = await fetchInq(inqPid); if (list) { inquiries = list; updateInqBadge(inqPid, list); renderInqList(); }
    } catch (err) { toast('서버 오류로 처리하지 못했습니다.'); btn.disabled = false; }
  });

  // 인증 후 각 프로그램의 미답변 문의 배지 채우기(비동기)
  async function loadInqBadges() {
    for (const p of myPrograms) {
      try { const list = await fetchInq(p.id); if (list) updateInqBadge(p.id, list); } catch {}
    }
  }

  // ===== 부트스트랩 =====
  (async () => {
    if (!token || token.length < 16) { blocked('유효하지 않은 링크입니다.', '⚠️'); return; }
    try {
      const res = await fetch(API, { method: 'GET' }); // GET /api/create/:token (비번 없이 토큰 유효/활성 확인)
      const j = await res.json().catch(() => ({ ok: false }));
      if (!j.ok) {
        if (res.status === 403) blocked(j.error || '현재 비활성화된 링크입니다.', '🔒');
        else if (res.status === 503) blocked(j.error || '개설 기능이 아직 설정되지 않았습니다.', '🛠️');
        else blocked(j.error || '유효하지 않은 링크입니다.', '⚠️');
        return;
      }
      if (j.label) $('#creator-sub').textContent = `${j.label} 님 — 비밀번호 확인 후 개설할 수 있습니다.`;
      setView('state-auth');
      $('#creator-pass').focus();
    } catch (err) { blocked('서버에 연결하지 못했습니다.', '⚠️'); }
  })();
})();
