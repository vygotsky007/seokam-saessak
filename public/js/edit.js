(() => {
  // /edit/<token> 에서 토큰 추출
  const parts = location.pathname.split('/').filter(Boolean); // ['edit', '<token>']
  const token = decodeURIComponent(parts[1] || '');
  const API = '/api/edit/' + encodeURIComponent(token);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function showState(which) {
    $('#state-loading').hidden = which !== 'loading';
    $('#state-blocked').hidden = which !== 'blocked';
    $('#state-form').hidden = which !== 'form';
    // 명단 카드는 폼이 보일 때만 의미가 있고, 토글로 별도 제어한다.
    if (which !== 'form') $('#state-roster').hidden = true;
  }
  function blocked(msg, icon) {
    $('#blocked-msg').innerHTML = `<span class="big">${icon || '🔒'}</span>${esc(msg)}`;
    showState('blocked');
  }

  // ===== 학년 체크 =====
  function setGradeChecks(form, grades) {
    const set = new Set(Array.isArray(grades) ? grades.map(Number) : []);
    form.querySelectorAll('.grade-check').forEach(c => { c.checked = set.has(Number(c.value)); });
  }
  function readGradeChecks(form) {
    return $$('.grade-check', form).filter(c => c.checked).map(c => Number(c.value));
  }

  // ===== 유형 =====
  function typesOf(p) {
    const m = (typeof p.is_type_multicultural === 'boolean') ? p.is_type_multicultural : (p.program_type === 'multicultural');
    const s = (typeof p.is_type_sibling === 'boolean')       ? p.is_type_sibling       : (p.program_type === 'sibling');
    return { multicultural: m, sibling: s };
  }
  function customTypeOf(p) {
    const v = p && p.type_custom;
    return (v && String(v).trim() !== '') ? String(v).trim() : null;
  }
  function updateMulticulturalMinVisibility() {
    const show = $('#type-multicultural').checked;
    $('#multi-min-label').hidden = !show;
    $('#multi-min-row').hidden = !show;
  }
  function updateTypeCustomVisibility() {
    const show = $('#type-custom').checked;
    $('#type-custom-label').hidden = !show;
    $('#type-custom-row').hidden = !show;
    if (!show) $('#type-custom-input').value = '';
  }

  // ===== 일정 빌더 (admin.js 와 동일 규칙) =====
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function fromISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));
    return m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : null;
  }
  const SB_WEEK = ['일','월','화','수','목','금','토'];

  function buildDayChip(iso, checked) {
    const d = fromISO(iso);
    if (!d) return '';
    const label = `${d.getMonth()+1}/${d.getDate()}(${SB_WEEK[d.getDay()]})`;
    return `<label class="sb-day ${checked ? 'on' : ''}" data-iso="${iso}">
      <input type="checkbox" class="sb-day-cb" value="${iso}" ${checked ? 'checked' : ''}>
      <span>${label}</span>
    </label>`;
  }
  function renderDays(items) {
    const wrap = $('#sb-days');
    wrap.innerHTML = items.map(it => buildDayChip(it.iso, it.checked)).join('');
    wrap.querySelectorAll('.sb-day-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.sb-day').classList.toggle('on', cb.checked);
        updateSchedulePreview();
      });
    });
    updateSchedulePreview();
  }
  function readSelectedDates() {
    return $$('#sb-days .sb-day-cb').filter(cb => cb.checked).map(cb => cb.value).sort();
  }
  function autoExpandRange() {
    const s = fromISO($('#sb-start-date').value);
    const e = fromISO($('#sb-end-date').value);
    if (!s || !e) { renderDays([]); return; }
    if (s.getTime() > e.getTime()) { toast('종료일이 시작일보다 빠릅니다.'); renderDays([]); return; }
    const items = [];
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
      items.push({ iso: toISO(d), checked: true });
    }
    renderDays(items);
  }
  function updateSchedulePreview() {
    const sessionDates = readSelectedDates();
    const st = $('#sb-start-time').value || null;
    const et = $('#sb-end-time').value || null;
    const text = window.SaessakSchedule.format({ session_dates: sessionDates, start_time: st, end_time: et, extra_sessions: readExtraSessions() });
    $('#sb-preview').textContent = text ? `미리보기: ${text}` : '미리보기: (날짜를 선택하면 표시됩니다)';
  }

  // ===== 보충 회차 빌더 (메인 일정과 별도 시간) =====
  function buildExtraRow(data) {
    const d = (data && data.date) || '';
    const s = (data && data.start) || '';
    const e = (data && data.end) || '';
    const row = document.createElement('div');
    row.className = 'sb-extra-row';
    row.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:4px; flex-wrap:wrap;';
    row.innerHTML =
      `<input type="date" class="x-date" value="${d}">` +
      `<input type="time" class="x-start" value="${s}">` +
      `<span>~</span>` +
      `<input type="time" class="x-end" value="${e}">` +
      `<button type="button" class="btn small danger x-del">삭제</button>`;
    row.querySelector('.x-del').addEventListener('click', () => { row.remove(); updateSchedulePreview(); });
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', updateSchedulePreview));
    return row;
  }
  function addExtraRow(data) { $('#sb-extra-list').appendChild(buildExtraRow(data)); }
  function readExtraSessions() {
    return $$('#sb-extra-list .sb-extra-row').map(r => ({
      date: r.querySelector('.x-date').value,
      start: r.querySelector('.x-start').value,
      end: r.querySelector('.x-end').value,
    })).filter(x => x.date && x.start && x.end);
  }
  function loadExtraSessions(arr) {
    $('#sb-extra-list').innerHTML = '';
    (Array.isArray(arr) ? arr : []).forEach(x => addExtraRow(x));
  }
  $('#sb-extra-add').addEventListener('click', () => addExtraRow());

  function loadScheduleBuilderFrom(p) {
    const sd = (p && Array.isArray(p.session_dates)) ? p.session_dates.slice() : [];
    $('#sb-start-time').value = (p && p.start_time) || '';
    $('#sb-end-time').value = (p && p.end_time) || '';
    loadExtraSessions(p && p.extra_sessions);
    if (sd.length === 0) {
      $('#sb-start-date').value = '';
      $('#sb-end-date').value = '';
      $('#sb-days').innerHTML = '';
      updateSchedulePreview();
      return;
    }
    const sorted = sd.slice().sort();
    const first = sorted[0], last = sorted[sorted.length - 1];
    $('#sb-start-date').value = first;
    $('#sb-end-date').value = last;
    const set = new Set(sorted);
    const items = [];
    const s = fromISO(first), e = fromISO(last);
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      items.push({ iso, checked: set.has(iso) });
    }
    renderDays(items);
  }

  document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (e.target.id === 'sb-start-date' || e.target.id === 'sb-end-date') autoExpandRange();
    else if (e.target.id === 'sb-start-time' || e.target.id === 'sb-end-time') updateSchedulePreview();
  });

  // ===== 폼 채우기 =====
  function fillForm(p) {
    const form = $('#program-form');
    form.title.value = p.title || '';
    form.description.value = p.description || '';
    form.location.value = p.location || '';
    setGradeChecks(form, p.grades);
    form.capacity.value = p.capacity ?? 20;
    form.waitlist_capacity.value = p.waitlist_capacity ?? 10;
    form.instructors.value = p.instructors || '';
    const t = typesOf(p);
    $('#type-multicultural').checked = !!t.multicultural;
    $('#type-sibling').checked = !!t.sibling;
    const custom = customTypeOf(p);
    $('#type-custom').checked = !!custom;
    $('#type-custom-input').value = custom || '';
    form.multicultural_min.value = p.multicultural_min ?? '';
    loadScheduleBuilderFrom(p);
    updateMulticulturalMinVisibility();
    updateTypeCustomVisibility();
  }

  // ===== 불러오기 =====
  async function load() {
    if (!token || token.length < 16) { blocked('유효하지 않은 링크입니다.', '⚠️'); return; }
    showState('loading');
    let j;
    try {
      const res = await fetch(API, { headers: { 'Content-Type': 'application/json' } });
      j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (res.status === 404) { blocked('유효하지 않은 링크입니다. 링크를 다시 확인해 주세요.', '⚠️'); return; }
      if (!j.ok) { blocked(j.error || '불러오지 못했습니다.', '⚠️'); return; }
    } catch (err) {
      blocked('서버에 연결하지 못했습니다.', '⚠️');
      return;
    }
    if (j.edit_enabled === false) {
      blocked('현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.', '🔒');
      return;
    }
    currentProgram = j.data || {};
    fillForm(j.data || {});
    // 산출물 프리필
    $('#output-summary').value = (j.output && j.output.summary) || '';
    $('#output-url').value = (j.output && j.output.output_url) || '';
    showState('form');
  }

  // 산출물 저장(프로그램 수정과 동일 게이트 — 강사 비번 불요)
  $('#output-save').addEventListener('click', async () => {
    try {
      const res = await fetch(API + '/program-outputs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: $('#output-summary').value, output_url: $('#output-url').value }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      toast('산출물을 저장했습니다 (공개 /outputs 에 노출)');
    } catch (err) { toast('서버 오류로 저장하지 못했습니다.'); }
  });

  // ===== 저장 =====
  $('#type-multicultural').addEventListener('change', updateMulticulturalMinVisibility);
  $('#type-custom').addEventListener('change', updateTypeCustomVisibility);

  $('#program-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const tMulti = $('#type-multicultural').checked;
    const tSib = $('#type-sibling').checked;
    const tCustom = $('#type-custom').checked;
    const customName = tCustom ? $('#type-custom-input').value.trim() : '';
    if (tCustom && !customName) { toast('기타 유형명을 입력하세요.'); return; }

    const grades = readGradeChecks(form);
    if (grades.length === 0) { toast('대상 학년을 1개 이상 선택하세요.'); return; }

    const sessionDates = readSelectedDates();
    const startTime = $('#sb-start-time').value || null;
    const endTime = $('#sb-end-time').value || null;
    if (sessionDates.length === 0 || !startTime || !endTime) { toast('일정(날짜·시간)을 입력해 주세요'); return; }

    const extraSessions = readExtraSessions();
    let autoSchedule = '';
    if (sessionDates.length > 0 || extraSessions.length > 0) {
      autoSchedule = window.SaessakSchedule.format({ session_dates: sessionDates, start_time: startTime, end_time: endTime, extra_sessions: extraSessions });
    }

    const payload = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      schedule: autoSchedule || null,
      location: form.location.value.trim(),
      grades,
      capacity: Number(form.capacity.value),
      waitlist_capacity: Math.max(0, Number(form.waitlist_capacity.value) || 0),
      instructors: form.instructors.value.trim(),
      is_type_multicultural: tMulti,
      is_type_sibling: tSib,
      type_custom: customName || null,
      multicultural_min: tMulti && form.multicultural_min.value !== '' ? Number(form.multicultural_min.value) : null,
      session_dates: sessionDates,
      start_time: startTime,
      end_time: endTime,
      extra_sessions: extraSessions,
    };

    try {
      const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (res.status === 403) { blocked(j.error || '현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.', '🔒'); return; }
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      if (j.data) { currentProgram = j.data; fillForm(j.data); }
      toast('저장되었습니다');
    } catch (err) {
      toast('서버 오류로 저장하지 못했습니다.');
    }
  });

  // 프로그램 삭제는 강사 페이지에서 제공하지 않는다(신청 데이터 손실 방지 — 관리자 전용).

  // ===== 신청자 명단 + 수동입력 =====
  // 인증된 강사 비번을 메모리에만 보관(요청마다 동봉). 새로고침하면 다시 입력.
  let instructorPass = null;
  // 비번 프롬프트를 띄운 의도('roster' | 'inquiries'). 인증 성공 후 이 동작을 실행.
  let pendingAction = null;
  let rosterRows = [];   // 현재 표시 중인 명단(수정 시 행 조회용)
  let editingId = null;  // 수정 중인 수동신청 id (null 이면 신규 추가 모드)
  let currentProgram = {}; // 초기 GET 로드의 프로그램 전체 정보(확인증 생성에 사용)

  // 학생 참고기록(노쇼/태도) — 내부 강사용
  const NOTE_TYPE_LABELS = { noshow: '🚫 노쇼', attitude: '😠 태도', etc: '📝 기타' };
  let notesByKey = {};   // 이름|학년|반 → [기록...]
  let noteTarget = null; // 현재 작성 대상 { student_name, grade, class_no }
  function noteKey(name, grade, classNo) {
    return `${String(name || '').trim()}|${grade ?? ''}|${classNo ?? ''}`;
  }
  // 동명이인 처리: 이름+학년+반이 같고, 연락처가 양쪽 다 있으면 일치할 때만 같은 학생.
  function matchedNotes(name, grade, classNo, contact) {
    const bucket = notesByKey[noteKey(name, grade, classNo)] || [];
    return bucket.filter(n => {
      const nc = n.guardian_contact;
      return !(nc && contact) || nc === contact;
    });
  }

  // 학년별 반 개수 (공개/관리자 폼과 동일 규칙 — 1·2학년 6반, 3학년 7반, 4학년 8반, 5·6학년 7반)
  const CLASS_COUNT = { 1: 6, 2: 6, 3: 7, 4: 8, 5: 7, 6: 7 };
  function populateMClassOptions(grade, currentVal) {
    const sel = $('#m-class');
    const count = CLASS_COUNT[Number(grade)] || 0;
    if (!count) {
      sel.innerHTML = '<option value="">학년 먼저 선택</option>';
      sel.value = '';
      sel.disabled = true;
      return;
    }
    let opts = '<option value="">반 선택</option>';
    for (let i = 1; i <= count; i++) opts += `<option value="${i}">${i}반</option>`;
    sel.innerHTML = opts;
    sel.disabled = false;
    if (currentVal && Number(currentVal) >= 1 && Number(currentVal) <= count) sel.value = String(currentVal);
    else sel.value = '';
  }
  $('#m-grade').addEventListener('change', function () { populateMClassOptions(this.value); });

  // 수동입력 폼: 신규 추가 ↔ 수정 모드 전환
  function startEdit(row) {
    editingId = row.id;
    $('#m-name').value = row.student_name || '';
    $('#m-grade').value = row.grade ? String(row.grade) : '';
    populateMClassOptions(row.grade, row.class_no);
    $('#m-guardian').value = row.guardian_name || '';
    $('#m-phone').value = row.guardian_phone || '';
    $('#m-form-title').textContent = '✎ 수동 신청 수정';
    $('#m-add-btn').textContent = '수정 저장';
    $('#m-cancel-btn').hidden = false;
    $('#m-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function resetMForm() {
    editingId = null;
    $('#m-name').value = '';
    $('#m-grade').value = '';
    populateMClassOptions('', '');
    $('#m-guardian').value = '';
    $('#m-phone').value = '';
    $('#m-form-title').textContent = '＋ 수동 신청 입력 (종이 신청서)';
    $('#m-add-btn').textContent = '신청자 추가';
    $('#m-cancel-btn').hidden = true;
  }
  $('#m-cancel-btn').addEventListener('click', resetMForm);

  function statusBadge(r) {
    if (r.status === 'cancelled') return '<span class="badge-wait" style="opacity:.7;">취소</span>';
    return r.is_waitlist
      ? '<span class="badge-wait">대기</span>'
      : '<span class="badge-ok">접수</span>';
  }
  function sourceLabel(s) { return s === 'manual' ? '수동' : '온라인'; }

  // 선정(상태) 변경 드롭다운 — 온라인·수동 모두. 데이터 삭제 아님(status만 변경).
  const APP_STATUS_OPTS = [
    { v: 'received', t: '신청' },
    { v: 'selected', t: '선정' },
    { v: 'waitlisted', t: '대기' },
    { v: 'confirmed', t: '확정' },
    { v: 'rejected', t: '미선정' },
    { v: 'cancelled', t: '취소' },
  ];
  const APP_STATUS_LEGACY = { applied: 'received', waiting: 'waitlisted' };
  function selectCell(r) {
    const cur = APP_STATUS_LEGACY[r.status] || r.status || 'received';
    const opts = APP_STATUS_OPTS.map(o =>
      `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${o.t}</option>`).join('');
    return `<select class="x-status" data-status-id="${esc(r.id)}" style="font-size:12px; padding:2px 4px;">${opts}</select>`;
  }

  function manageCell(r) {
    if (r.source === 'manual') {
      return `<button type="button" class="btn mini" data-edit="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">수정</button>
              <button type="button" class="btn mini danger" data-del="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">삭제</button>`;
    }
    return `<span class="muted" style="font-size:11.5px;">온라인 신청</span>`;
  }

  function renderRoster(payload) {
    const tbody = $('#roster-tbody');
    const list = payload.data || [];
    rosterRows = list;
    tbody.innerHTML = list.map(r => {
      const memo = (r.motivation && String(r.motivation).trim()) ? String(r.motivation).trim() : '';
      const memoRow = memo
        ? `<tr class="memo-row"><td colspan="9" style="background:#FFFBEB; color:#92400E; font-size:12.5px; white-space:normal;">💬 <b>문의사항</b> · ${esc(memo)}</td></tr>`
        : '';
      const nCount = matchedNotes(r.student_name, r.grade, r.class_no, r.guardian_phone).length;
      const noteFlag = nCount
        ? ` <button type="button" class="note-flag" data-note="${esc(r.id)}" title="참고기록 ${nCount}건 보기">⚠️ ${nCount}</button>`
        : '';
      const noteBtn = `<button type="button" class="btn mini" data-note="${esc(r.id)}" style="padding:2px 8px; font-size:12px;">📝 기록</button>`;
      return `
      <tr${r.status === 'cancelled' ? ' style="opacity:.6;"' : ''}>
        <td>${r.status === 'cancelled' ? '—' : r.seq}</td>
        <td>${statusBadge(r)}</td>
        <td>${esc(r.student_name)}${noteFlag}</td>
        <td>${esc(r.grade ?? '')}학년 ${esc(r.class_no ?? '')}반</td>
        <td>${esc(r.guardian_name || '')}</td>
        <td>${esc(r.guardian_phone || '')}</td>
        <td>${esc(sourceLabel(r.source))}</td>
        <td>${selectCell(r)}</td>
        <td>${manageCell(r)} ${noteBtn}</td>
      </tr>${memoRow}`;
    }).join('');
    const has = list.length > 0;
    $('#roster-table').hidden = !has;
    $('#roster-empty').hidden = has;
    const pr = payload.program || {};
    $('#roster-summary').textContent =
      `접수 ${payload.accepted_count}/${pr.capacity ?? '-'} · 대기 ${payload.waitlist_count}/${pr.waitlist_capacity ?? '-'}`;
    $('#roster-title').textContent = `신청자 명단 — ${pr.title || ''}`;
    if (pr.recruit_status) $('#recruit-status-select').value = pr.recruit_status;
  }

  async function fetchRoster() {
    const res = await fetch(API + '/roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: instructorPass }),
    });
    const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
    return { res, j };
  }

  // 참고기록 일괄 조회 → 이름|학년|반 키로 색인(명단 매칭용).
  async function fetchNotes() {
    try {
      const res = await fetch(API + '/student-notes/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      const map = {};
      if (j.ok) (j.data || []).forEach(n => {
        const k = noteKey(n.student_name, n.grade, n.class_no);
        (map[k] = map[k] || []).push(n);
      });
      notesByKey = map;
    } catch { notesByKey = {}; }
  }

  // "신청자 보기" 토글
  $('#roster-btn').addEventListener('click', () => {
    if (instructorPass) {
      // 이미 인증됨 — 명단 카드 표시/숨김 토글(추가 비번 없음)
      const card = $('#state-roster');
      card.hidden = !card.hidden;
      return;
    }
    // 미인증 — '명단' 의도로 비번 프롬프트
    pendingAction = 'roster';
    $('#state-roster').hidden = false;
    $('#roster-auth').hidden = false;
    $('#roster-pass').focus();
  });

  // 강사 비번 확인 → 명단 로드
  async function authAndLoad() {
    const pw = $('#roster-pass').value;
    if (!pw) { $('#roster-auth-msg').textContent = '비밀번호를 입력하세요.'; return; }
    $('#roster-auth-msg').textContent = '확인 중…';
    instructorPass = pw;
    try {
      const { res, j } = await fetchRoster();
      if (!j.ok) {
        instructorPass = null;
        if (res.status === 503) $('#roster-auth-msg').textContent = j.error || '명단 기능이 설정되지 않았습니다.';
        else if (res.status === 403) blocked(j.error || '현재 열람이 비활성화되어 있습니다.', '🔒');
        else $('#roster-auth-msg').textContent = j.error || '확인 실패';
        return;
      }
      // 인증 성공 — 명단은 준비(렌더)해 두되, 화면 분기는 의도(pendingAction)에 따른다.
      $('#roster-auth').hidden = true;
      $('#roster-body').hidden = false;
      $('#roster-auth-msg').textContent = '';
      await fetchNotes();
      renderRoster(j);

      const action = pendingAction || 'roster';
      pendingAction = null;
      if (action === 'inquiries') {
        // '문의사항 보기'로 인증 → 명단 카드는 띄우지 않고 문의 모달만 연다.
        $('#state-roster').hidden = true;
        await fetchInquiries();
        openInqModal();
      } else {
        // '신청자 보기'로 인증 → 명단 표시(+ 문의 배지는 비동기로).
        $('#state-roster').hidden = false;
        fetchInquiries();
      }
    } catch (err) {
      instructorPass = null;
      $('#roster-auth-msg').textContent = '서버에 연결하지 못했습니다.';
    }
  }
  $('#roster-auth-btn').addEventListener('click', authAndLoad);
  $('#roster-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); authAndLoad(); } });

  async function refreshRoster() {
    const { j: rj } = await fetchRoster();
    if (rj.ok) { await fetchNotes(); renderRoster(rj); }
  }

  // ===== 학생 참고기록(노쇼/태도) 모달 =====
  function fmtNoteDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function renderNoteHistory(notes) {
    const list = (notes || []).slice().reverse();
    if (!list.length) return '<p class="muted" style="margin:8px 0;">아직 기록이 없습니다.</p>';
    return list.map(n => `
      <div class="note-item">
        <div class="note-item-head">
          <span class="note-type-tag">${NOTE_TYPE_LABELS[n.note_type] || NOTE_TYPE_LABELS.etc}</span>
          <span class="muted">${esc(fmtNoteDate(n.created_at))} · ${esc(n.created_by || '?')}</span>
        </div>
        ${n.content ? `<div class="note-item-body">${esc(n.content)}</div>` : ''}
      </div>`).join('');
  }
  function openNoteModal(row) {
    if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    noteTarget = {
      student_name: row.student_name, grade: row.grade ?? null, class_no: row.class_no ?? null,
      guardian_contact: row.guardian_phone || null,
    };
    $('#note-target-info').innerHTML = `<b>${esc(row.student_name)}</b> (${esc(row.grade ?? '?')}-${esc(row.class_no ?? '?')})`;
    $('#note-history').innerHTML = renderNoteHistory(
      matchedNotes(row.student_name, row.grade, row.class_no, row.guardian_phone));
    $('#note-type').value = 'noshow';
    $('#note-content').value = '';
    $('#note-modal').hidden = false;
  }
  function closeNoteModal() { $('#note-modal').hidden = true; noteTarget = null; }
  $('#note-cancel').addEventListener('click', closeNoteModal);
  $('#note-modal').addEventListener('click', (e) => { if (e.target.id === 'note-modal') closeNoteModal(); });
  $('#note-save').addEventListener('click', async () => {
    if (!noteTarget || !instructorPass) return;
    const note_type = $('#note-type').value;
    const content = $('#note-content').value.trim();
    try {
      const res = await fetch(API + '/student-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, ...noteTarget, note_type, content }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      toast('참고기록을 저장했습니다');
      await fetchNotes();
      // 명단의 ⚠️ 배지 갱신 + 모달 이력 갱신(방금 추가분 즉시 확인)
      const { j: rj } = await fetchRoster();
      if (rj.ok) renderRoster(rj);
      $('#note-history').innerHTML = renderNoteHistory(
        matchedNotes(noteTarget.student_name, noteTarget.grade, noteTarget.class_no, noteTarget.guardian_contact));
      $('#note-content').value = '';
    } catch (err) { toast('서버 오류로 저장하지 못했습니다.'); }
  });

  // ===== 문의사항 보기 (이 프로그램 한정) =====
  let inquiries = [];
  let inqFilter = 'all'; // all | pending | answered

  async function fetchInquiries() {
    if (!instructorPass) return;
    try {
      const res = await fetch(API + '/inquiries/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      inquiries = j.ok ? (j.data || []) : [];
    } catch { inquiries = []; }
    updateInqBadge();
  }
  function updateInqBadge() {
    const pending = inquiries.filter(x => !x.answered).length;
    const b = $('#inq-badge-edit');
    if (!b) return;
    if (pending > 0) { b.textContent = pending; b.hidden = false; } else { b.hidden = true; }
  }
  function renderInqList() {
    $$('[data-inq-f]').forEach(b => b.classList.toggle('active', b.getAttribute('data-inq-f') === inqFilter));
    let list = inquiries.slice(); // 서버에서 신청일시 내림차순
    if (inqFilter === 'pending') list = list.filter(x => !x.answered);
    else if (inqFilter === 'answered') list = list.filter(x => x.answered);
    const pending = inquiries.filter(x => !x.answered).length;
    $('#inq-modal-count').textContent = `· 전체 ${inquiries.length} · 대기 ${pending}`;
    const wrap = $('#inq-list');
    if (!list.length) {
      wrap.innerHTML = `<div class="muted" style="padding:16px; text-align:center;">표시할 문의사항이 없습니다.</div>`;
      return;
    }
    wrap.innerHTML = list.map(x => `
      <div class="inq-item">
        <div class="inq-item-head">
          <span><b>${esc(x.student_name)}</b> · ${esc(x.grade ?? '?')}-${esc(x.class_no ?? '?')} · ${esc(x.guardian_phone || '')}</span>
          <span>${esc(fmtNoteDate(x.submitted_at))}</span>
        </div>
        <div class="inq-item-msg">${esc(x.motivation)}</div>
        <div class="inq-item-foot">
          ${x.answered
            ? `<span class="inq-st-done">✅ 답변함${x.answered_at ? ` · ${esc(fmtNoteDate(x.answered_at))}` : ''}</span>`
            : `<span class="inq-st-wait">⏳ 대기</span>`}
          <button type="button" class="btn mini" data-inq-toggle="${esc(x.id)}" data-answered="${x.answered ? '1' : '0'}" style="padding:3px 10px; font-size:12px;">${x.answered ? '대기로' : '답변함'}</button>
        </div>
      </div>`).join('');
  }
  function openInqModal() { $('#inq-modal').hidden = false; renderInqList(); }
  function closeInqModal() { $('#inq-modal').hidden = true; }

  $('#inq-btn').addEventListener('click', async () => {
    if (!instructorPass) {
      // 미인증 — '문의사항' 의도로 비번 프롬프트(인증 성공 시 문의 모달이 열림)
      pendingAction = 'inquiries';
      $('#state-roster').hidden = false;
      $('#roster-auth').hidden = false;
      $('#roster-pass') && $('#roster-pass').focus();
      toast('강사 비밀번호를 입력하면 문의사항이 열립니다');
      return;
    }
    await fetchInquiries();
    openInqModal();
  });
  $('#inq-close').addEventListener('click', closeInqModal);
  $('#inq-modal').addEventListener('click', (e) => { if (e.target.id === 'inq-modal') closeInqModal(); });
  $$('[data-inq-f]').forEach(b => b.addEventListener('click', () => { inqFilter = b.getAttribute('data-inq-f'); renderInqList(); }));
  $('#inq-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-inq-toggle]');
    if (!btn || !instructorPass) return;
    const application_id = btn.getAttribute('data-inq-toggle');
    const next = btn.getAttribute('data-answered') !== '1';
    btn.disabled = true;
    try {
      const res = await fetch(API + '/inquiries/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, application_id, answered: next }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '처리 실패'); btn.disabled = false; return; }
      toast(next ? '답변함으로 표시했습니다' : '대기로 되돌렸습니다');
      await fetchInquiries();
      renderInqList();
    } catch (err) { toast('서버 오류로 처리하지 못했습니다.'); btn.disabled = false; }
  });

  // 수동 신청 추가 / 수정 저장 (editingId 유무로 분기)
  $('#m-add-btn').addEventListener('click', async () => {
    if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    const name = $('#m-name').value.trim();
    const grade = $('#m-grade').value;
    const classNo = $('#m-class').value;
    const guardian = $('#m-guardian').value.trim();
    const phone = $('#m-phone').value.trim();
    if (!name) { toast('학생 이름을 입력하세요.'); return; }
    if (!grade) { toast('학년을 선택하세요.'); return; }
    if (!classNo) { toast('반을 선택하세요.'); return; }
    const fields = {
      password: instructorPass,
      student_name: name,
      grade: Number(grade),
      class_no: Number(classNo),
      guardian_name: guardian || null,
      guardian_phone: phone || null,
    };
    try {
      if (editingId) {
        const res = await fetch(API + '/applications/' + encodeURIComponent(editingId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!j.ok) { toast(j.error || '수정 실패'); return; }
        toast('수정되었습니다');
      } else {
        const res = await fetch(API + '/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!j.ok) { toast(j.error || '추가 실패'); return; }
        toast(j.is_waitlist ? `대기 ${j.slot_number}번으로 추가되었습니다` : `접수 ${j.slot_number}번으로 추가되었습니다`);
      }
      resetMForm();
      await refreshRoster();
    } catch (err) {
      toast('서버 오류로 처리하지 못했습니다.');
    }
  });

  // 명단 테이블: 수동 건 수정/삭제 (이벤트 위임)
  $('#roster-tbody').addEventListener('click', async (e) => {
    const noteBtn = e.target.closest('[data-note]');
    if (noteBtn) {
      const row = rosterRows.find(r => String(r.id) === noteBtn.getAttribute('data-note'));
      if (row) openNoteModal(row);
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) {
      const row = rosterRows.find(r => String(r.id) === editBtn.getAttribute('data-edit'));
      if (row) startEdit(row);
      return;
    }
    if (delBtn) {
      if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
      const id = delBtn.getAttribute('data-del');
      if (!confirm('정말로 이 신청자를 삭제하시겠습니까? 삭제하면 복구할 수 없습니다.')) return;
      try {
        const res = await fetch(API + '/applications/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass }),
        });
        const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!j.ok) { toast(j.error || '삭제 실패'); return; }
        toast('삭제되었습니다');
        if (editingId === id) resetMForm(); // 수정 중이던 건을 지웠으면 폼 초기화
        await refreshRoster();
      } catch (err) {
        toast('서버 오류로 삭제하지 못했습니다.');
      }
    }
  });

  // 명단 테이블: 선정/상태 변경 (이벤트 위임)
  $('#roster-tbody').addEventListener('change', async (e) => {
    const sel = e.target.closest('.x-status');
    if (!sel) return;
    if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    const id = sel.getAttribute('data-status-id');
    const status = sel.value;
    try {
      const res = await fetch(API + '/applications/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, status }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '상태 변경 실패'); return; }
      toast('상태가 변경되었습니다');
      await refreshRoster(); // 순번/카운트 재계산 반영
    } catch (err) {
      toast('서버 오류로 변경하지 못했습니다.');
    }
  });

  // 모집상태 변경 — 공개 화면에 즉시 반영
  $('#recruit-status-select').addEventListener('change', async (e) => {
    if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    const recruit_status = e.target.value;
    try {
      const res = await fetch(API + '/recruit-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, recruit_status }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (!j.ok) { toast(j.error || '모집상태 변경 실패'); return; }
      toast('모집상태가 변경되었습니다');
    } catch (err) {
      toast('서버 오류로 변경하지 못했습니다.');
    }
  });

  // 참가 확인증 출력 — 인증된 명단(rosterRows) + 프로그램 정보로 인쇄용 창 생성(읽기 전용).
  $('#roster-cert-btn').addEventListener('click', async () => {
    if (!instructorPass || $('#roster-body').hidden) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    if (!rosterRows || rosterRows.length === 0) { toast('확인증을 출력할 신청자가 없습니다.'); return; }
    // 이수 도장 목록(매칭/집계용). 실패해도 확인증은 출력.
    let stamps = [];
    try {
      const res = await fetch(API + '/completion-stamps/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok) stamps = j.data || [];
    } catch {}
    // 확인증 공통 이미지(QR·로고) 설정 로드(비번 게이트). 실패해도 확인증은 출력.
    let certImages = null;
    try {
      const res = await fetch(API + '/app-settings/get', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, key: 'cert_images' }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok) certImages = j.value || null;
    } catch {}
    // 증서 디자인 설정(템플릿/색/로고) 로드. 실패해도 출력.
    let certConfig = null;
    try {
      const res = await fetch(API + '/app-settings/get', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass, key: 'cert_config' }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok) certConfig = j.value || null;
    } catch {}
    window.SaessakCertificate.openDialog({
      groups: [{ program: currentProgram || {}, candidates: rosterRows }],
      defaultContact: (currentProgram && currentProgram.instructors) || '',
      stamps,
      certImages,
      certConfig,
      // 공통 이미지 설정 저장(app_settings.cert_images · 비번 동봉)
      onSaveImages: async (value) => {
        const r = await fetch(API + '/app-settings/set', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass, key: 'cert_images', value }),
        });
        const rj = await r.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!rj.ok) throw new Error(rj.error || '저장 실패');
      },
      // 증서 디자인 설정 저장(app_settings.cert_config · 비번 동봉)
      onSaveConfig: async (value) => {
        const r = await fetch(API + '/app-settings/set', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass, key: 'cert_config', value }),
        });
        const rj = await r.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!rj.ok) throw new Error(rj.error || '저장 실패');
      },
      // 로고/마스코트 업로드(cert-assets 버킷 · 비번 동봉) → public URL
      onUploadLogo: async (dataUrl) => {
        const r = await fetch(API + '/cert-assets/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass, dataUrl }),
        });
        const rj = await r.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!rj.ok || !rj.url) throw new Error(rj.error || '업로드 실패');
        return rj.url;
      },
      // 도장 찍기/취소 → 강사 API(비번 동봉) 호출 후 최신 목록 반환
      onToggleStamp: async (entry) => {
        const url = entry.stamped ? '/completion-stamps/remove' : '/completion-stamps';
        const r = await fetch(API + url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass, ...entry }),
        });
        const rj = await r.json().catch(() => ({ ok: false, error: '응답 오류' }));
        if (!rj.ok) throw new Error(rj.error || '도장 처리 실패');
        const lr = await fetch(API + '/completion-stamps/list', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: instructorPass }),
        });
        const lj = await lr.json().catch(() => ({ ok: false }));
        return lj.ok ? (lj.data || []) : [];
      },
    });
  });

  // 엑셀 다운로드 — 인증된 비번을 동봉해 POST, blob 으로 받아 저장.
  $('#roster-xlsx-btn').addEventListener('click', async () => {
    if (!instructorPass) { toast('먼저 강사 비밀번호를 확인하세요.'); return; }
    const btn = $('#roster-xlsx-btn');
    btn.disabled = true;
    try {
      const res = await fetch(API + '/roster.xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: instructorPass }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: '다운로드 실패' }));
        toast(j.error || '다운로드 실패');
        return;
      }
      // 서버가 보낸 파일명(Content-Disposition filename*) 추출, 없으면 기본값.
      let fname = '신청자명단.xlsx';
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      if (m) { try { fname = decodeURIComponent(m[1]); } catch {} }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('서버 오류로 다운로드하지 못했습니다.');
    } finally {
      btn.disabled = false;
    }
  });

  load();
})();
