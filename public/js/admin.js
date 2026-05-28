(() => {
  const ADMIN_BASE = location.pathname.replace(/\/$/, '');
  const API = ADMIN_BASE + '/api';

  let programs = [];
  let applications = [];
  let currentTab = 'dashboard';
  let currentProgramId = null;
  let currentSort = 'order';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatGradesLabel(grades) {
    if (!Array.isArray(grades) || grades.length === 0) return '';
    const sorted = [...new Set(grades.map(Number))].sort((a, b) => a - b);
    const contiguous = sorted.length >= 2 && sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (contiguous) return `${sorted[0]}~${sorted[sorted.length - 1]}학년`;
    return `${sorted.join(',')}학년`;
  }
  function readGradeChecks(form) {
    return Array.from(form.querySelectorAll('.grade-check'))
      .filter(c => c.checked)
      .map(c => Number(c.value));
  }
  function setGradeChecks(form, grades) {
    const set = new Set(Array.isArray(grades) ? grades.map(Number) : []);
    form.querySelectorAll('.grade-check').forEach(c => {
      c.checked = set.has(Number(c.value));
    });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return iso; }
  }
  function statusBadge(s) {
    const map = {
      applied: ['badge', '신청'],
      selected: ['badge selected', '선정'],
      waiting: ['badge waiting', '대기'],
      cancelled: ['badge cancelled', '취소'],
    };
    const [c, l] = map[s] || ['badge', s];
    return `<span class="${c}">${l}</span>`;
  }
  function typeLabel(t) {
    return { general: '일반형', multicultural: '다문화 우대', sibling: '형제 우대' }[t] || '일반형';
  }
  function typeBadge(t) {
    if (t === 'multicultural') return '<span class="badge tag-multicultural">다문화 우대</span>';
    if (t === 'sibling') return '<span class="badge tag-sibling">형제 우대</span>';
    return '<span class="badge">일반형</span>';
  }
  function siblingShort(id) {
    if (!id) return '';
    return id.slice(0, 6);
  }
  const siblingColorCache = {};
  function siblingColor(id) {
    if (!id) return '';
    if (siblingColorCache[id]) return siblingColorCache[id];
    // hash → hue
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    const c = `hsl(${h}, 70%, 88%)`;
    siblingColorCache[id] = c;
    return c;
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (res.status === 401) {
      location.href = ADMIN_BASE + '/login';
      throw new Error('인증 만료');
    }
    const j = await res.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }));
    if (!j.ok) throw new Error(j.error || '서버 오류');
    return j;
  }

  // ===== Tabs =====
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(name) {
    currentTab = name;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-pane').forEach(p => {
      p.hidden = p.id !== 'pane-' + name;
    });
    if (name === 'dashboard') loadDashboard();
    else if (name === 'programs') loadProgramsTab();
    else if (name === 'applicants') loadApplicantsTab();
    else if (name === 'export') loadExportTab();
  }

  // ===== Dashboard =====
  async function loadDashboard() {
    try {
      const j = await api('/dashboard');
      const d = j.data;
      $('#dash-totals').innerHTML = `
        <div class="stat-card"><div class="label">전체 프로그램</div><div class="value">${d.totals.programs}</div><div class="sub">모집중 ${d.totals.openPrograms}</div></div>
        <div class="stat-card"><div class="label">총 신청</div><div class="value">${d.totals.applications}</div></div>
        <div class="stat-card"><div class="label">선정자</div><div class="value">${d.totals.selected}</div></div>
        <div class="stat-card"><div class="label">다문화 신청자</div><div class="value">${d.totals.multiculturalApplicants ?? 0}</div><div class="sub">${d.totals.multiculturalShortage ? `최소보장 미달 ${d.totals.multiculturalShortage}개` : '모두 충족'}</div></div>
        <div class="stat-card"><div class="label">형제 묶음</div><div class="value">${d.totals.siblingGroups ?? 0}</div></div>
        <div class="stat-card"><div class="label">여러 프로그램 신청자</div><div class="value">${d.multiStudents.length}</div></div>
      `;

      $('#dash-programs').innerHTML = d.programs.length === 0
        ? `<tr><td colspan="8" class="empty-state">프로그램이 없습니다.</td></tr>`
        : d.programs.map(p => `
          <tr>
            <td>${esc(p.title)}</td>
            <td>${typeBadge(p.program_type)}</td>
            <td>${p.applied}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlisted || 0}</span></td>
            <td>${p.selected}</td>
            <td>${p.capacity}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_capacity ?? 10}</span></td>
            <td>${p.remaining}<br><span class="muted" style="font-size:11px;">대기여유 ${p.waitlist_remaining || 0}</span></td>
            <td>${renderPreferenceProgress(p)}</td>
            <td>${p.is_open ? '<span class="badge open">모집중</span>' : '<span class="badge closed">마감</span>'}</td>
          </tr>
        `).join('');

      const maxByGrade = Math.max(1, ...Object.values(d.gradeStats.byGrade || {}));
      const gradesHtml = [1,2,3,4,5,6].map(g => {
        const v = d.gradeStats.byGrade[g] || 0;
        const pct = (v / maxByGrade) * 100;
        return `<div class="grade-bar">
          <span class="name">${g}학년</span>
          <span class="bar"><span class="fill" style="width:${pct}%"></span></span>
          <span class="num">${v}</span>
        </div>`;
      }).join('');
      $('#dash-grades').innerHTML = gradesHtml;
      $('#dash-low').textContent = `저학년(1~2): ${d.gradeStats.low}`;
      $('#dash-high').textContent = `고학년(3~6): ${d.gradeStats.high}`;

      $('#dash-multi').innerHTML = d.multiStudents.length === 0
        ? `<tr><td colspan="4" class="empty-state">중복 신청자가 없습니다.</td></tr>`
        : d.multiStudents.map(s => `
          <tr>
            <td>${esc(s.student_name)}</td>
            <td>${s.grade ?? '?'}-${s.class_no ?? '?'}</td>
            <td><b>${s.count}</b></td>
            <td>${s.program_titles.map(esc).join(', ')}</td>
          </tr>
        `).join('');

      const sibs = d.siblings || [];
      $('#dash-siblings').innerHTML = sibs.length === 0
        ? `<tr><td colspan="5" class="empty-state">형제·자매 묶음 신청이 없습니다.</td></tr>`
        : sibs.map(s => `
          <tr>
            <td><span class="badge" style="background:${siblingColor(s.sibling_group_id)}; color:#0F172A;">${esc(siblingShort(s.sibling_group_id))}</span></td>
            <td><b>${s.student_count}</b>명</td>
            <td>${s.students.map(esc).join(', ')}</td>
            <td>${s.program_titles.map(esc).join(', ')}</td>
            <td>${esc(s.guardian_phone || '')}</td>
          </tr>
        `).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  function renderPreferenceProgress(p) {
    if (p.program_type === 'multicultural') {
      if (p.multicultural_min == null) {
        return `<span class="muted">최소 보장 미설정</span>`;
      }
      const c = p.multicultural_count || 0;
      const m = p.multicultural_min;
      const pct = Math.min(100, (c / m) * 100);
      const cls = c >= m ? 'ok' : 'short';
      return `<div class="pref-bar ${cls}">
        <span class="pref-text">다문화 <b>${c}</b> / ${m}</span>
        <span class="pref-track"><span class="pref-fill" style="width:${pct}%"></span></span>
      </div>`;
    }
    if (p.program_type === 'sibling') {
      return `<span class="muted">형제 우대 (수동 판단)</span>`;
    }
    return '<span class="muted">—</span>';
  }

  // ===== Programs Tab =====
  async function loadProgramsTab() {
    try {
      const j = await api('/programs');
      programs = j.data || [];
      $('#programs-tbody').innerHTML = programs.length === 0
        ? `<tr><td colspan="10" class="empty-state">등록된 프로그램이 없습니다.</td></tr>`
        : programs.map(p => `
          <tr data-id="${p.id}">
            <td><b>${esc(p.title)}</b></td>
            <td>${typeBadge(p.program_type)}${p.program_type === 'multicultural' && p.multicultural_min != null ? `<div class="muted" style="font-size:11px; margin-top:2px;">최소 ${p.multicultural_min}명</div>` : ''}</td>
            <td>${esc(p.schedule || '')}</td>
            <td>${esc(p.location || '')}</td>
            <td>${formatGradesLabel(p.grades)}</td>
            <td>${p.capacity}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_capacity ?? 10}</span></td>
            <td>${p.applied_count} / ${p.capacity}${(p.waitlist_count || 0) > 0 ? `<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_count} / ${p.waitlist_capacity ?? 10}</span>` : ''}</td>
            <td>${esc(p.instructors || '')}</td>
            <td>
              <label class="toggle-switch">
                <input type="checkbox" data-toggle="${p.id}" ${p.is_open ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </td>
            <td class="cell-actions">
              <button class="btn small" data-edit="${p.id}">수정</button>
              <button class="btn small danger" data-del="${p.id}">삭제</button>
            </td>
          </tr>
        `).join('');

      $$('[data-toggle]').forEach(el => {
        el.addEventListener('change', async () => {
          const id = el.dataset.toggle;
          try {
            await api(`/programs/${id}/toggle`, { method: 'PATCH' });
            toast('모집 상태가 변경되었습니다');
            loadProgramsTab();
          } catch (err) { toast(err.message); }
        });
      });
      $$('[data-edit]').forEach(el => el.addEventListener('click', () => openProgramDialog(el.dataset.edit)));
      $$('[data-del]').forEach(el => el.addEventListener('click', async () => {
        if (!confirm('이 프로그램과 모든 신청 내역을 삭제할까요?')) return;
        try { await api(`/programs/${el.dataset.del}`, { method: 'DELETE' }); toast('삭제됨'); loadProgramsTab(); }
        catch (err) { toast(err.message); }
      }));
    } catch (err) {
      toast(err.message);
    }
  }

  $('#new-program-btn').addEventListener('click', () => openProgramDialog(null));

  function openProgramDialog(id) {
    const dlg = $('#program-dialog');
    const form = $('#program-form');
    form.reset();
    form.dataset.editId = id || '';
    $('#program-dialog-title').textContent = id ? '프로그램 수정' : '프로그램 추가';
    if (id) {
      const p = programs.find(x => x.id === id);
      if (p) {
        form.title.value = p.title || '';
        form.description.value = p.description || '';
        form.schedule.value = p.schedule || '';
        form.location.value = p.location || '';
        setGradeChecks(form, p.grades);
        form.capacity.value = p.capacity || 20;
        form.waitlist_capacity.value = p.waitlist_capacity ?? 10;
        form.instructors.value = p.instructors || '';
        form.program_type.value = p.program_type || 'general';
        form.multicultural_min.value = p.multicultural_min ?? '';
        $('#program-is-open').checked = !!p.is_open;
      }
    } else {
      form.program_type.value = 'general';
      form.multicultural_min.value = '';
      $('#program-is-open').checked = false;
    }
    updateMulticulturalMinVisibility();
    dlg.classList.add('open');
  }

  function updateMulticulturalMinVisibility() {
    const t = $('#program-type-select').value;
    const show = t === 'multicultural';
    $('#multi-min-label').hidden = !show;
    $('#multi-min-row').hidden = !show;
  }
  $('#program-type-select').addEventListener('change', updateMulticulturalMinVisibility);

  $('#program-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const ptype = form.program_type.value;
    const grades = readGradeChecks(form);
    if (grades.length === 0) {
      toast('대상 학년을 1개 이상 선택하세요.');
      return;
    }
    const payload = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      schedule: form.schedule.value.trim(),
      location: form.location.value.trim(),
      grades,
      capacity: Number(form.capacity.value),
      waitlist_capacity: Math.max(0, Number(form.waitlist_capacity.value) || 0),
      instructors: form.instructors.value.trim(),
      is_open: $('#program-is-open').checked,
      program_type: ptype,
      multicultural_min: ptype === 'multicultural' && form.multicultural_min.value !== ''
        ? Number(form.multicultural_min.value) : null,
    };
    try {
      if (form.dataset.editId) {
        await api(`/programs/${form.dataset.editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/programs', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#program-dialog').classList.remove('open');
      toast('저장됨');
      loadProgramsTab();
    } catch (err) { toast(err.message); }
  });

  // ===== Applicants Tab =====
  async function loadApplicantsTab() {
    try {
      // 신청자 관리는 닫힌 프로그램도 봐야 한다. /programs는 is_open 필터 없이 모두 반환.
      // stale 캐시로 옵션이 비어 보이는 케이스를 막기 위해 진입할 때마다 fresh fetch.
      const j = await api('/programs');
      programs = j.data || [];

      const sel = $('#app-program-select');
      if (programs.length === 0) {
        sel.innerHTML = '<option value="">— 등록된 프로그램이 없습니다 —</option>';
      } else {
        sel.innerHTML = '<option value="">— 프로그램 선택 —</option>' +
          programs.map(p => {
            const stateTag = p.is_open ? '🟢' : '⚪';
            return `<option value="${p.id}" ${p.id === currentProgramId ? 'selected' : ''}>${stateTag} ${esc(p.title)} (${p.applied_count}/${p.capacity})</option>`;
          }).join('');
      }
      if (currentProgramId && programs.some(p => p.id === currentProgramId)) {
        await loadApplications(currentProgramId);
      } else {
        currentProgramId = null;
        $('#applicants-tbody').innerHTML = `<tr><td colspan="10" class="empty-state">프로그램을 선택하세요.</td></tr>`;
      }
    } catch (err) { toast(err.message); }
  }

  $('#app-program-select').addEventListener('change', async (e) => {
    currentProgramId = e.target.value || null;
    if (currentProgramId) await loadApplications(currentProgramId);
    else $('#applicants-tbody').innerHTML = `<tr><td colspan="9" class="empty-state">프로그램을 선택하세요.</td></tr>`;
  });
  $('#app-sort').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderApplications();
  });

  async function loadApplications(pid) {
    try {
      const j = await api(`/applications?program_id=${encodeURIComponent(pid)}`);
      applications = j.data || [];
      renderApplications();
    } catch (err) { toast(err.message); }
  }

  function renderApplications() {
    const tbody = $('#applicants-tbody');
    let list = applications.slice();
    if (currentSort === 'submitted') list.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    else if (currentSort === 'grade') list.sort((a, b) => (a.grade || 0) - (b.grade || 0) || (a.class_no || 0) - (b.class_no || 0));
    else if (currentSort === 'name') list.sort((a, b) => (a.student_name || '').localeCompare(b.student_name || ''));
    else {
      list.sort((a, b) => {
        const ao = a.display_order ?? null;
        const bo = b.display_order ?? null;
        if (ao !== null && bo !== null) return ao - bo;
        if (ao !== null) return -1;
        if (bo !== null) return 1;
        return new Date(a.submitted_at) - new Date(b.submitted_at);
      });
    }

    $('#app-count').textContent = `${list.length}명`;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">신청자가 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((a, i) => {
      const badges = [];
      // 접수 순번 자동 구분 (관리자 status 판정과는 별개 레이어)
      if (a.is_waitlist) badges.push('<span class="badge" style="background:#FEF3C7; color:#92400E;">자동대기</span>');
      else badges.push('<span class="badge" style="background:#DCFCE7; color:#166534;">자동접수</span>');
      if (a.is_multicultural) badges.push('<span class="badge tag-multicultural">다문화</span>');
      if (a.sibling_group_id) {
        badges.push(`<span class="badge" style="background:${siblingColor(a.sibling_group_id)}; color:#0F172A;">형제 ${esc(siblingShort(a.sibling_group_id))}</span>`);
      }
      return `
      <tr data-id="${a.id}">
        <td>${i + 1}</td>
        <td><b>${esc(a.student_name)}</b></td>
        <td>${a.grade ?? '?'}-${a.class_no ?? '?'}</td>
        <td>${esc(a.guardian_name || '')}<br><span class="muted">${esc(a.guardian_phone || '')}</span></td>
        <td>${esc(a.student_phone || '')}</td>
        <td>${badges.join(' ') || '<span class="muted">—</span>'}</td>
        <td>
          <select class="select" data-status="${a.id}">
            <option value="applied" ${a.status==='applied'?'selected':''}>신청</option>
            <option value="selected" ${a.status==='selected'?'selected':''}>선정</option>
            <option value="waiting" ${a.status==='waiting'?'selected':''}>대기</option>
            <option value="cancelled" ${a.status==='cancelled'?'selected':''}>취소</option>
          </select>
        </td>
        <td>${a.source === 'manual' ? '<span class="badge">수동</span>' : '<span class="badge">온라인</span>'}</td>
        <td>${fmtTime(a.submitted_at)}</td>
        <td class="cell-actions">
          <button class="btn small" data-up="${a.id}" title="위로">▲</button>
          <button class="btn small" data-down="${a.id}" title="아래로">▼</button>
          <button class="btn small" data-copy="${a.id}">복사</button>
          <button class="btn small" data-edit-app="${a.id}">수정</button>
          <button class="btn small danger" data-del-app="${a.id}">삭제</button>
        </td>
      </tr>
    `;
    }).join('');

    $$('[data-status]').forEach(el => el.addEventListener('change', async (e) => {
      try {
        await api(`/applications/${el.dataset.status}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: e.target.value }),
        });
        toast('상태 변경됨');
        await loadApplications(currentProgramId);
      } catch (err) { toast(err.message); }
    }));
    $$('[data-up]').forEach(el => el.addEventListener('click', () => moveRow(el.dataset.up, -1)));
    $$('[data-down]').forEach(el => el.addEventListener('click', () => moveRow(el.dataset.down, +1)));
    $$('[data-copy]').forEach(el => el.addEventListener('click', () => openCopyDialog(el.dataset.copy)));
    $$('[data-edit-app]').forEach(el => el.addEventListener('click', () => openApplicantDialog(el.dataset.editApp)));
    $$('[data-del-app]').forEach(el => el.addEventListener('click', async () => {
      if (!confirm('이 신청을 삭제할까요?')) return;
      try { await api(`/applications/${el.dataset.delApp}`, { method: 'DELETE' }); toast('삭제됨'); await loadApplications(currentProgramId); }
      catch (err) { toast(err.message); }
    }));
  }

  async function moveRow(id, dir) {
    const tbody = $('#applicants-tbody');
    const rows = Array.from(tbody.querySelectorAll('tr[data-id]')).map(r => r.dataset.id);
    const idx = rows.indexOf(id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= rows.length) return;
    [rows[idx], rows[newIdx]] = [rows[newIdx], rows[idx]];
    const items = rows.map((rid, i) => ({ id: rid, display_order: i + 1 }));
    try {
      await api('/applications/reorder', { method: 'POST', body: JSON.stringify({ items }) });
      await loadApplications(currentProgramId);
    } catch (err) { toast(err.message); }
  }

  $('#add-applicant-btn').addEventListener('click', () => openApplicantDialog(null));

  function openApplicantDialog(id) {
    const dlg = $('#applicant-dialog');
    const form = $('#applicant-form');
    form.reset();
    form.dataset.editId = id || '';
    $('#applicant-dialog-title').textContent = id ? '신청자 수정' : '신청자 추가';

    const psel = form.program_id;
    psel.innerHTML = programs.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');

    if (id) {
      const a = applications.find(x => x.id === id);
      if (a) {
        psel.value = a.program_id;
        form.student_name.value = a.student_name || '';
        form.grade.value = a.grade ?? '';
        form.class_no.value = a.class_no ?? '';
        form.guardian_name.value = a.guardian_name || '';
        form.guardian_phone.value = a.guardian_phone || '';
        form.student_phone.value = a.student_phone || '';
        form.motivation.value = a.motivation || '';
        form.status.value = a.status || 'applied';
        form.is_multicultural.checked = !!a.is_multicultural;
        form.sibling_group_id.value = a.sibling_group_id || '';
      }
    } else {
      psel.value = currentProgramId || (programs[0] && programs[0].id) || '';
      form.is_multicultural.checked = false;
      form.sibling_group_id.value = '';
    }
    dlg.classList.add('open');
  }

  $('#applicant-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = {
      program_id: form.program_id.value,
      student_name: form.student_name.value.trim(),
      grade: form.grade.value ? Number(form.grade.value) : null,
      class_no: form.class_no.value ? Number(form.class_no.value) : null,
      guardian_name: form.guardian_name.value.trim(),
      guardian_phone: form.guardian_phone.value.trim(),
      student_phone: form.student_phone.value.trim(),
      motivation: form.motivation.value.trim(),
      status: form.status.value,
      is_multicultural: form.is_multicultural.checked,
      sibling_group_id: form.sibling_group_id.value.trim() || null,
    };
    try {
      if (form.dataset.editId) {
        await api(`/applications/${form.dataset.editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        payload.source = 'manual';
        await api('/applications', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#applicant-dialog').classList.remove('open');
      toast('저장됨');
      if (currentProgramId) await loadApplications(currentProgramId);
    } catch (err) { toast(err.message); }
  });

  // Copy
  function openCopyDialog(id) {
    const a = applications.find(x => x.id === id);
    if (!a) return;
    $('#copy-source-info').textContent = `${a.student_name} (${a.grade}-${a.class_no}) → 다른 프로그램으로 복사`;
    const sel = $('#copy-target');
    sel.innerHTML = programs
      .filter(p => p.id !== a.program_id)
      .map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    sel.dataset.sourceId = id;
    $('#copy-dialog').classList.add('open');
  }
  $('#copy-confirm').addEventListener('click', async () => {
    const sel = $('#copy-target');
    const id = sel.dataset.sourceId;
    const target = sel.value;
    if (!target) return;
    try {
      await api(`/applications/${id}/copy`, { method: 'POST', body: JSON.stringify({ target_program_id: target }) });
      $('#copy-dialog').classList.remove('open');
      toast('복사 완료');
      if (currentProgramId) await loadApplications(currentProgramId);
    } catch (err) { toast(err.message); }
  });

  // ===== Export =====
  async function loadExportTab() {
    // 내보내기도 매번 fresh fetch (캐시 stale 방지).
    try { const j = await api('/programs'); programs = j.data || []; } catch (err) { toast(err.message); }
    $('#export-program').innerHTML =
      '<option value="">전체 프로그램</option>' +
      programs.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
  }
  $('#export-btn').addEventListener('click', () => {
    const pid = $('#export-program').value;
    const onlySel = $('#export-only-selected').checked;
    const params = new URLSearchParams();
    if (pid) params.set('program_id', pid);
    if (onlySel) params.set('only_selected', '1');
    const url = API + '/export' + (params.toString() ? '?' + params.toString() : '');
    location.href = url;
  });

  // ===== Common =====
  $$('[data-close]').forEach(el => el.addEventListener('click', () => {
    el.closest('.dialog-mask').classList.remove('open');
  }));
  $$('.dialog-mask').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
  });

  $('#logout-btn').addEventListener('click', async () => {
    try {
      await fetch(ADMIN_BASE + '/logout', { method: 'POST' });
    } catch {}
    location.href = ADMIN_BASE + '/login';
  });

  (async () => {
    try {
      const j = await api('/me');
      $('#me-meta').textContent = j.loggedAt ? `로그인 ${fmtTime(j.loggedAt)}` : '';
    } catch {}
    loadDashboard();
  })();
})();
