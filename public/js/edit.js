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
    const text = window.SaessakSchedule.format({ session_dates: sessionDates, start_time: st, end_time: et });
    $('#sb-preview').textContent = text ? `미리보기: ${text}` : '미리보기: (날짜를 선택하면 표시됩니다)';
  }
  function loadScheduleBuilderFrom(p) {
    const sd = (p && Array.isArray(p.session_dates)) ? p.session_dates.slice() : [];
    $('#sb-start-time').value = (p && p.start_time) || '';
    $('#sb-end-time').value = (p && p.end_time) || '';
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
    fillForm(j.data || {});
    showState('form');
  }

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

    let autoSchedule = '';
    if (sessionDates.length > 0) {
      autoSchedule = window.SaessakSchedule.format({ session_dates: sessionDates, start_time: startTime, end_time: endTime });
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
    };

    try {
      const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (res.status === 403) { blocked(j.error || '현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.', '🔒'); return; }
      if (!j.ok) { toast(j.error || '저장 실패'); return; }
      if (j.data) fillForm(j.data);
      toast('저장되었습니다');
    } catch (err) {
      toast('서버 오류로 저장하지 못했습니다.');
    }
  });

  // ===== 삭제 =====
  $('#delete-btn').addEventListener('click', async () => {
    if (!confirm('이 프로그램을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      const j = await res.json().catch(() => ({ ok: false, error: '응답 오류' }));
      if (res.status === 403) { blocked(j.error || '현재 수정이 비활성화되어 있습니다. 관리자에게 문의하세요.', '🔒'); return; }
      if (!j.ok) { toast(j.error || '삭제 실패'); return; }
      blocked('프로그램이 삭제되었습니다.', '✅');
    } catch (err) {
      toast('서버 오류로 삭제하지 못했습니다.');
    }
  });

  load();
})();
