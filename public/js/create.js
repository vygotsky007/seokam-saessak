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
      return `<li>
        <div>
          <b>${esc(p.title)}</b> <span class="hidden-badge">숨김</span>
          <div class="p-meta">${esc(sched || '일정 미정')}${p.location ? ' · ' + esc(p.location) : ''}</div>
        </div>
        <button type="button" class="btn small" data-edit="${esc(p.id)}">수정</button>
      </li>`;
    }).join('');
    ul.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.getAttribute('data-edit'))));
  }

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
    } catch (err) { creatorPass = null; $('#auth-msg').textContent = '서버에 연결하지 못했습니다.'; }
  }
  $('#auth-btn').addEventListener('click', authAndLoad);
  $('#creator-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); authAndLoad(); } });

  async function refreshList() { const { j } = await fetchList(); if (j.ok) { myPrograms = j.data || []; renderList(); } }

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
