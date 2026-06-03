(() => {
  const ADMIN_BASE = location.pathname.replace(/\/$/, '');
  const API = ADMIN_BASE + '/api';

  // 학년별 반 개수 (반 개수 바뀌면 이 한 곳만 수정) — 1·2학년 6반, 3학년 7반, 4학년 8반, 5·6학년 7반
  const CLASS_COUNT = { 1: 6, 2: 6, 3: 7, 4: 8, 5: 7, 6: 7 };
  const GRADE_LIST = Object.keys(CLASS_COUNT).map(Number).sort((a, b) => a - b);

  // 모집 상태 4단계
  const RECRUIT_STATUSES = [
    { value: 'recruiting', label: '모집중',   short: '모집중' },
    { value: 'upcoming',   label: '모집예정', short: '예정' },
    { value: 'full',       label: '모집마감', short: '마감' },
    { value: 'closed',     label: '모집종료', short: '종료' },
    { value: 'hidden',     label: '모집숨김', short: '숨김' },
  ];
  function recruitStatusOf(p) {
    if (p && p.recruit_status) return p.recruit_status;
    // 옛 데이터 fallback
    return p && p.is_open ? 'recruiting' : 'hidden';
  }
  // 종합 탭 상태 배지: 프로그램 탭과 동일한 5단계 모집상태를 같은 라벨로 표시.
  // 정원/남은자리로 상태를 추정하지 않고 recruit_status 를 그대로 읽는다.
  const DASH_STATUS = {
    recruiting: { label: '모집중',   cls: 'open' },
    upcoming:   { label: '모집예정', cls: 'upcoming' },
    full:       { label: '마감',     cls: 'full' },
    closed:     { label: '완료',     cls: 'closed' },
    hidden:     { label: '숨김',     cls: 'hidden' },
  };
  function dashStatusBadge(p) {
    const s = DASH_STATUS[recruitStatusOf(p)] || DASH_STATUS.hidden;
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  let programs = [];
  let applications = [];
  let currentTab = 'dashboard';
  let currentProgramId = null;
  let currentSort = 'order';
  const ALL_PROGRAMS = '__all__'; // 신청자 탭 "전체 보기" sentinel

  // 학생 참고기록(노쇼/태도) — 내부 관리용
  // 기록 유형 설정 — 여기만 바꾸면 모달·학생기록 게시판에 모두 반영.
  const NOTE_TYPE_GROUPS = [
    { polarity: '긍정', types: [
      { value: 'excellent', label: '🌟 우수' },
      { value: 'active',    label: '👍 적극참여' },
      { value: 'praise',    label: '💬 칭찬' },
    ] },
    { polarity: '부정', types: [
      { value: 'noshow',   label: '🚫 노쇼' },
      { value: 'attitude', label: '😠 태도' },
    ] },
    { polarity: '중립', types: [
      { value: 'etc', label: '📝 기타' },
    ] },
  ];
  const NOTE_TYPE_LABELS = {};
  const NOTE_TYPE_POLARITY = {};
  NOTE_TYPE_GROUPS.forEach(g => g.types.forEach(t => { NOTE_TYPE_LABELS[t.value] = t.label; NOTE_TYPE_POLARITY[t.value] = g.polarity; }));
  // 표시/집계용: 저장된 polarity 우선, 없으면(기존 행) note_type 으로 추론.
  function polarityOf(n) { return (n && ['긍정', '부정', '중립'].includes(n.polarity)) ? n.polarity : (NOTE_TYPE_POLARITY[n && n.note_type] || '중립'); }
  function noteTypeOptionsHtml() {
    return NOTE_TYPE_GROUPS.map(g =>
      `<optgroup label="${g.polarity}">` + g.types.map(t => `<option value="${t.value}">${t.label}</option>`).join('') + `</optgroup>`
    ).join('');
  }
  const POLARITY_CLASS = { '긍정': 'pol-pos', '부정': 'pol-neg', '중립': 'pol-neu' };

  let studentNotesByKey = {}; // 이름|학년|반 → [기록...]
  let noteTarget = null;      // 현재 작성 대상 { student_name, grade, class_no, program_id }
  // 1차 매칭 식별값: 이름+학년+반
  function studentNoteKey(name, grade, classNo) {
    return `${String(name || '').trim()}|${grade ?? ''}|${classNo ?? ''}`;
  }
  // 동명이인 처리: 이름+학년+반이 같은 기록 중, 연락처가 양쪽 다 있으면 일치할 때만 같은 학생으로 간주.
  // (한쪽이라도 연락처가 없으면 이름+학년+반으로 매칭 — 이 경우 동명이인일 수 있음)
  function matchedNotes(name, grade, classNo, contact) {
    const bucket = studentNotesByKey[studentNoteKey(name, grade, classNo)] || [];
    return bucket.filter(n => {
      const nc = n.guardian_contact;
      return !(nc && contact) || nc === contact;
    });
  }

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
  // 강사명: 콤마/공백 무엇으로 입력돼도 콤마 없이 공백 한 칸으로만 구분.
  // 각 이름은 .inst(inline-block+nowrap)로 감싸 이름 내부는 안 끊기고 이름 사이에서만 줄바꿈.
  function instructorsHtml(raw) {
    const names = String(raw || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return '';
    return names.map(n => `<span class="inst">${esc(n)}</span>`).join(' ');
  }
  function formatSchedule(p) {
    if (window.SaessakSchedule && typeof window.SaessakSchedule.format === 'function') {
      return window.SaessakSchedule.format(p) || '';
    }
    return p && p.schedule ? p.schedule : '';
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
  function typesOf(p) {
    const m = (typeof p.is_type_multicultural === 'boolean') ? p.is_type_multicultural : (p.program_type === 'multicultural');
    const s = (typeof p.is_type_sibling === 'boolean')       ? p.is_type_sibling       : (p.program_type === 'sibling');
    return { multicultural: m, sibling: s };
  }
  function customTypeOf(p) {
    const v = p && p.type_custom;
    return (v && String(v).trim() !== '') ? String(v).trim() : null;
  }
  function typeLabel(p) {
    const { multicultural, sibling } = typesOf(p);
    const custom = customTypeOf(p);
    const parts = [];
    if (multicultural) parts.push('다문화 우대');
    if (sibling)       parts.push('형제 우대');
    if (custom)        parts.push(custom);
    return parts.length === 0 ? '일반형' : parts.join(' · ');
  }
  function typeBadges(p) {
    const { multicultural, sibling } = typesOf(p);
    const custom = customTypeOf(p);
    const out = [];
    if (multicultural) out.push('<span class="badge tag-multicultural">다문화 우대</span>');
    if (sibling)       out.push('<span class="badge tag-sibling">형제 우대</span>');
    if (custom)        out.push(`<span class="badge tag-custom">${esc(custom)}</span>`);
    if (out.length === 0) return '<span class="badge">일반형</span>';
    return out.join(' ');
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
    else if (name === 'inquiries') loadInquiriesTab();
    else if (name === 'student-board') loadStudentBoardTab();
    else if (name === 'schedule') loadScheduleTab();
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
            <td>${typeBadges(p)}</td>
            <td>${p.applied}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlisted || 0}</span></td>
            <td>${p.selected}</td>
            <td>${p.capacity}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_capacity ?? 10}</span></td>
            <td>${
              p.is_open && p.remaining > 0 && p.remaining <= 3
                ? `<span class="dash-remaining-low"><b>${p.remaining}</b> <span class="badge dash-closing-soon">마감 임박</span></span>`
                : p.remaining
            }<br><span class="muted" style="font-size:11px;">대기여유 ${p.waitlist_remaining || 0}</span></td>
            <td>${renderPreferenceProgress(p)}</td>
            <td>${dashStatusBadge(p)}</td>
          </tr>
        `).join('');

      // 학년별 분포: 1~6학년 카운트(집계 d.gradeStats.byGrade)를 그대로 재사용해
      // 비례 가로 막대로 표시. 채움 너비 = (해당 학년 / 학년 중 최댓값) * 100%.
      const byGrade = d.gradeStats.byGrade || {};
      const maxByGrade = Math.max(1, ...[1,2,3,4,5,6].map(g => byGrade[g] || 0));
      const gradesHtml = [1,2,3,4,5,6].map(g => {
        const v = byGrade[g] || 0;
        const pct = (v / maxByGrade) * 100;
        return `<div class="gd-row">
          <span class="gd-label">${g}학년</span>
          <span class="gd-track"><span class="gd-fill" style="width:${pct}%"></span></span>
          <span class="gd-num">${v}명</span>
        </div>`;
      }).join('');
      $('#dash-grades').innerHTML = `<div class="grade-dist">${gradesHtml}</div>`;

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

      // 마지막 갱신 시각 표시 (자동 새로고침 동작 확인용)
      const upd = $('#dash-updated');
      if (upd) upd.textContent = `마지막 갱신 ${fmtClock()}`;
    } catch (err) {
      toast(err.message);
    }
  }

  // HH:MM:SS (24시간) — 종합 탭 "마지막 갱신" 표시용
  function fmtClock() {
    const d = new Date();
    const z = n => String(n).padStart(2, '0');
    return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }

  // 종합 탭 전용 자동 새로고침: 탭이 종합이고 브라우저 탭이 보일 때만 10분마다 재호출.
  // 전체 페이지 리로드가 아니라 loadDashboard()만 다시 불러 재렌더(스크롤/탭 상태 유지).
  let dashAutoTimer = null;
  function startDashboardAutoRefresh() {
    if (dashAutoTimer) return;
    dashAutoTimer = setInterval(() => {
      if (currentTab === 'dashboard' && document.visibilityState === 'visible') {
        loadDashboard();
      }
    }, 600000); // 10분
  }

  function renderPreferenceProgress(p) {
    const t = typesOf(p);
    if (t.multicultural) {
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
    if (t.sibling) {
      return `<span class="muted">형제 우대 (수동 판단)</span>`;
    }
    return '<span class="muted">—</span>';
  }

  // ===== Programs Tab =====
  async function loadProgramsTab() {
    try {
      loadCreatorTokens();
      loadProgramOutputs();
      const j = await api('/programs');
      programs = j.data || [];
      $('#programs-tbody').innerHTML = programs.length === 0
        ? `<tr><td colspan="11" class="empty-state">등록된 프로그램이 없습니다.</td></tr>`
        : programs.map(p => `
          <tr data-id="${p.id}">
            <td><b>${esc(p.title)}</b>${p.created_by_label ? `<div class="creator-tag" title="위임 개설">🔗 ${esc(p.created_by_label)} 개설</div>` : ''}</td>
            <td>${typeBadges(p)}${typesOf(p).multicultural && p.multicultural_min != null ? `<div class="muted" style="font-size:11px; margin-top:2px;">최소 ${p.multicultural_min}명</div>` : ''}</td>
            <td>${esc(formatSchedule(p))}</td>
            <td>${esc(p.location || '')}</td>
            <td>${formatGradesLabel(p.grades)}</td>
            <td>${p.capacity}<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_capacity ?? 10}</span></td>
            <td>${p.applied_count} / ${p.capacity}${(p.waitlist_count || 0) > 0 ? `<br><span class="muted" style="font-size:11px;">대기 ${p.waitlist_count} / ${p.waitlist_capacity ?? 10}</span>` : ''}</td>
            <td class="cell-instructors">${instructorsHtml(p.instructors)}</td>
            <td>
              <select class="recruit-status-sel rs-${recruitStatusOf(p)}" data-status-pid="${p.id}">
                ${RECRUIT_STATUSES.map(s => `<option value="${s.value}" ${recruitStatusOf(p) === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </td>
            <td class="cell-tedit">
              <label class="te-toggle"><input type="checkbox" class="te-enable" data-te-pid="${p.id}" ${p.edit_enabled ? 'checked' : ''}> 허용</label>
              <div class="te-btns">
                <button class="btn xsmall" data-te-copy="${p.id}">링크복사</button>
                <button class="btn xsmall" data-te-regen="${p.id}">토큰재발급</button>
              </div>
            </td>
            <td class="cell-actions">
              <button class="btn small" data-edit="${p.id}">수정</button>
              <button class="btn small" data-output="${p.id}">📦 산출물</button>
              <button class="btn small danger" data-del="${p.id}">삭제</button>
            </td>
          </tr>
        `).join('');

      $$('[data-status-pid]').forEach(el => {
        el.addEventListener('change', async () => {
          const id = el.dataset.statusPid;
          const next = el.value;
          try {
            await api(`/programs/${id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ recruit_status: next }),
            });
            toast('모집 상태가 변경되었습니다');
            loadProgramsTab();
          } catch (err) { toast(err.message); loadProgramsTab(); }
        });
      });
      $$('[data-edit]').forEach(el => el.addEventListener('click', () => openProgramDialog(el.dataset.edit)));
      $$('[data-output]').forEach(el => el.addEventListener('click', () => openOutputDialog(el.dataset.output)));
      $$('[data-del]').forEach(el => el.addEventListener('click', async () => {
        if (!confirm('이 프로그램과 모든 신청 내역을 삭제할까요?')) return;
        try { await api(`/programs/${el.dataset.del}`, { method: 'DELETE' }); toast('삭제됨'); loadProgramsTab(); }
        catch (err) { toast(err.message); }
      }));

      // 강사 수정 권한 on/off
      $$('[data-te-pid]').forEach(el => el.addEventListener('change', async () => {
        const id = el.dataset.tePid;
        try {
          await api(`/programs/${id}/edit-permission`, { method: 'PATCH', body: JSON.stringify({ edit_enabled: el.checked }) });
          const p = programs.find(x => x.id === id); if (p) p.edit_enabled = el.checked;
          toast(el.checked ? '강사 수정 권한을 켰습니다' : '강사 수정 권한을 껐습니다');
        } catch (err) { toast(err.message); el.checked = !el.checked; }
      }));
      // 강사용 링크 복사
      $$('[data-te-copy]').forEach(el => el.addEventListener('click', () => {
        const p = programs.find(x => x.id === el.dataset.teCopy);
        if (!p || !p.edit_token) { toast('토큰이 없습니다. 토큰을 재발급해 주세요.'); return; }
        const url = `${location.origin}/edit/${p.edit_token}`;
        copyText(url);
      }));
      // 토큰 재발급(기존 링크 무효화)
      $$('[data-te-regen]').forEach(el => el.addEventListener('click', async () => {
        if (!confirm('새 토큰을 발급하면 기존 강사 링크는 즉시 사용할 수 없게 됩니다. 계속할까요?')) return;
        try {
          const j = await api(`/programs/${el.dataset.teRegen}/regenerate-token`, { method: 'POST' });
          const p = programs.find(x => x.id === el.dataset.teRegen);
          if (p && j.edit_token) p.edit_token = j.edit_token;
          toast('토큰을 재발급했습니다');
        } catch (err) { toast(err.message); }
      }));
    } catch (err) {
      toast(err.message);
    }
  }

  // ===== 개설자 토큰 관리 (프로그램 개설 위임) =====
  let creatorTokens = [];
  async function loadCreatorTokens() {
    try {
      const j = await api('/creator-tokens');
      creatorTokens = j.data || [];
      renderCreatorTokens();
    } catch (err) { /* 패널만 비움 — 프로그램 탭 자체는 동작 */ creatorTokens = []; renderCreatorTokens(); }
  }
  function renderCreatorTokens() {
    const wrap = $('#creator-tokens-list');
    if (!wrap) return;
    if (!creatorTokens.length) { wrap.innerHTML = '<div class="muted" style="font-size:12.5px;">발급된 개설자 토큰이 없습니다.</div>'; return; }
    wrap.innerHTML = creatorTokens.map(t => `
      <div class="creator-row" data-ct-id="${t.id}">
        <label class="te-toggle"><input type="checkbox" class="ct-enable" data-ct-toggle="${t.id}" ${t.enabled ? 'checked' : ''}> 허용</label>
        <b>${esc(t.label || '(라벨 없음)')}</b>
        <span class="muted" style="font-size:11.5px;">프로그램 ${t.program_count || 0}개</span>
        <span class="grow"></span>
        <button class="btn xsmall" data-ct-copy="${t.id}">링크복사</button>
        <button class="btn xsmall" data-ct-regen="${t.id}">토큰재발급</button>
        <button class="btn xsmall danger" data-ct-del="${t.id}">삭제</button>
      </div>`).join('');
    $$('[data-ct-toggle]').forEach(el => el.addEventListener('change', async () => {
      try {
        await api(`/creator-tokens/${el.dataset.ctToggle}`, { method: 'PATCH', body: JSON.stringify({ enabled: el.checked }) });
        const t = creatorTokens.find(x => x.id == el.dataset.ctToggle); if (t) t.enabled = el.checked;
        toast(el.checked ? '개설 링크를 허용했습니다' : '개설 링크를 차단했습니다');
      } catch (err) { toast(err.message); el.checked = !el.checked; }
    }));
    $$('[data-ct-copy]').forEach(el => el.addEventListener('click', () => {
      const t = creatorTokens.find(x => x.id == el.dataset.ctCopy);
      if (!t || !t.token) { toast('토큰이 없습니다.'); return; }
      copyText(`${location.origin}/create/${t.token}`, '개설 링크를 복사했습니다');
    }));
    $$('[data-ct-regen]').forEach(el => el.addEventListener('click', async () => {
      if (!confirm('새 토큰을 발급하면 기존 개설 링크는 즉시 사용할 수 없게 됩니다. 계속할까요?')) return;
      try { await api(`/creator-tokens/${el.dataset.ctRegen}/regenerate`, { method: 'POST' }); toast('토큰을 재발급했습니다'); loadCreatorTokens(); }
      catch (err) { toast(err.message); }
    }));
    $$('[data-ct-del]').forEach(el => el.addEventListener('click', async () => {
      if (!confirm('이 개설자 토큰을 삭제할까요? 링크가 즉시 차단됩니다. (개설된 프로그램은 그대로 유지됩니다)')) return;
      try { await api(`/creator-tokens/${el.dataset.ctDel}`, { method: 'DELETE' }); toast('삭제했습니다'); loadCreatorTokens(); }
      catch (err) { toast(err.message); }
    }));
  }
  $('#creator-add')?.addEventListener('click', async () => {
    const label = $('#creator-label').value.trim();
    if (!label) { toast('대상 이름/업체명을 입력하세요.'); return; }
    try {
      await api('/creator-tokens', { method: 'POST', body: JSON.stringify({ label }) });
      $('#creator-label').value = '';
      toast('개설자 토큰을 발급했습니다 (허용을 켜야 접근 가능)');
      loadCreatorTokens();
    } catch (err) { toast(err.message); }
  });

  // ===== 산출물(결과물 링크) 입력 =====
  let outputsByPid = {};
  async function loadProgramOutputs() {
    try {
      const j = await api('/program-outputs');
      const map = {};
      (j.data || []).forEach(o => { map[o.program_id] = o; });
      outputsByPid = map;
    } catch { outputsByPid = {}; }
  }
  function openOutputDialog(pid) {
    const p = programs.find(x => String(x.id) === String(pid));
    const o = outputsByPid[pid] || {};
    $('#output-dialog-pid').value = pid;
    $('#output-dialog-title').textContent = `📦 산출물 — ${p ? p.title : ''}`;
    $('#output-summary').value = o.summary || '';
    $('#output-url').value = o.output_url || '';
    $('#output-dialog').classList.add('open');
  }
  $('#output-save')?.addEventListener('click', async () => {
    const program_id = $('#output-dialog-pid').value;
    if (!program_id) return;
    try {
      await api('/program-outputs', { method: 'POST', body: JSON.stringify({ program_id, summary: $('#output-summary').value, output_url: $('#output-url').value }) });
      toast('산출물을 저장했습니다 (공개 /outputs 페이지에 노출)');
      await loadProgramOutputs();
      $('#output-dialog').classList.remove('open');
    } catch (err) { toast(err.message); }
  });

  // 클립보드 복사: navigator.clipboard → textarea fallback → prompt
  function copyText(text, msg) {
    const done = () => toast(msg || '링크를 복사했습니다');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { done(); return; }
    } catch (e) { /* ignore */ }
    window.prompt('아래 링크를 복사하세요:', text);
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
        form.location.value = p.location || '';
        setGradeChecks(form, p.grades);
        form.capacity.value = p.capacity || 20;
        form.waitlist_capacity.value = p.waitlist_capacity ?? 10;
        form.instructors.value = p.instructors || '';
        form.organization.value = p.organization || '';
        const t = typesOf(p);
        $('#type-multicultural').checked = !!t.multicultural;
        $('#type-sibling').checked       = !!t.sibling;
        const custom = customTypeOf(p);
        $('#type-custom').checked = !!custom;
        $('#type-custom-input').value = custom || '';
        form.multicultural_min.value = p.multicultural_min ?? '';
        form.recruit_status.value = recruitStatusOf(p);
        loadScheduleBuilderFrom(p);
      }
    } else {
      $('#type-multicultural').checked = false;
      $('#type-sibling').checked       = false;
      $('#type-custom').checked = false;
      $('#type-custom-input').value = '';
      form.multicultural_min.value = '';
      form.recruit_status.value = 'hidden'; // 신규는 숨김으로 시작
      loadScheduleBuilderFrom(null);
    }
    updateMulticulturalMinVisibility();
    updateTypeCustomVisibility();
    dlg.classList.add('open');
  }

  // ===== Schedule Builder =====
  // dialog DOM: #sb-start-date, #sb-end-date, #sb-start-time, #sb-end-time,
  //             #sb-days, #sb-preview (시작일·종료일 선택 시 자동 펼침)
  // 내부 상태: 각 행마다 <label class="sb-day on"><input type=checkbox value="YYYY-MM-DD" checked> M/D(요일)</label>

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
    // items: [{iso, checked}]
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
    return Array.from(document.querySelectorAll('#sb-days .sb-day-cb'))
      .filter(cb => cb.checked)
      .map(cb => cb.value)
      .sort();
  }
  function readAllListedDates() {
    return Array.from(document.querySelectorAll('#sb-days .sb-day-cb'))
      .map(cb => cb.value)
      .sort();
  }

  // 시작일·종료일이 둘 다 선택되면 그 사이 모든 날짜를 체크된 칩 목록으로 자동 펼친다.
  // 종료일이 없으면(범위 미정) 아직 펼치지 않는다. 범위가 바뀌면 체크 상태는 초기화(전부 체크).
  function autoExpandRange() {
    const s = fromISO($('#sb-start-date').value);
    const e = fromISO($('#sb-end-date').value);
    if (!s || !e) { renderDays([]); return; }            // 범위 미정 → 아직 안 펼침
    if (s.getTime() > e.getTime()) {                      // 종료일이 시작일보다 빠름
      toast('종료일이 시작일보다 빠릅니다.');
      renderDays([]);
      return;
    }
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
    const text = window.SaessakSchedule.format({
      session_dates: sessionDates,
      start_time: st,
      end_time: et,
      extra_sessions: readExtraSessions(),
    });
    $('#sb-preview').textContent = text ? `미리보기: ${text}` : '미리보기: (날짜를 선택하면 표시됩니다)';
  }

  function loadScheduleBuilderFrom(p) {
    const sd = (p && Array.isArray(p.session_dates)) ? p.session_dates.slice() : [];
    const startTime = (p && p.start_time) || '';
    const endTime = (p && p.end_time) || '';
    $('#sb-start-time').value = startTime;
    $('#sb-end-time').value = endTime;
    loadExtraSessions(p && p.extra_sessions);
    if (sd.length === 0) {
      $('#sb-start-date').value = '';
      $('#sb-end-date').value = '';
      $('#sb-days').innerHTML = '';
      updateSchedulePreview();
      return;
    }
    const sorted = sd.slice().sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    $('#sb-start-date').value = first;
    $('#sb-end-date').value = last;
    // 시작~종료 범위를 모두 펼친 후, 기존 session_dates 에 들어 있는 날짜만 체크
    const set = new Set(sorted);
    const items = [];
    const s = fromISO(first);
    const e = fromISO(last);
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      items.push({ iso, checked: set.has(iso) });
    }
    renderDays(items);
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
    return Array.from(document.querySelectorAll('#sb-extra-list .sb-extra-row')).map(r => ({
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

  // 이벤트 바인딩 (DOM 로딩 후 모듈 IIFE 시점에 한 번만)
  document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (e.target.id === 'sb-start-date' || e.target.id === 'sb-end-date') {
      autoExpandRange();
    } else if (e.target.id === 'sb-start-time' || e.target.id === 'sb-end-time') {
      updateSchedulePreview();
    }
  });

  function updateMulticulturalMinVisibility() {
    const show = $('#type-multicultural').checked;
    $('#multi-min-label').hidden = !show;
    $('#multi-min-row').hidden = !show;
  }
  $('#type-multicultural').addEventListener('change', updateMulticulturalMinVisibility);

  // 기타 유형: 체크 시 입력칸 노출, 해제 시 숨기고 값 초기화
  function updateTypeCustomVisibility() {
    const show = $('#type-custom').checked;
    $('#type-custom-label').hidden = !show;
    $('#type-custom-row').hidden = !show;
    if (!show) $('#type-custom-input').value = '';
  }
  $('#type-custom').addEventListener('change', updateTypeCustomVisibility);

  $('#program-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const tMulti = $('#type-multicultural').checked;
    const tSib   = $('#type-sibling').checked;
    const tCustom = $('#type-custom').checked;
    const customName = tCustom ? $('#type-custom-input').value.trim() : '';
    if (tCustom && !customName) {
      toast('기타 유형명을 입력하세요.');
      return;
    }
    const grades = readGradeChecks(form);
    if (grades.length === 0) {
      toast('대상 학년을 1개 이상 선택하세요.');
      return;
    }
    const sessionDates = readSelectedDates();
    const startTime = $('#sb-start-time').value || null;
    const endTime = $('#sb-end-time').value || null;
    // 일정 필수 검증: 날짜가 하나도 체크 안 됐거나 시작/종료 시각이 비어 있으면 저장 차단.
    if (sessionDates.length === 0 || !startTime || !endTime) {
      toast('일정(날짜·시간)을 입력해 주세요');
      return;
    }
    const extraSessions = readExtraSessions();
    // 기존 schedule 텍스트 호환: 새 입력이 있으면 자동 포맷한 결과를 schedule 에도 같이 저장(레거시 화면 안전망).
    let autoSchedule = '';
    if (sessionDates.length > 0 || extraSessions.length > 0) {
      autoSchedule = window.SaessakSchedule.format({
        session_dates: sessionDates,
        start_time: startTime,
        end_time: endTime,
        extra_sessions: extraSessions,
      });
    }
    const recruitStatus = form.recruit_status.value;
    const payload = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      schedule: autoSchedule || null,
      location: form.location.value.trim(),
      grades,
      capacity: Number(form.capacity.value),
      waitlist_capacity: Math.max(0, Number(form.waitlist_capacity.value) || 0),
      instructors: form.instructors.value.trim(),
      organization: form.organization.value.trim() || null,
      is_type_multicultural: tMulti,
      is_type_sibling: tSib,
      type_custom: customName || null,
      multicultural_min: tMulti && form.multicultural_min.value !== ''
        ? Number(form.multicultural_min.value) : null,
      session_dates: sessionDates,
      start_time: startTime,
      end_time: endTime,
      extra_sessions: extraSessions,
      recruit_status: recruitStatus,
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
        const stateEmoji = { recruiting: '🟢', upcoming: '🔴', closed: '⚫', hidden: '⚪' };
        sel.innerHTML = '<option value="">— 프로그램 선택 —</option>' +
          `<option value="${ALL_PROGRAMS}" ${currentProgramId === ALL_PROGRAMS ? 'selected' : ''}>📋 전체 보기</option>` +
          programs.map(p => {
            const tag = stateEmoji[recruitStatusOf(p)] || '⚪';
            return `<option value="${p.id}" ${p.id === currentProgramId ? 'selected' : ''}>${tag} ${esc(p.title)} (${p.applied_count}/${p.capacity})</option>`;
          }).join('');
      }
      if (currentProgramId === ALL_PROGRAMS) {
        await loadApplications(ALL_PROGRAMS);
      } else if (currentProgramId && programs.some(p => p.id === currentProgramId)) {
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
    else $('#applicants-tbody').innerHTML = `<tr><td colspan="10" class="empty-state">프로그램을 선택하세요.</td></tr>`;
  });
  $('#app-sort').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderApplications();
  });
  // 신청자 탭 필터(클라이언트 전용 — 서버/DB 무변경)
  let appPrefFilter = 'all';   // all | multicultural | sibling | general
  let appGradeFilter = 'all';  // all | 1..6
  let appCancelFilter = 'show'; // show | hide
  $('#app-pref-filter').addEventListener('change', (e) => { appPrefFilter = e.target.value; renderApplications(); });
  $('#app-grade-filter').addEventListener('change', (e) => { appGradeFilter = e.target.value; renderApplications(); });
  $('#app-cancel-filter').addEventListener('change', (e) => { appCancelFilter = e.target.value; renderApplications(); });
  // 우대 판정은 기존 명단 배지와 동일 기준(a.is_multicultural / a.sibling_group_id) 재사용.
  function appPassesFilters(a) {
    if (appCancelFilter === 'hide' && a.status === 'cancelled') return false;
    if (appGradeFilter !== 'all' && Number(a.grade) !== Number(appGradeFilter)) return false;
    if (appPrefFilter === 'multicultural' && a.is_multicultural !== true) return false;
    if (appPrefFilter === 'sibling' && !a.sibling_group_id) return false;
    if (appPrefFilter === 'general' && (a.is_multicultural === true || a.sibling_group_id)) return false;
    return true;
  }

  async function loadApplications(pid) {
    try {
      // 전체 보기는 program_id 없이 전체 신청을 가져온다(서버가 program 조인 포함).
      const url = (pid === ALL_PROGRAMS) ? '/applications' : `/applications?program_id=${encodeURIComponent(pid)}`;
      const j = await api(url);
      applications = j.data || [];
      await loadStudentNotes(); // 명단 그리기 전에 참고기록 일괄 조회(학생마다 N번 호출 방지)
      renderApplications();
    } catch (err) { toast(err.message); }
  }

  // 참고기록 전체를 한 번에 받아 이름|학년|반 키로 색인.
  async function loadStudentNotes() {
    try {
      const j = await api('/student-notes');
      const map = {};
      (j.data || []).forEach(n => {
        const k = studentNoteKey(n.student_name, n.grade, n.class_no);
        (map[k] = map[k] || []).push(n);
      });
      studentNotesByKey = map;
    } catch { studentNotesByKey = {}; }
  }

  function applicationComparator(a, b) {
    if (currentSort === 'submitted') return new Date(a.submitted_at) - new Date(b.submitted_at);
    if (currentSort === 'submitted_desc') return new Date(b.submitted_at) - new Date(a.submitted_at);
    if (currentSort === 'grade') return (a.grade || 0) - (b.grade || 0) || (a.class_no || 0) - (b.class_no || 0);
    if (currentSort === 'name') return (a.student_name || '').localeCompare(b.student_name || '');
    const ao = a.display_order ?? null;
    const bo = b.display_order ?? null;
    if (ao !== null && bo !== null) return ao - bo;
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    return new Date(a.submitted_at) - new Date(b.submitted_at);
  }

  // 신청자 1명 → 메인행 HTML.
  // (문의사항은 별도 "문의사항" 탭으로 일원화 — 신청자 탭에서는 표시하지 않음)
  // allView 면 순서이동(▲▼) 버튼을 숨긴다(전체 보기에서는 프로그램 교차 reorder 가 무의미·위험).
  function applicantRowHtml(a, displayIndex, allView) {
    const cancelled = a.status === 'cancelled';
    const badges = [];
    // 취소 건은 자동접수/자동대기 대신 "취소"로 표시(상태·카운트 정합성).
    if (cancelled) badges.push('<span class="badge" style="background:#E5E7EB; color:#6B7280;">취소</span>');
    else if (a.is_waitlist) badges.push('<span class="badge" style="background:#FEF3C7; color:#92400E;">자동대기</span>');
    else badges.push('<span class="badge" style="background:#DCFCE7; color:#166534;">자동접수</span>');
    if (a.is_multicultural) badges.push('<span class="badge tag-multicultural">다문화</span>');
    if (a.sibling_group_id) {
      badges.push(`<span class="badge" style="background:${siblingColor(a.sibling_group_id)}; color:#0F172A;">형제 ${esc(siblingShort(a.sibling_group_id))}</span>`);
    }
    if (a.name_conflict) {
      badges.push('<span class="badge name-conflict" title="같은 이름·다른 학년/반으로 신청된 다른 행이 있어요 (동명이인 의심)">⚠ 확인 필요</span>');
    }
    const reorderBtns = allView ? '' :
      `<button class="btn small" data-up="${a.id}" title="위로">▲</button>
          <button class="btn small" data-down="${a.id}" title="아래로">▼</button>`;
    const noteCount = matchedNotes(a.student_name, a.grade, a.class_no, a.guardian_phone).length;
    const noteFlag = noteCount
      ? ` <button type="button" class="note-flag" data-note="${a.id}" title="참고기록 ${noteCount}건 보기">⚠️ ${noteCount}</button>`
      : '';
    return `
      <tr data-id="${a.id}"${cancelled ? ' style="opacity:.55;"' : ''}>
        <td>${displayIndex}</td>
        <td><b>${esc(a.student_name)}</b>${noteFlag}</td>
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
          ${reorderBtns}
          <button class="btn small" data-note="${a.id}" title="참고기록(노쇼/태도)">📝 기록</button>
          <button class="btn small" data-copy="${a.id}">복사</button>
          <button class="btn small" data-edit-app="${a.id}">수정</button>
          <button class="btn small danger" data-del-app="${a.id}">삭제</button>
        </td>
      </tr>`;
  }

  function bindApplicationRowEvents() {
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
    $$('[data-note]').forEach(el => el.addEventListener('click', () => openNoteDialog(el.dataset.note)));
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

  function renderApplications() {
    const tbody = $('#applicants-tbody');
    const allView = (currentProgramId === ALL_PROGRAMS);

    // 필터 적용(우대·학년·취소). 정렬/필터는 클라이언트 전용.
    const filtered = applications.filter(appPassesFilters);

    // 카운트: 필터 적용 후 유효(취소 제외) 인원 + 취소 건수 별도 표기.
    const validCount = filtered.filter(a => a.status !== 'cancelled').length;
    const cancelledCount = filtered.length - validCount;
    const totalNote = (filtered.length !== applications.length) ? ` · 필터 적용(전체 ${applications.length})` : '';
    $('#app-count').textContent = `${validCount}명` + (cancelledCount ? ` (취소 ${cancelledCount})` : '') + totalNote;
    if (applications.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">신청자가 없습니다.</td></tr>`;
      return;
    }
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">필터에 해당하는 신청자가 없습니다.</td></tr>`;
      return;
    }

    if (allView) {
      // 프로그램별로 묶어서 표시. 그룹 순서는 programs 목록 순서를 따른다.
      const groups = new Map(); // program_id → { title, rows }
      filtered.forEach(a => {
        const pid = a.program_id;
        if (!groups.has(pid)) {
          groups.set(pid, { title: (a.program && a.program.title) || '(삭제된 프로그램)', rows: [] });
        }
        groups.get(pid).rows.push(a);
      });
      const order = programs.map(p => p.id).filter(id => groups.has(id));
      groups.forEach((_, pid) => { if (!order.includes(pid)) order.push(pid); });

      let html = '';
      order.forEach(pid => {
        const g = groups.get(pid);
        const rows = g.rows.slice().sort(applicationComparator);
        const gValid = rows.filter(a => a.status !== 'cancelled').length;
        const gCancelled = rows.length - gValid;
        html += `<tr class="group-row"><td colspan="10" style="background:#EEF2FF; color:#3730A3; font-weight:800; padding:6px 10px;">📚 ${esc(g.title)} <span class="muted" style="font-weight:600;">· ${gValid}명${gCancelled ? ` (취소 ${gCancelled})` : ''}</span></td></tr>`;
        // 순번은 취소 제외하고 매김. 취소 건은 '—'.
        let n = 0;
        html += rows.map(a => applicantRowHtml(a, a.status === 'cancelled' ? '—' : (++n), true)).join('');
      });
      tbody.innerHTML = html;
    } else {
      const list = filtered.slice().sort(applicationComparator);
      let n = 0;
      tbody.innerHTML = list.map(a => applicantRowHtml(a, a.status === 'cancelled' ? '—' : (++n), false)).join('');
    }

    bindApplicationRowEvents();
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

  // 참가 확인증 출력 — 현재 신청자 탭에 로드된 데이터로 인쇄용 창 생성(읽기 전용).
  // 특정 프로그램 선택 시 그 프로그램, '전체 보기' 시 전체 프로그램 확인증.
  $('#cert-print-btn').addEventListener('click', async () => {
    if (!currentProgramId) { toast('먼저 프로그램을 선택하세요.'); return; }
    if (!applications || applications.length === 0) { toast('확인증을 출력할 신청자가 없습니다.'); return; }
    let groups;
    if (currentProgramId === ALL_PROGRAMS) {
      // 프로그램별로 묶기. program 정보는 조인된 a.program 또는 programs 목록에서.
      const byPid = new Map();
      applications.forEach(a => {
        const pid = a.program_id;
        if (!byPid.has(pid)) {
          const prog = (a.program) || programs.find(p => p.id === pid) || { title: '(삭제된 프로그램)' };
          byPid.set(pid, { program: prog, candidates: [] });
        }
        byPid.get(pid).candidates.push(a);
      });
      // programs 목록 순서를 따른다.
      const order = programs.map(p => p.id).filter(id => byPid.has(id));
      byPid.forEach((_, pid) => { if (!order.includes(pid)) order.push(pid); });
      groups = order.map(pid => byPid.get(pid));
    } else {
      const prog = programs.find(p => p.id === currentProgramId) || {};
      groups = [{ program: prog, candidates: applications }];
    }
    const firstProg = groups[0] && groups[0].program;
    // 이수 도장판용: 전체 도장 일괄 조회(학생별 매칭/집계). 실패해도 확인증은 출력.
    let stamps = [];
    try { const j = await api('/completion-stamps'); stamps = j.data || []; } catch {}
    window.SaessakCertificate.openDialog({
      groups,
      defaultContact: (firstProg && (firstProg.organization || firstProg.instructors)) || '',
      stamps,
      // 도장 찍기/취소 → 관리자 API 호출 후 최신 도장 목록 반환(미리보기 재렌더용)
      onToggleStamp: async (entry) => {
        if (entry.stamped) await api('/completion-stamps/remove', { method: 'POST', body: JSON.stringify(entry) });
        else await api('/completion-stamps', { method: 'POST', body: JSON.stringify(entry) });
        const j = await api('/completion-stamps');
        return j.data || [];
      },
    });
  });

  function fillAppGradeOptions(currentVal) {
    const sel = $('#app-grade-select');
    sel.innerHTML = '<option value="">학년</option>' +
      GRADE_LIST.map(g => `<option value="${g}">${g}학년</option>`).join('');
    sel.value = (currentVal && CLASS_COUNT[Number(currentVal)]) ? String(currentVal) : '';
  }
  function fillAppClassOptions(grade, currentVal) {
    const sel = $('#app-class-select');
    const count = CLASS_COUNT[Number(grade)] || 0;
    if (!count) {
      sel.innerHTML = '<option value="">학년 먼저 선택</option>';
      sel.value = '';
      sel.disabled = true;
      return;
    }
    let html = '<option value="">반 선택</option>';
    for (let i = 1; i <= count; i++) html += `<option value="${i}">${i}반</option>`;
    sel.innerHTML = html;
    sel.value = (currentVal && Number(currentVal) >= 1 && Number(currentVal) <= count) ? String(currentVal) : '';
    sel.disabled = false;
  }

  // 다문화가정 체크는 선택한 프로그램이 다문화 우대형일 때만 노출(강사/공개 폼과 동일 조건).
  function selectedProgramIsMulticultural() {
    const pid = $('#applicant-form').program_id.value;
    const p = programs.find(x => String(x.id) === String(pid));
    if (!p) return false;
    return p.is_type_multicultural === true || p.program_type === 'multicultural';
  }
  function updateAppMcVisibility() {
    const show = selectedProgramIsMulticultural();
    $('#app-mc-label').hidden = !show;
    $('#app-mc-row').hidden = !show;
    if (!show) $('#applicant-form').is_multicultural.checked = false;
  }

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
        fillAppGradeOptions(a.grade);
        fillAppClassOptions(a.grade, a.class_no);
        form.guardian_name.value = a.guardian_name || '';
        form.guardian_phone.value = a.guardian_phone || '';
        form.motivation.value = a.motivation || '';
        form.status.value = a.status || 'applied';
        form.is_multicultural.checked = !!a.is_multicultural;
      }
    } else {
      // 전체 보기(currentProgramId === ALL_PROGRAMS) 상태에서는 실제 프로그램이 아니므로 첫 프로그램으로.
      const presetPid = (currentProgramId && currentProgramId !== ALL_PROGRAMS) ? currentProgramId : (programs[0] && programs[0].id);
      psel.value = presetPid || '';
      fillAppGradeOptions('');
      fillAppClassOptions('', '');
      form.is_multicultural.checked = false;
    }
    updateAppMcVisibility();
    dlg.classList.add('open');
  }

  $('#app-grade-select').addEventListener('change', (e) => {
    fillAppClassOptions(e.target.value, '');
  });
  // 프로그램 변경 시 다문화 체크 노출 갱신(select 엘리먼트는 유지되고 옵션만 바뀌므로 1회 바인딩)
  $('#applicant-form').program_id.addEventListener('change', updateAppMcVisibility);

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
      motivation: form.motivation.value.trim(),
      status: form.status.value,
      // 다문화 우대형 프로그램일 때만 의미. 숨겨진 경우 체크 해제 상태이므로 false.
      is_multicultural: form.is_multicultural.checked,
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

  // ===== 학생 참고기록(노쇼/태도) 모달 =====
  function fmtNoteDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function renderNoteHistory(notes) {
    const list = (notes || []).slice().reverse(); // 최신 먼저
    if (!list.length) {
      return '<p class="muted" style="margin:8px 0;">아직 기록이 없습니다.</p>';
    }
    return list.map(n => {
      const pol = polarityOf(n);
      return `
      <div class="note-item ${POLARITY_CLASS[pol] || 'pol-neu'}">
        <div class="note-item-head">
          <span class="note-type-tag">${NOTE_TYPE_LABELS[n.note_type] || NOTE_TYPE_LABELS.etc}</span>
          <span class="muted">${esc(fmtNoteDate(n.created_at))} · ${esc(n.created_by || '?')}</span>
        </div>
        ${n.content ? `<div class="note-item-body">${esc(n.content)}</div>` : ''}
      </div>`;
    }).join('');
  }
  function openNoteDialog(appId) {
    const a = applications.find(x => x.id === appId);
    if (!a) return;
    noteTarget = {
      student_name: a.student_name,
      grade: a.grade ?? null,
      class_no: a.class_no ?? null,
      guardian_contact: a.guardian_phone || null,
      program_id: a.program_id || null,
    };
    $('#note-target-info').innerHTML =
      `<b>${esc(a.student_name)}</b> (${a.grade ?? '?'}-${a.class_no ?? '?'})`;
    $('#note-history').innerHTML = renderNoteHistory(
      matchedNotes(a.student_name, a.grade, a.class_no, a.guardian_phone));
    $('#note-type').innerHTML = noteTypeOptionsHtml();
    $('#note-type').value = 'excellent';
    $('#note-content').value = '';
    $('#note-dialog').classList.add('open');
  }
  $('#note-save')?.addEventListener('click', async () => {
    if (!noteTarget) return;
    const note_type = $('#note-type').value;
    const polarity = NOTE_TYPE_POLARITY[note_type] || '중립';
    const content = $('#note-content').value.trim();
    try {
      await api('/student-notes', {
        method: 'POST',
        body: JSON.stringify({ ...noteTarget, note_type, polarity, content }),
      });
      toast('기록을 저장했습니다');
      await loadStudentNotes();
      renderApplications();
      // 모달은 열어둔 채 이력 갱신(방금 추가분 즉시 확인)
      $('#note-history').innerHTML = renderNoteHistory(
        matchedNotes(noteTarget.student_name, noteTarget.grade, noteTarget.class_no, noteTarget.guardian_contact));
      $('#note-content').value = '';
    } catch (err) { toast(err.message); }
  });

  // ===== 문의사항 게시판 (관리자 전용) =====
  let inquiries = [];
  let inquiryFilter = 'all'; // all | pending | answered

  async function refreshInquiries() {
    const j = await api('/inquiries');
    inquiries = j.data || [];
    updateInquiryBadge();
  }
  function updateInquiryBadge() {
    const pending = inquiries.filter(x => !x.answered).length;
    const badge = $('#inq-badge');
    if (!badge) return;
    if (pending > 0) { badge.textContent = pending; badge.hidden = false; }
    else { badge.hidden = true; }
  }
  async function loadInquiriesTab() {
    try { await refreshInquiries(); renderInquiries(); }
    catch (err) { toast(err.message); }
  }
  function renderInquiries() {
    $$('[data-inq-filter]').forEach(b => b.classList.toggle('active', b.dataset.inqFilter === inquiryFilter));
    let list = inquiries.slice(); // 서버에서 신청일시 내림차순 정렬됨
    if (inquiryFilter === 'pending') list = list.filter(x => !x.answered);
    else if (inquiryFilter === 'answered') list = list.filter(x => x.answered);

    const pending = inquiries.filter(x => !x.answered).length;
    $('#inq-count').textContent = `전체 ${inquiries.length}건 · 대기 ${pending}건`;

    const tbody = $('#inquiries-tbody');
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">문의사항이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(x => `
      <tr>
        <td>${esc(x.program_title)}</td>
        <td><b>${esc(x.student_name)}</b><br><span class="muted" style="font-size:11px;">${x.grade ?? '?'}-${x.class_no ?? '?'}</span></td>
        <td>${esc(x.guardian_name || '')}<br><span class="muted">${esc(x.guardian_phone || '')}</span></td>
        <td style="white-space:normal; max-width:380px; word-break:break-word;">${esc(x.motivation)}</td>
        <td>${fmtTime(x.submitted_at)}</td>
        <td>
          ${x.answered
            ? `<span class="badge open">답변함</span>${x.answered_at ? `<br><span class="muted" style="font-size:11px;">${fmtTime(x.answered_at)}</span>` : ''}`
            : `<span class="badge" style="background:#FEF3C7; color:#92400E;">대기</span>`}
          <br><button class="btn small" data-inq-toggle="${esc(x.id)}" data-answered="${x.answered ? '1' : '0'}">${x.answered ? '대기로' : '답변함'}</button>
        </td>
      </tr>`).join('');

    $$('[data-inq-toggle]').forEach(el => el.addEventListener('click', async () => {
      const id = el.dataset.inqToggle;
      const next = el.dataset.answered !== '1';
      try {
        await api('/inquiries/status', { method: 'POST', body: JSON.stringify({ application_id: id, answered: next }) });
        toast(next ? '답변함으로 표시했습니다' : '대기로 되돌렸습니다');
        await refreshInquiries();
        renderInquiries();
      } catch (err) { toast(err.message); }
    }));
  }
  $$('[data-inq-filter]').forEach(b => b.addEventListener('click', () => {
    inquiryFilter = b.dataset.inqFilter;
    renderInquiries();
  }));

  // ===== 학생 기록 게시판 (관리자 전용) =====
  let studentBoard = [];
  let sbSort = 'name';     // name | stamps | pos | neg | recent
  let sbFilter = 'all';    // all | neg | pos
  let sbCurrent = null;    // 상세에서 보고 있는 학생

  async function loadStudentBoardTab() {
    try {
      const j = await api('/student-board');
      studentBoard = j.data || [];
      renderStudentBoard();
    } catch (err) { toast(err.message); }
  }
  function sbComparator(a, b) {
    if (sbSort === 'stamps') return (b.stamp_count - a.stamp_count) || a.name.localeCompare(b.name);
    if (sbSort === 'pos') return (b.pos_count - a.pos_count) || a.name.localeCompare(b.name);
    if (sbSort === 'neg') return (b.neg_count - a.neg_count) || a.name.localeCompare(b.name);
    if (sbSort === 'recent') return String(b.recent_note_at || '').localeCompare(String(a.recent_note_at || '')) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name); // name
  }
  function renderStudentBoard() {
    const selSort = $('#sb-sort'); if (selSort) selSort.value = sbSort;
    const selFilter = $('#sb-filter'); if (selFilter) selFilter.value = sbFilter;
    let list = studentBoard.slice();
    if (sbFilter === 'neg') list = list.filter(s => s.neg_count > 0);
    else if (sbFilter === 'pos') list = list.filter(s => s.pos_count > 0);
    list.sort(sbComparator);
    $('#sb-count').textContent = `${list.length}명`;
    const tbody = $('#student-board-tbody');
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty-state">학생이 없습니다.</td></tr>`; return; }
    tbody.innerHTML = list.map(s => `
      <tr data-sb-key="${esc(s.key)}" style="cursor:pointer;">
        <td><b>${esc(s.name)}</b></td>
        <td>${s.grade ?? '?'}-${s.class_no ?? '?'}</td>
        <td><span class="muted">${esc(s.guardian_phone || '')}</span></td>
        <td>${s.stamp_count}</td>
        <td>${s.applied_count}<span class="muted"> / 선정 ${s.selected_count}</span></td>
        <td>${s.pos_count ? `<span class="pol-badge pol-pos">👍 ${s.pos_count}</span>` : '<span class="muted">0</span>'}</td>
        <td>${s.neg_count ? `<span class="pol-badge pol-neg">⚠ ${s.neg_count}</span>` : '<span class="muted">0</span>'}</td>
        <td><span class="muted">${s.recent_note_at ? esc(fmtNoteDate(s.recent_note_at)) : '—'}</span></td>
      </tr>`).join('');
    $$('[data-sb-key]').forEach(tr => tr.addEventListener('click', () => openStudentDetail(tr.dataset.sbKey)));
  }
  $('#sb-sort')?.addEventListener('change', (e) => { sbSort = e.target.value; renderStudentBoard(); });
  $('#sb-filter')?.addEventListener('change', (e) => { sbFilter = e.target.value; renderStudentBoard(); });

  function renderStudentDetail(s) {
    const progHtml = (s.programs || []).length
      ? s.programs.map(p => `<li>${p.stamped ? '🌱' : '·'} ${esc(p.title || '(제목 없음)')}${p.selected ? ' <span class="pol-badge pol-pos">선정</span>' : ''}${p.stamped ? ' <span class="pol-badge" style="background:#E8F5E9;color:#2E7D32;">이수</span>' : ''}</li>`).join('')
      : '<li class="muted">신청·이수 기록이 없습니다.</li>';
    const timeline = (s.notes || []).length
      ? s.notes.slice().reverse().map(n => `
        <div class="note-item ${POLARITY_CLASS[n.polarity] || 'pol-neu'}">
          <div class="note-item-head">
            <span class="note-type-tag">${NOTE_TYPE_LABELS[n.note_type] || NOTE_TYPE_LABELS.etc}</span>
            <span class="muted">${esc(fmtNoteDate(n.created_at))} · ${esc(n.created_by || '?')}</span>
          </div>
          ${n.content ? `<div class="note-item-body">${esc(n.content)}</div>` : ''}
        </div>`).join('')
      : '<p class="muted" style="margin:6px 0;">아직 기록이 없습니다.</p>';
    $('#sb-detail-info').innerHTML =
      `<b>${esc(s.name)}</b> (${s.grade ?? '?'}-${s.class_no ?? '?'}) · ${esc(s.guardian_phone || '연락처 없음')}
       · 이수 ${s.stamp_count} · 신청 ${s.applied_count}/선정 ${s.selected_count}
       · <span class="pol-pos" style="font-weight:700;">긍정 ${s.pos_count}</span> / <span class="pol-neg" style="font-weight:700;">부정 ${s.neg_count}</span>`;
    $('#sb-programs').innerHTML = progHtml;
    $('#sb-timeline').innerHTML = timeline;
  }
  function openStudentDetail(key) {
    const s = studentBoard.find(x => x.key === key);
    if (!s) return;
    sbCurrent = s;
    renderStudentDetail(s);
    $('#sb-note-type').innerHTML = noteTypeOptionsHtml();
    $('#sb-note-type').value = 'excellent';
    $('#sb-note-content').value = '';
    $('#sb-detail').classList.add('open');
  }
  $('#sb-note-save')?.addEventListener('click', async () => {
    if (!sbCurrent) return;
    const note_type = $('#sb-note-type').value;
    const polarity = NOTE_TYPE_POLARITY[note_type] || '중립';
    const content = $('#sb-note-content').value.trim();
    try {
      await api('/student-notes', {
        method: 'POST',
        body: JSON.stringify({
          student_name: sbCurrent.name, grade: sbCurrent.grade, class_no: sbCurrent.class_no,
          guardian_contact: sbCurrent.guardian_phone || null, note_type, polarity, content,
        }),
      });
      toast('기록을 저장했습니다');
      const key = sbCurrent.key;
      await loadStudentBoardTab();          // 집계 갱신
      const s = studentBoard.find(x => x.key === key);
      if (s) { sbCurrent = s; renderStudentDetail(s); }
      $('#sb-note-content').value = '';
    } catch (err) { toast(err.message); }
  });

  // ===== 석암새싹증(누적 이수증) — completion_stamps 기반, 매번 재생성(인쇄용) =====
  // 호칭 기준(참가확인증 TITLE 과 동일 유지). 이상이면 호칭, 미만은 '새싹 회원'.
  const SAESSAK_TITLE = { 새싹왕: 10, 새싹신: 20 };
  function saessakTitleForCount(n) {
    let best = '새싹 회원', bestN = -1;
    Object.keys(SAESSAK_TITLE).forEach(name => { const v = SAESSAK_TITLE[name]; if (n >= v && v > bestN) { best = name; bestN = v; } });
    return best;
  }
  function periodText(p) {
    try { const t = window.SaessakSchedule && window.SaessakSchedule.format(p); if (t) return t; } catch (e) {}
    return p.schedule || '';
  }
  function issueSaessakCert(s) {
    const stamped = (s.programs || []).filter(p => p.stamped);
    if (!stamped.length) { toast('이수(도장)한 프로그램이 없어 발급할 수 없습니다.'); return; }
    const count = stamped.length;
    const title = saessakTitleForCount(count);
    const now = new Date();
    const z = n => String(n).padStart(2, '0');
    const issueDate = `${now.getFullYear()}. ${z(now.getMonth() + 1)}. ${z(now.getDate())}`;
    const sub = [s.grade ? s.grade + '학년' : '', s.class_no ? s.class_no + '반' : ''].filter(Boolean).join(' ');
    const rows = stamped.map((p, i) => `
      <tr>
        <td class="c-no">${i + 1}</td>
        <td class="c-prog">${esc(p.title || '(제목 없음)')}</td>
        <td class="c-period">${esc(periodText(p) || '-')}</td>
        <td class="c-seal"><span class="seal">이수</span></td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>석암새싹증</title>
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif; color: #16341c; background: #f4f7f4; margin: 0; }
.toolbar { position: sticky; top: 0; background: #2E7D32; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; font-size: 14px; }
.toolbar button { background:#fff; color:#2E7D32; border:0; border-radius:8px; padding:8px 16px; font-weight:800; cursor:pointer; }
.sheet { max-width: 200mm; margin: 14px auto; padding: 0 6px; }
.cert { background:#fff; border:3px solid #2E7D32; border-radius:18px; padding:32px 34px; position:relative; }
.cert-head { text-align:center; border-bottom:2px dashed #A5D6A7; padding-bottom:14px; margin-bottom:18px; }
.cert-school { font-size:15px; font-weight:800; color:#2E7D32; letter-spacing:.5px; }
.cert-title { font-size:30px; font-weight:900; color:#1B5E20; margin-top:8px; letter-spacing:6px; }
.cert-name-wrap { text-align:center; margin-bottom:8px; }
.cert-name { font-size:30px; font-weight:900; color:#14331a; }
.cert-sub { font-size:14px; color:#5b6b5e; margin-top:2px; }
.cert-count { text-align:center; font-size:15px; color:#2E7D32; font-weight:800; margin:10px 0 4px; }
.cert-count b { font-size:24px; }
.cert-rank { text-align:center; margin-bottom:16px; }
.cert-rank .badge { display:inline-block; background:#FFF3E0; color:#E65100; border:1.5px solid #FFB74D; border-radius:999px; padding:5px 16px; font-size:16px; font-weight:800; }
table { width:100%; border-collapse:collapse; font-size:14.5px; }
th, td { padding:9px 10px; border-bottom:1px solid #E0EAE0; text-align:left; }
th { color:#2E7D32; font-weight:800; background:#F1F8E9; }
.c-no { width:42px; text-align:center; color:#6b7b6e; }
.c-period { color:#5b6b5e; font-size:13px; }
.c-seal { width:64px; text-align:center; }
.seal { display:inline-block; border:2px solid #E53935; color:#E53935; border-radius:50%; width:42px; height:42px; line-height:38px; font-weight:800; font-size:13px; transform: rotate(-10deg); }
.cert-msg { margin-top:20px; text-align:center; font-size:13.5px; color:#558B2F; font-weight:700; }
.cert-foot { margin-top:22px; text-align:center; font-size:13px; color:#33491f; }
@media print { body { background:#fff; } .toolbar { display:none !important; } .sheet { max-width:none; margin:0; padding:0; } }
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">🖨 인쇄 / PDF 저장</button><span>미리보기 — 인쇄 대화상자에서 ‘PDF로 저장’ 가능</span></div>
<div class="sheet"><div class="cert">
  <div class="cert-head"><div class="cert-school">🌱 석암초등학교 디지털새싹</div><div class="cert-title">석암새싹증</div></div>
  <div class="cert-name-wrap"><div class="cert-name">${esc(s.name)}</div>${sub ? `<div class="cert-sub">${esc(sub)}</div>` : ''}</div>
  <div class="cert-count">위 학생은 디지털새싹 프로그램 <b>${count}</b>개를 성실히 이수하였기에 이 증서를 드립니다.</div>
  <div class="cert-rank"><span class="badge">🏅 ${esc(title)}</span></div>
  <table><thead><tr><th class="c-no">#</th><th>이수 프로그램</th><th>기간</th><th class="c-seal">도장</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="cert-msg">디지털새싹을 모을수록 나의 새싹이 무럭무럭 자라요 🌱 다음 새싹에서 또 만나요!</div>
  <div class="cert-foot">${issueDate}<br><b>석암초등학교 디지털새싹</b></div>
</div></div></body></html>`;
    const win = window.open('', '_blank');
    if (!win) { toast('팝업이 차단되어 증서 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.'); return; }
    win.document.open(); win.document.write(html); win.document.close();
  }
  $('#sb-cert-btn')?.addEventListener('click', () => { if (sbCurrent) issueSaessakCert(sbCurrent); });

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

  // ===== 일정 달력 탭 (보기 전용) =====
  // 6월 2026 중심. session_dates 가 있는 프로그램만 표시.
  let scheduleYear = 2026;
  let scheduleMonth = 5; // 0-indexed → June
  // 달력에서 숨길 프로그램 id 집합(체크 해제된 것). 비어 있으면 전체 표시.
  // 상태 저장 안 함 — 탭 진입/새로고침 시 항상 전체 표시로 초기화.
  let scheduleHiddenIds = new Set();

  // 프로그램 블록 색 팔레트 — 차분한 파스텔 + 진한 텍스트(가독성).
  // id 해시로 안정 배정(같은 프로그램은 항상 같은 색).
  // 인접 항목이 서로 충분히 다른 색이 되도록 색상환을 번갈아 배치(청록↔코랄↔블루↔앰버…).
  // 초록 계열(라임·민트)은 멀리 떨어뜨려, 프로그램 10개 안에선 초록이 1개만 쓰이게 한다.
  const PROGRAM_PALETTE = [
    { bg: '#A7F0E8', fg: '#0F766E' }, // 0 청록
    { bg: '#FECACA', fg: '#9F1239' }, // 1 코랄
    { bg: '#BFDBFE', fg: '#1E3A8A' }, // 2 블루
    { bg: '#FDE68A', fg: '#92400E' }, // 3 앰버
    { bg: '#DDD6FE', fg: '#5B21B6' }, // 4 보라
    { bg: '#D9F99D', fg: '#365314' }, // 5 라임
    { bg: '#FBCFE8', fg: '#9D174D' }, // 6 핑크
    { bg: '#FED7AA', fg: '#9A3412' }, // 7 살구
    { bg: '#BAE6FD', fg: '#0C4A6E' }, // 8 스카이
    { bg: '#E9D5FF', fg: '#6B21A8' }, // 9 라벤더
    { bg: '#A7F3D0', fg: '#065F46' }, // 10 민트
    { bg: '#FDD3D8', fg: '#881337' }, // 11 로즈
  ];
  // 색 배정: 프로그램 목록(programs) 내 위치 순서대로 팔레트를 부여 → 서로 다른 프로그램은
  // 항상 다른(인접해도 잘 구분되는) 색을 받는다. 목록에 없으면 해시로 폴백.
  function programColor(p) {
    const idx = Array.isArray(programs) ? programs.findIndex(x => String(x.id) === String(p.id)) : -1;
    if (idx >= 0) return PROGRAM_PALETTE[idx % PROGRAM_PALETTE.length];
    const id = String(p.id || p.title || '');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h * 31) + id.charCodeAt(i)) >>> 0;
    return PROGRAM_PALETTE[h % PROGRAM_PALETTE.length];
  }
  function isoOf(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  async function loadScheduleTab() {
    try {
      const j = await api('/programs');
      programs = j.data || [];
      scheduleHiddenIds = new Set(); // 탭 진입 시 전체 표시 기본
      renderScheduleCalendar();
    } catch (err) { toast(err.message); }
  }

  function renderScheduleCalendar() {
    const grid = $('#cal-grid');
    const label = $('#sched-month-label');
    if (!grid || !label) return;
    label.textContent = `${scheduleYear}년 ${scheduleMonth + 1}월`;

    const firstDow = new Date(scheduleYear, scheduleMonth, 1).getDay();
    const daysInMonth = new Date(scheduleYear, scheduleMonth + 1, 0).getDate();
    const daysInPrev   = new Date(scheduleYear, scheduleMonth, 0).getDate();

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const offset = i - firstDow;
      let y, m, d, other;
      if (offset < 0) {
        m = scheduleMonth === 0 ? 11 : scheduleMonth - 1;
        y = scheduleMonth === 0 ? scheduleYear - 1 : scheduleYear;
        d = daysInPrev + offset + 1;
        other = true;
      } else if (offset >= daysInMonth) {
        m = scheduleMonth === 11 ? 0 : scheduleMonth + 1;
        y = scheduleMonth === 11 ? scheduleYear + 1 : scheduleYear;
        d = offset - daysInMonth + 1;
        other = true;
      } else {
        y = scheduleYear; m = scheduleMonth; d = offset + 1; other = false;
      }
      cells.push({ y, m, d, other });
    }

    const withSessions = programs.filter(p =>
      (Array.isArray(p.session_dates) && p.session_dates.length > 0) ||
      (Array.isArray(p.extra_sessions) && p.extra_sessions.length > 0));
    // 표시 필터 UI(전체 프로그램 기준)와 실제 표시 대상(체크된 것만) 분리
    renderScheduleFilter(withSessions);
    const visiblePrograms = withSessions.filter(p => !scheduleHiddenIds.has(String(p.id)));
    // "HH:MM"(24시간제) → 분. 시간 없으면 맨 뒤로(Infinity).
    const toMin = (s) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
    };
    const eventsByDate = {};
    visiblePrograms.forEach(p => {
      const color = programColor(p);
      const mainTime = (p.start_time && p.end_time) ? `${p.start_time}~${p.end_time}` : (p.start_time || '');
      (Array.isArray(p.session_dates) ? p.session_dates : []).forEach(iso => {
        (eventsByDate[iso] = eventsByDate[iso] || []).push({ p, color, time: mainTime, extra: false, startMin: toMin(p.start_time) });
      });
      // 보충 회차도 블록으로 표시(개별 시간, 보충 표기)
      (Array.isArray(p.extra_sessions) ? p.extra_sessions : []).forEach(x => {
        if (!x || !x.date) return;
        const t = (x.start && x.end) ? `${x.start}~${x.end}` : (x.start || '');
        (eventsByDate[x.date] = eventsByDate[x.date] || []).push({ p, color, time: t, extra: true, startMin: toMin(x.start) });
      });
    });

    const now = new Date();
    const todayIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

    grid.innerHTML = cells.map(c => {
      const iso = isoOf(c.y, c.m, c.d);
      const isToday = iso === todayIso;
      // 렌더 직전 정렬: 같은 날 블록을 시작 시각(분) 오름차순으로. 같은 시각이면 보충을 뒤로.
      const evs = (eventsByDate[iso] || []).slice().sort((a, b) =>
        (a.startMin - b.startMin) || (Number(a.extra) - Number(b.extra)));
      const evHtml = evs.map(({ p, color, time, extra }) => {
        const inst = p.instructors || '';
        const org  = p.organization || '';
        const teacherLine = [inst, org].filter(Boolean).join(' · ');
        const titleText = `${p.title}${extra ? ' (보충)' : ''}`;
        const tip = `${titleText}${time ? ' · ' + time : ''}${inst ? ' · ' + inst : ''}${org ? ' · ' + org : ''}`;
        return `<div class="cal-event${extra ? ' cal-event-extra' : ''}" style="background:${color.bg}; color:${color.fg}; border-color:${color.fg}33" title="${esc(tip)}">
          <div class="ev-title">${extra ? '🔁 ' : ''}${esc(p.title)}${extra ? ' <span style="font-weight:600;">(보충)</span>' : ''}</div>
          ${time ? `<div class="ev-time">${esc(time)}</div>` : ''}
          ${teacherLine ? `<div class="ev-inst">${esc(teacherLine)}</div>` : ''}
        </div>`;
      }).join('');
      const cls = ['cal-cell'];
      if (c.other) cls.push('other-month');
      if (isToday) cls.push('today');
      return `<div class="${cls.join(' ')}"><div class="cal-day-num">${c.d}</div>${evHtml}</div>`;
    }).join('');

    // 범례: 이번 달에 일정이 있는 프로그램만
    const monthIso = (iso) => {
      const [y, m] = iso.split('-').map(Number);
      return y === scheduleYear && m === scheduleMonth + 1;
    };
    const monthPrograms = visiblePrograms.filter(p =>
      (Array.isArray(p.session_dates) && p.session_dates.some(monthIso)) ||
      (Array.isArray(p.extra_sessions) && p.extra_sessions.some(x => x && monthIso(x.date))));
    $('#cal-legend').innerHTML = monthPrograms.length === 0
      ? '<span class="muted">이 달에는 표시할 일정이 없습니다.</span>'
      : monthPrograms.map(p =>
          (() => {
            const c = programColor(p);
            return `<span class="lg" style="background:${c.bg}; color:${c.fg}"><span class="lg-color" style="background:${c.fg}"></span>${esc(p.title)}</span>`;
          })()
        ).join('');
  }

  // 프로그램 표시 필터 — session_dates 가 있는 모든 프로그램을 체크박스로 나열(색 스와치 포함).
  // 기본 전체 체크. 체크 해제하면 scheduleHiddenIds 에 담겨 달력에서 숨겨진다.
  function renderScheduleFilter(withSessions) {
    const box = $('#cal-filter');
    if (!box) return;
    if (!withSessions || withSessions.length === 0) { box.innerHTML = ''; return; }
    const items = withSessions.map(p => {
      const c = programColor(p);
      const id = esc(String(p.id));
      const checked = scheduleHiddenIds.has(String(p.id)) ? '' : 'checked';
      return `<label class="cf-item">
        <input type="checkbox" class="cf-cb" data-cf-id="${id}" ${checked}>
        <span class="cf-color" style="background:${c.bg}; border-color:${c.fg}"></span>
        <span class="cf-name">${esc(p.title)}</span>
      </label>`;
    }).join('');
    box.innerHTML = `
      <div class="cf-head">
        <span class="cf-title">📌 달력에 표시할 프로그램</span>
        <button type="button" class="btn xsmall" id="cf-all">전체 선택</button>
        <button type="button" class="btn xsmall" id="cf-none">전체 해제</button>
      </div>
      <div class="cf-list">${items}</div>`;
  }

  // 월 이동
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'sched-prev') {
      if (scheduleMonth === 0) { scheduleMonth = 11; scheduleYear--; }
      else scheduleMonth--;
      renderScheduleCalendar();
    } else if (e.target && e.target.id === 'sched-next') {
      if (scheduleMonth === 11) { scheduleMonth = 0; scheduleYear++; }
      else scheduleMonth++;
      renderScheduleCalendar();
    } else if (e.target && e.target.id === 'sched-today') {
      const n = new Date();
      scheduleYear = n.getFullYear();
      scheduleMonth = n.getMonth();
      renderScheduleCalendar();
    } else if (e.target && e.target.id === 'cf-all') {
      scheduleHiddenIds.clear();
      renderScheduleCalendar();
    } else if (e.target && e.target.id === 'cf-none') {
      programs
        .filter(p => Array.isArray(p.session_dates) && p.session_dates.length > 0)
        .forEach(p => scheduleHiddenIds.add(String(p.id)));
      renderScheduleCalendar();
    }
  });

  // 프로그램 표시 체크박스 토글 — 실시간 반영
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('cf-cb')) {
      const id = t.dataset.cfId;
      if (t.checked) scheduleHiddenIds.delete(id);
      else scheduleHiddenIds.add(id);
      renderScheduleCalendar();
    }
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
    startDashboardAutoRefresh();
    // 미답변 문의 개수 배지 초기 표시(탭 방문 전에도 보이게)
    try { await refreshInquiries(); } catch {}
  })();
})();
