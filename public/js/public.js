(() => {
  // 학년별 반 개수 (반 개수 바뀌면 이 한 곳만 수정) — 1·2학년 6반, 3학년 7반, 4학년 8반, 5·6학년 7반
  const CLASS_COUNT = { 1: 6, 2: 6, 3: 7, 4: 8, 5: 7, 6: 7 };
  const GRADE_LIST = Object.keys(CLASS_COUNT).map(Number).sort((a, b) => a - b);

  function recruitStatusOf(p) {
    if (p && p.recruit_status) return p.recruit_status;
    return p && p.is_open ? 'recruiting' : 'hidden';
  }

  // 모집 상태 정렬 우선순위: 모집중(신청 가능) 0 → 모집예정 1 → 모집마감 2 → 모집종료 3(맨 아래).
  // 정원+대기 자동소진(is_fully_closed)도 마감으로 간주.
  function recruitRank(p) {
    const st = recruitStatusOf(p);
    if (st === 'closed') return 3;
    if (st === 'full' || p.is_fully_closed) return 2;
    if (st === 'upcoming') return 1;
    return 0; // recruiting (대기 접수 포함 — 신청 가능)
  }
  // 안정 정렬: 같은 상태 내에선 기존(created_at) 순서 유지.
  function sortByRecruit(list) {
    return list
      .map((p, i) => [p, i])
      .sort((a, b) => (recruitRank(a[0]) - recruitRank(b[0])) || (a[1] - b[1]))
      .map(x => x[0]);
  }

  // === 운영 문구 ===
  const PRIVACY_TEXT = {
    intro: '다음 개인정보 수집·이용 및 초상권에 동의하십니까?',
    items: [
      '수집·이용 목적: 출석부 작성, 학생 관리, 결과보고서 제출',
      '수집 항목: 학년, 반, 번호, 학생 성명, 보호자 성명, 보호자 휴대폰 번호, 학생과의 관계',
      '이용·보유 기간 및 처리 방법: 2026. 6. 1. ~ 2027. 2. 28. (이용 기간 후 파기)',
      '교육 활동 과정 및 결과에 참여 학생 얼굴이 나올 수 있습니다.',
    ],
  };

  // === 휴대폰 포맷팅/검증 ===
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
    input.setAttribute('placeholder', '010-XXXX-XXXX');
    input.addEventListener('input', () => {
      const f = formatPhone(input.value);
      if (input.value !== f) input.value = f;
    });
  }

  // === 공용 유틸 ===
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // 강사명: 콤마/공백 어떤 입력이든 콤마 없이 공백 한 칸으로만 구분.
  // 각 이름은 .inst(inline-block+nowrap)로 감싸 이름 중간에서 안 끊기게.
  function instructorsHtml(raw) {
    const names = String(raw || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return '';
    return names.map(n => `<span class="inst">${esc(n)}</span>`).join(' ');
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return iso; }
  }
  function typesOf(p) {
    const m = (typeof p.is_type_multicultural === 'boolean') ? p.is_type_multicultural : (p.program_type === 'multicultural');
    const s = (typeof p.is_type_sibling === 'boolean')       ? p.is_type_sibling       : (p.program_type === 'sibling');
    return { multicultural: m, sibling: s };
  }
  function isMulticulturalProgram(p) {
    return !!(p && typesOf(p).multicultural);
  }
  function typeBadges(p) {
    const t = typesOf(p);
    const out = [];
    if (t.multicultural) out.push('<span class="badge tag-multicultural">다문화 우대</span>');
    if (t.sibling)       out.push('<span class="badge tag-sibling">형제 우대</span>');
    const custom = (p && p.type_custom && String(p.type_custom).trim() !== '') ? String(p.type_custom).trim() : null;
    if (custom)          out.push(`<span class="badge tag-custom">${esc(custom)}</span>`);
    return out.join(' ');
  }
  function formatGradesLabel(grades) {
    if (!Array.isArray(grades) || grades.length === 0) return '';
    const sorted = [...new Set(grades.map(Number))].sort((a, b) => a - b);
    const contiguous = sorted.length >= 2 && sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (contiguous) return `${sorted[0]}~${sorted[sorted.length - 1]}학년`;
    return `${sorted.join(',')}학년`;
  }
  function gradeIncluded(p, g) {
    return Array.isArray(p.grades) && p.grades.map(Number).includes(Number(g));
  }
  // 학생 s 가 이미 선택한 다른 프로그램 중 p 와 시간이 충돌하는 것 (있으면 그 프로그램 객체, 없으면 null)
  function conflictForStudent(p, s) {
    if (!window.SaessakConflict) return null;
    for (const otherPid of s.selected) {
      if (otherPid === p.id) continue;
      const other = programs.find(x => x.id === otherPid);
      if (other && window.SaessakConflict.programsConflict(p, other)) return other;
    }
    return null;
  }

  // === 상태 ===
  let programs = [];
  // students[i] = { id, selected:Set<programId>, cache:{name,grade,class_no,student_phone,motivation,is_multicultural}, same_as_prev:bool }
  const students = [];
  let counter = 0;
  const MAX_STUDENTS = 4;
  let activeGradeFilter = null; // null = 전체
  // 유형 필터: null=전체 | 'multicultural' | 'sibling' | 'custom:<type_custom 값>'
  // 고정 유형은 다문화·형제 2개뿐. 그 외(늘봄 등)는 type_custom 자유 입력이 칩으로 자동 반영.
  let activeTypeFilter = null;
  // 모집상태 필터: null=전체 | 'open'=모집중 | 'upcoming'=모집예정 | 'ended'=모집종료
  let activeStatusFilter = null;

  // === DOM ===
  const detailListEl = document.getElementById('program-detail-list');
  const studentsArea = document.getElementById('students-area');
  const programsArea = document.getElementById('programs-area');
  const summaryArea  = document.getElementById('summary-area');
  const form = document.getElementById('apply-form');
  const submitBtn = document.getElementById('submit-btn');
  const resultArea = document.getElementById('result-area');
  const studentTpl = document.getElementById('student-block-tpl');

  // === 학년/반 드롭다운 옵션 ===
  function populateGradeOptions(sel, currentVal) {
    const opts = ['<option value="">학년 선택</option>']
      .concat(GRADE_LIST.map(g => `<option value="${g}">${g}학년</option>`));
    sel.innerHTML = opts.join('');
    if (currentVal && CLASS_COUNT[currentVal]) sel.value = String(currentVal);
    else sel.value = '';
  }
  function populateClassOptions(sel, grade, currentVal) {
    const count = CLASS_COUNT[Number(grade)] || 0;
    if (!count) {
      sel.innerHTML = '<option value="">학년 먼저 선택</option>';
      sel.value = '';
      sel.disabled = true;
      return;
    }
    const opts = ['<option value="">반 선택</option>'];
    for (let i = 1; i <= count; i++) opts.push(`<option value="${i}">${i}반</option>`);
    sel.innerHTML = opts.join('');
    if (currentVal && Number(currentVal) >= 1 && Number(currentVal) <= count) {
      sel.value = String(currentVal);
    } else {
      sel.value = '';
    }
    sel.disabled = false;
  }

  // === 학생/학년 계산 ===
  function gradeOf(s) { return s && s.cache.grade ? s.cache.grade : ''; }
  function classOf(s) { return s && s.cache.class_no ? s.cache.class_no : ''; }
  function effGradeForStudent(idx) {
    const s = students[idx];
    if (!s) return null;
    const g = Number(s.cache.grade);
    return Number.isFinite(g) && g > 0 ? g : null;
  }
  function allStudentsEmpty() {
    if (students.length === 0) return true;
    return students.every((s, i) => {
      const noName = !(s.cache.name || '').trim();
      const noGrade = effGradeForStudent(i) == null;
      return noName && noGrade;
    });
  }
  function reconcileSelections() {
    // 자기 학년에 안 맞거나 모집중이 아닌 program_id를 selected에서 제거
    students.forEach((s, i) => {
      const g = effGradeForStudent(i);
      for (const pid of Array.from(s.selected)) {
        const p = programs.find(x => x.id === pid);
        if (!p) { s.selected.delete(pid); continue; }
        if (recruitStatusOf(p) !== 'recruiting') { s.selected.delete(pid); continue; }
        if (g != null && !gradeIncluded(p, g)) s.selected.delete(pid);
      }
    });
  }

  // === 유형 필터 ===
  function customTypeOf(p) {
    return (p && p.type_custom && String(p.type_custom).trim() !== '') ? String(p.type_custom).trim() : null;
  }
  function typeMatchesFilter(p) {
    if (activeTypeFilter == null) return true;
    if (activeTypeFilter === 'multicultural') return typesOf(p).multicultural === true;
    if (activeTypeFilter === 'sibling')       return typesOf(p).sibling === true;
    if (activeTypeFilter.startsWith('custom:')) {
      return customTypeOf(p) === activeTypeFilter.slice('custom:'.length);
    }
    return true;
  }

  // === 모집상태 필터 ===
  // 표시되는 모집상태를 칩 버킷으로 분류. 기존 recruitStatusOf + is_fully_closed 로직 재사용(새 기준 안 만듦).
  //  'open'     = 모집중 (대기접수·마감임박 포함, 아직 신청 받는 중)
  //  'upcoming' = 모집예정
  //  'ended'    = 정원참 마감 (full / is_fully_closed). '전체'에만 노출되며 '모집종료'(closed)는 isEndedForParents 로 이미 숨겨짐.
  // 학부모 화면 필터 칩에서 '모집종료' 버튼은 제거됨(전체/모집중/모집예정만). '전체'=숨김 규칙 적용된 전체.
  // hidden 은 서버에서 이미 제외되므로 공개 목록엔 들어오지 않음(공개 미노출 유지).
  function recruitBucketOf(p) {
    const status = recruitStatusOf(p);
    if (status === 'upcoming') return 'upcoming';
    if (status === 'closed') return 'ended';
    if (status === 'full' || p.is_fully_closed) return 'ended'; // 모집중이어도 정원+대기 자동소진 → 모집마감(종료)
    return 'open'; // recruiting & 아직 신청 받는 중
  }
  function statusMatchesFilter(p) {
    if (activeStatusFilter == null) return true;
    return recruitBucketOf(p) === activeStatusFilter;
  }

  // === 학부모 화면 숨김 규칙: 모집종료 프로그램은 목록에서 제외 ===
  // '모집종료' 판정 기준 = 기존 상태 로직의 recruit_status === 'closed'.
  //   (closed = 관리자가 모집을 종료 처리한 "지난 프로그램". 코드상 이미 하단 '지난 프로그램'
  //    구분선으로 분리되던 상태로, 사실상 "모집 기간이 지나 마감된 프로그램"에 해당한다.)
  // 정원참 마감(full / is_fully_closed)은 정원이 빠질 수 있으므로 숨기지 않고 '모집 마감' 배지로 계속 노출한다.
  // 이 규칙은 학부모 신청 화면(public.js)에만 적용되며, 관리자 목록(admin.js)은 전부 그대로 표시한다.
  function isEndedForParents(p) {
    return recruitStatusOf(p) === 'closed';
  }

  // === 학년 + 유형 + 모집상태 필터 (AND 조건) ===
  function filteredPrograms() {
    return programs.filter(p =>
      !isEndedForParents(p) &&
      (activeGradeFilter == null || gradeIncluded(p, activeGradeFilter)) &&
      typeMatchesFilter(p) &&
      statusMatchesFilter(p));
  }

  // === 상단: 안내 카드 ===
  function renderDetailList() {
    if (!programs.length) {
      detailListEl.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    const list = filteredPrograms();
    if (!list.length) {
      detailListEl.innerHTML = `<div class="empty-state">선택한 학년이 신청 가능한 프로그램이 없습니다.</div>`;
      return;
    }
    let pastDividerDone = false;
    detailListEl.innerHTML = list.map(p => {
      const status = recruitStatusOf(p);
      // 모집종료(closed)는 하단에 "지난 프로그램" 구분선으로 시각적 분리.
      let pastDivider = '';
      if (status === 'closed' && !pastDividerDone) {
        pastDividerDone = true;
        pastDivider = '<div class="past-divider"><span>지난 프로그램</span></div>';
      }
      // 마감: 관리자가 수동으로 건 full 또는 정원+대기 자동 소진(is_fully_closed) — 동일 도장 표시
      const isFull = status === 'full' || !!p.is_fully_closed;
      const isRecruiting = status === 'recruiting';
      const cardDisabled = !isRecruiting || isFull;
      // 마감임박: 모집중이면서 남은자리 1~5 (0은 마감이므로 제외). 남은자리는 기존 p.remaining 그대로.
      const isClosingSoon = isRecruiting && !isFull && p.remaining >= 1 && p.remaining <= 5;
      // 대기 접수: 모집중·정원(선착순) 마감·대기 여유(remaining<=0, 자동마감 아님). step2와 동일 기준 재사용.
      const isWaitOnly = isRecruiting && !isFull && p.remaining <= 0;
      const meta = [];
      const schedText = (window.SaessakSchedule && window.SaessakSchedule.format(p)) || p.schedule || '';
      if (schedText)     meta.push(`<span class="meta-item"><span class="meta-ic">📅</span>${esc(schedText)}</span>`);
      if (p.location)    meta.push(`<span class="meta-item"><span class="meta-ic">📍</span>${esc(p.location)}</span>`);
      if (p.instructors) meta.push(`<span class="meta-item"><span class="meta-ic">🧑‍🏫</span>${instructorsHtml(p.instructors)}</span>`);

      let statusBadge;
      if (status === 'upcoming')      statusBadge = '<span class="badge upcoming">⏰ 모집예정</span>';
      else if (status === 'closed')   statusBadge = '<span class="badge closed-admin">모집완료</span>';
      else if (isFull)                statusBadge = '<span class="badge full">모집 마감</span>';
      else if (isWaitOnly)            statusBadge = '<span class="badge waitlist-open">🕓 대기 접수 중</span>';
      else                            statusBadge = '<span class="badge open">모집중</span>';

      let seatsLine;
      if (status === 'upcoming') {
        seatsLine = `<span class="seats-upcoming">곧 모집이 열려요 — 잠시만 기다려 주세요</span>`;
      } else if (status === 'closed') {
        seatsLine = `<span class="seats-closed">모집이 종료되었습니다</span>`;
      } else if (isFull) {
        seatsLine = `<span class="seats-full">${p.is_fully_closed ? '정원·대기 모두 마감' : '정원이 마감되었습니다'}</span>`;
      } else if (p.remaining > 0) {
        seatsLine = `남은 자리 <strong>${p.remaining}명</strong> / 정원 ${p.capacity}명`;
      } else {
        seatsLine = `<span class="seats-waitlist">정원은 찼지만 대기로 신청할 수 있어요 · 현재 대기 <strong>${p.waitlist_count || 0}/${p.waitlist_capacity ?? 10}</strong></span>`;
      }
      const desc = (p.description || '').trim();
      const descBlock = desc
        ? `<details class="pc-details"><summary><span class="pc-toggle-text"></span></summary><div class="pc-body">${esc(desc)}</div></details>`
        : '';
      const reviewBtn = `<button type="button" class="pc-review-btn" data-review-view="${p.id}">💬 후기보기</button>`;
      return `
        ${pastDivider}
        <article class="program-card ${cardDisabled ? 'disabled' : ''} ${isFull ? 'is-full' : ''} ${isWaitOnly ? 'is-waitlist' : ''} status-${status}">
          ${isFull ? '<div class="pc-stamp" aria-label="모집마감">마감</div>' : ''}
          ${isClosingSoon ? `<div class="pc-soon">🔥 마감임박 ${p.remaining}자리</div>` : ''}
          <div class="pc-inner">
            <div class="pc-tags">
              ${statusBadge}
              ${typeBadges(p)}
              <span class="grade-badge">👶 ${formatGradesLabel(p.grades)}</span>
            </div>
            <h3 class="pc-title">${esc(p.title)}</h3>
            <div class="pc-meta-row">${meta.join('')}</div>
            <div class="pc-seats-line">${seatsLine}</div>
            ${descBlock}
            <div class="pc-review-row">${reviewBtn}</div>
          </div>
        </article>
      `;
    }).join('');

    detailListEl.querySelectorAll('[data-review-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = programs.find(x => String(x.id) === String(btn.dataset.reviewView));
        openReviewsModal(btn.dataset.reviewView, p ? p.title : '');
      });
    });
  }

  // === 후기보기 모달 (학부모/공개) ===
  function starsHtml(n) {
    const v = Math.round(n || 0);
    return '<span class="rvv-stars">' + '★'.repeat(v) + '☆'.repeat(5 - v) + '</span>';
  }
  // "{학년} {마스킹이름}" — 학년만/이름만이면 있는 것만, 둘 다 없으면 익명
  function reviewerLabel(r) {
    const g = (r.grade_label || '').trim();
    const n = (r.reviewer_masked || '').trim();
    if (g && n) return g + ' ' + n;
    return g || n || '익명';
  }
  function photoTypeLabel(t) {
    return t === 'with_person' ? '작품+본인' : t === 'work' ? '작품' : '';
  }
  function photoHtml(r) {
    if (!r.photo_url) return '';
    const tag = r.photo_type ? `<span class="rvv-photo-tag">${esc(photoTypeLabel(r.photo_type))}</span>` : '';
    return `<a class="rvv-photo" href="${esc(r.photo_url)}" target="_blank" rel="noopener">
      <img src="${esc(r.photo_url)}" alt="후기 사진" loading="lazy">${tag}</a>`;
  }
  async function openReviewsModal(programId, title) {
    const mask = document.getElementById('reviews-modal');
    const titleEl = document.getElementById('reviews-modal-title');
    const bodyEl = document.getElementById('reviews-modal-body');
    titleEl.textContent = title || '프로그램 후기';
    bodyEl.innerHTML = '<div class="rvv-state">불러오는 중…</div>';
    mask.classList.add('open');
    try {
      const res = await fetch(`/api/public/programs/${encodeURIComponent(programId)}/reviews`);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      const list = j.data || [];
      const s = j.summary || { count: 0, avg: null };
      if (!list.length) {
        bodyEl.innerHTML = '<div class="rvv-state">아직 등록된 후기가 없어요.</div>';
        return;
      }
      const summaryHtml = `
        <div class="rvv-summary">
          ${s.avg != null ? `<div class="rvv-avg"><span class="rvv-avg-num">${s.avg}</span>${starsHtml(s.avg)}</div>` : ''}
          <div class="rvv-count">후기 <strong>${s.count}</strong>개${s.avg != null ? ` · 별점 ${s.rated_count}개 평균` : ''}</div>
        </div>`;
      const itemsHtml = list.map(r => `
        <div class="rvv-item">
          <div class="rvv-head">
            <span class="rvv-who">${esc(reviewerLabel(r))}</span>
            ${r.rating ? starsHtml(r.rating) : ''}
            <span class="rvv-date">${esc((r.created_at || '').slice(0, 10))}</span>
          </div>
          <div class="rvv-content">${esc(r.content)}</div>
          ${photoHtml(r)}
        </div>`).join('');
      bodyEl.innerHTML = summaryHtml + '<div class="rvv-list">' + itemsHtml + '</div>';
    } catch (err) {
      bodyEl.innerHTML = `<div class="rvv-state">후기를 불러올 수 없어요.</div>`;
    }
  }
  // === 전체 후기 모음 모달 (메인 상단 버튼) ===
  async function openAllReviewsModal() {
    const mask = document.getElementById('reviews-modal');
    const titleEl = document.getElementById('reviews-modal-title');
    const bodyEl = document.getElementById('reviews-modal-body');
    titleEl.textContent = '📝 프로그램 후기 모음';
    bodyEl.innerHTML = '<div class="rvv-state">불러오는 중…</div>';
    mask.classList.add('open');
    try {
      const res = await fetch('/api/reviews');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      const list = j.data || [];
      if (!list.length) {
        bodyEl.innerHTML = '<div class="rvv-state">아직 등록된 후기가 없어요</div>';
        return;
      }
      const itemsHtml = list.map(r => `
        <div class="rvv-item">
          <div class="rvv-prog">${esc(r.program_title || '프로그램')}</div>
          <div class="rvv-head">
            <span class="rvv-who">${esc(reviewerLabel(r))}</span>
            ${r.rating ? starsHtml(r.rating) : ''}
            <span class="rvv-date">${esc((r.created_at || '').slice(0, 10))}</span>
          </div>
          <div class="rvv-content">${esc(r.content)}</div>
          ${photoHtml(r)}
        </div>`).join('');
      bodyEl.innerHTML = `<div class="rvv-count" style="margin-bottom:10px;">전체 후기 <strong>${list.length}</strong>개</div><div class="rvv-list">${itemsHtml}</div>`;
    } catch (err) {
      bodyEl.innerHTML = '<div class="rvv-state">후기를 불러올 수 없어요.</div>';
    }
  }
  window.__openAllReviews = openAllReviewsModal;
  window.__closeReviewsModal = () => document.getElementById('reviews-modal').classList.remove('open');

  // === 1단계: 학생 블록 ===
  function addStudent() {
    counter += 1;
    students.push({
      id: counter,
      selected: new Set(),
      cache: {},
    });
    renderStudents();
    renderStep2();
    renderSummary();
  }
  function removeStudent(id) {
    const idx = students.findIndex(s => s.id === id);
    if (idx < 0) return;
    students.splice(idx, 1);
    renderStudents();
    renderStep2();
    renderSummary();
  }

  function renderStudents() {
    studentsArea.innerHTML = '';
    const siblingTpl = document.getElementById('sibling-block-tpl');
    students.forEach((s, i) => {
      const tpl = i === 0 ? studentTpl : siblingTpl;
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.sid = s.id;
      node.querySelector('.idx').textContent = i === 0 ? '1 (본인)' : (i + 1);

      const rmBtn = node.querySelector('.remove-student');
      if (rmBtn) {
        if (students.length > 1) {
          rmBtn.hidden = false;
          rmBtn.addEventListener('click', () => removeStudent(s.id));
        } else {
          rmBtn.hidden = true;
        }
      }

      const nameInput = node.querySelector('.f-name');
      const gradeSel = node.querySelector('.f-grade');
      const classSel = node.querySelector('.f-class');

      nameInput.value = s.cache.name || '';
      populateGradeOptions(gradeSel, s.cache.grade);
      populateClassOptions(classSel, s.cache.grade, s.cache.class_no);

      nameInput.addEventListener('input', (e) => {
        s.cache.name = e.target.value.trim();
        renderStep2();
        renderSummary();
      });
      gradeSel.addEventListener('change', () => {
        s.cache.grade = gradeSel.value;
        // 학년 바꾸면 반 선택값 초기화하고 새 학년의 반 목록으로 갱신
        s.cache.class_no = '';
        populateClassOptions(classSel, s.cache.grade, '');
        reconcileSelections();
        renderStep2();
        renderSummary();
      });
      classSel.addEventListener('change', () => {
        s.cache.class_no = classSel.value;
        renderStep2();
        renderSummary();
      });

      // 형제·자매 추가 버튼 (마지막 블록에만, 4명 미만일 때)
      const addBtn = node.querySelector('.add-sibling-inline');
      const addHint = node.querySelector('.add-sibling-hint');
      if (addBtn) {
        const isLast = i === students.length - 1;
        const canAdd = isLast && students.length < MAX_STUDENTS;
        addBtn.hidden = !canAdd;
        if (addHint) addHint.hidden = !canAdd;
        addBtn.addEventListener('click', () => {
          if (students.length >= MAX_STUDENTS) {
            alert(`한 번에 최대 ${MAX_STUDENTS}명까지 신청할 수 있습니다.`);
            return;
          }
          addStudent();
        });
      }

      studentsArea.appendChild(node);
    });
  }

  // === 2단계: 프로그램 카드 + 학생 체크 ===
  function studentDisplayName(s, i) {
    const name = (s.cache.name || '').trim() || `학생 ${i + 1}`;
    const g = s.cache.grade || '';
    const c = s.cache.class_no || '';
    if (g && c) return `${name} ${g}-${c}`;
    if (g) return `${name} ${g}학년`;
    return name;
  }

  function renderStep2() {
    if (!programs.length) {
      programsArea.innerHTML = '<div class="empty-state">현재 모집 중인 프로그램이 없습니다.</div>';
      return;
    }
    if (students.length === 0) {
      programsArea.innerHTML = '<div class="empty-state muted">먼저 위에서 신청 학생을 등록해 주세요.</div>';
      return;
    }
    const noStudentInfo = allStudentsEmpty();
    const list = filteredPrograms();
    if (!list.length) {
      programsArea.innerHTML = `<div class="empty-state muted">선택한 학년이 신청 가능한 프로그램이 없습니다. 상단에서 다른 학년을 선택해 주세요.</div>`;
      return;
    }

    programsArea.innerHTML = list.map(p => {
      const status = recruitStatusOf(p);
      const isRecruiting = status === 'recruiting';
      // 마감: 수동 full 또는 자동마감(정원+대기 소진) — 동일 도장 표시
      const isFull = status === 'full' || !!p.is_fully_closed;
      const isWaitOnly = isRecruiting && !isFull && p.remaining <= 0;
      const cardBlocked = !isRecruiting || isFull;
      let statusTag;
      if (status === 'upcoming')      statusTag = '<span class="badge upcoming">⏰ 모집예정</span>';
      else if (status === 'closed')   statusTag = '<span class="badge closed-admin">모집완료</span>';
      else if (isFull)                statusTag = '<span class="badge full">마감</span>';
      else if (isWaitOnly)            statusTag = '<span class="badge waitlist-open">🕓 대기 접수 중</span>';
      else                            statusTag = '<span class="badge open">모집중</span>';
      const tags = [typeBadges(p), statusTag].filter(Boolean).join(' ');

      // 자격 학생 인덱스 (학년 + 시간충돌 모두 만족, recruiting 일 때만)
      const eligibleIdxs = [];
      if (isRecruiting) {
        students.forEach((s, i) => {
          const eff = effGradeForStudent(i);
          if (eff == null || !gradeIncluded(p, eff)) return;
          if (s.selected.has(p.id)) { eligibleIdxs.push(i); return; }
          if (!conflictForStudent(p, s)) eligibleIdxs.push(i);
        });
      }
      const allEligibleSelected = eligibleIdxs.length > 0 &&
        eligibleIdxs.every(i => students[i].selected.has(p.id));
      const selectAllLabel = allEligibleSelected ? '전체 해제' : '신청 가능한 학생 모두 선택';
      const selectAllDisabled = cardBlocked || eligibleIdxs.length === 0;

      let body;
      if (noStudentInfo) {
        body = `<div class="s2-empty-hint">먼저 위에서 신청 학생 정보를 입력해 주세요</div>`;
      } else {
        const studentRows = students.map((s, i) => {
          const eff = effGradeForStudent(i);
          const gradeOk = eff != null && gradeIncluded(p, eff);
          const checked = isRecruiting && s.selected.has(p.id);
          const conflictWith = (isRecruiting && !checked && gradeOk) ? conflictForStudent(p, s) : null;
          const disabled = cardBlocked || !gradeOk || !!conflictWith;
          const cls = ['s2-row'];
          if (checked) cls.push('selected');
          if (disabled) cls.push('disabled');
          const noGrade = eff == null;
          let reason = '';
          if (status === 'upcoming')   reason = '<span class="s2-note bad">아직 모집 전이라 신청할 수 없어요</span>';
          else if (status === 'closed') reason = '<span class="s2-note bad">모집이 종료된 프로그램이에요</span>';
          else if (noGrade)            reason = '<span class="s2-note">학년 입력 후 선택 가능</span>';
          else if (!gradeOk)           reason = '<span class="s2-note bad">대상 학년 아님</span>';
          else if (conflictWith)       reason = `<span class="s2-note bad">"${esc(conflictWith.title)}"과 시간이 겹쳐요</span>`;
          return `
            <label class="${cls.join(' ')}">
              <input type="checkbox" data-pid="${esc(p.id)}" data-sid="${s.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
              <span class="s2-name">${esc(studentDisplayName(s, i))}</span>
              ${reason}
            </label>
          `;
        }).join('');
        body = `
          <div class="s2-actions">
            <button type="button" class="s2-select-all" data-pid="${esc(p.id)}" ${selectAllDisabled ? 'disabled' : ''}>${selectAllLabel}</button>
          </div>
          <div class="s2-students">${studentRows}</div>
        `;
      }

      return `
        <div class="step2-card ${cardBlocked ? 'disabled' : ''} ${isFull ? 'is-full' : ''} status-${status}">
          ${isFull ? '<div class="pc-stamp pc-stamp-sm" aria-label="모집마감">마감</div>' : ''}
          <header class="s2-head">
            <div class="s2-title">${esc(p.title)} ${tags}</div>
            <div class="s2-meta">
              👶 ${formatGradesLabel(p.grades)} · ${
                isFull
                  ? `<span class="seats-full">${p.is_fully_closed ? '정원·대기 마감' : '정원 마감'}</span>`
                  : (p.remaining > 0
                      ? `남은자리 <strong>${p.remaining}</strong>/${p.capacity}`
                      : `대기 <strong>${p.waitlist_count || 0}</strong>/${p.waitlist_capacity ?? 10}`)
              }
            </div>
          </header>
          <div class="s2-sub">이 프로그램을 신청할 학생</div>
          ${body}
        </div>
      `;
    }).join('');

    // 체크박스 이벤트
    programsArea.querySelectorAll('input[type="checkbox"][data-pid]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const pid = e.target.dataset.pid;
        const sid = Number(e.target.dataset.sid);
        const s = students.find(x => x.id === sid);
        if (!s) return;
        if (e.target.checked) s.selected.add(pid);
        else s.selected.delete(pid);
        renderStep2();
        renderSummary();
      });
    });

    // 일괄 선택 버튼 이벤트 (학년 + 시간충돌 모두 통과한 학생만 대상)
    programsArea.querySelectorAll('button.s2-select-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        const p = programs.find(x => x.id === pid);
        if (!p) return;
        const eligible = [];
        students.forEach((s, i) => {
          const eff = effGradeForStudent(i);
          if (eff == null || !gradeIncluded(p, eff)) return;
          if (s.selected.has(pid)) { eligible.push(s); return; }
          if (!conflictForStudent(p, s)) eligible.push(s);
        });
        if (eligible.length === 0) return;
        const allChecked = eligible.every(s => s.selected.has(pid));
        if (allChecked) eligible.forEach(s => s.selected.delete(pid));
        else eligible.forEach(s => s.selected.add(pid));
        renderStep2();
        renderSummary();
      });
    });
  }

  function getTotalSelected() {
    return students.reduce((acc, s) => acc + s.selected.size, 0);
  }
  function updateSubmitState(totalCount) {
    const hint = document.getElementById('submit-hint');
    const countEl = document.getElementById('submit-bar-count');
    if (countEl) countEl.innerHTML = `총 <strong>${totalCount}</strong>건 신청 예정`;
    if (!hint) {
      submitBtn.disabled = totalCount === 0;
      return;
    }
    // 진행 상태 요약: 학생 수 · 프로그램 수 · 보호자 상태
    const studentCount = students.filter(s => (s.cache.name || '').trim()).length;
    const guardianName = (document.getElementById('guardian_name')?.value || '').trim();
    const guardianPhone = (document.getElementById('guardian_phone')?.value || '').trim();
    const phoneOk = isValidPhone(guardianPhone);
    const guardianOk = !!guardianName && phoneOk;

    if (totalCount === 0) {
      submitBtn.disabled = true;
      hint.className = 'submit-bar-hint warn';
      hint.textContent = '신청할 프로그램을 1개 이상 선택해 주세요';
      return;
    }
    submitBtn.disabled = false;
    if (!guardianOk) {
      hint.className = 'submit-bar-hint warn';
      const missing = !guardianName
        ? '보호자 이름을 입력해 주세요'
        : '보호자 연락처를 정확히 입력해 주세요';
      hint.innerHTML = `학생 ${studentCount}명<span class="sep">·</span>프로그램 ${totalCount}개<span class="sep">·</span>${esc(missing)}`;
    } else {
      hint.className = 'submit-bar-hint ok';
      hint.innerHTML = `학생 ${studentCount}명<span class="sep">·</span>프로그램 ${totalCount}개<span class="sep">·</span>보호자 ✓ 신청 준비 완료`;
    }
  }

  // === 3단계: 신청 내용 확인 (학생별 요약) + 다문화 질문 ===
  function renderSummary() {
    if (students.length === 0) {
      summaryArea.innerHTML = '<div class="empty">먼저 위에서 학생과 프로그램을 선택해 주세요.</div>';
      updateSubmitState(0);
      updateHouseholdMcVisibility();
      return;
    }
    const totalCount = students.reduce((acc, s) => acc + s.selected.size, 0);
    updateSubmitState(totalCount);
    const groupTag = students.length >= 2
      ? `<div class="summary-group-tag">형제·자매 ${students.length}명 묶음 신청</div>` : '';

    const blocks = students.map((s, i) => {
      const dispName = studentDisplayName(s, i);
      const list = Array.from(s.selected);
      const programLine = list.length === 0
        ? '<span class="muted">선택한 프로그램 없음</span>'
        : list.map(pid => {
            const p = programs.find(x => x.id === pid);
            return p ? esc(p.title) : '?';
          }).join(', ');

      return `
        <div class="summary-student ${list.length === 0 ? 'empty' : ''}">
          <div class="ss-head"><b>${esc(dispName)}</b></div>
          <div class="ss-line">신청 프로그램: ${programLine}</div>
        </div>
      `;
    }).join('');

    summaryArea.innerHTML = `
      ${groupTag}
      ${blocks}
      <div class="summary-total">총 <strong>${totalCount}</strong>건 신청 예정</div>
    `;

    updateHouseholdMcVisibility();
  }

  // === 가정 단위 다문화 입력 (보호자 영역) ===
  // 선택된 프로그램 중 다문화 우대형이 하나라도 있으면 보호자 영역에 체크박스 노출.
  function anyMulticulturalSelected() {
    return students.some(s => Array.from(s.selected).some(pid => {
      const p = programs.find(x => x.id === pid);
      return p && isMulticulturalProgram(p);
    }));
  }
  function updateHouseholdMcVisibility() {
    const el = document.getElementById('household-mc');
    const cb = document.getElementById('household_multicultural');
    if (!el || !cb) return;
    const show = anyMulticulturalSelected();
    el.hidden = !show;
    if (!show) cb.checked = false;
  }

  // === 데이터 로드 ===
  async function loadPrograms() {
    try {
      const res = await fetch('/api/public/programs');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '불러오기 실패');
      // 모집 상태순 정렬: 모집중 위 → 모집예정 → 모집마감 → 모집종료 아래 (같은 상태는 기존 순서 유지).
      programs = sortByRecruit(j.data || []);
      renderTypeFilterCustomChips();
      renderDetailList();
      if (students.length === 0) addStudent();
      else { renderStudents(); renderStep2(); renderSummary(); }
    } catch (err) {
      detailListEl.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다: ${esc(err.message)}</div>`;
      programsArea.innerHTML = `<div class="empty-state">프로그램을 불러올 수 없습니다.</div>`;
    }
  }

  // === 동의 텍스트 ===
  function renderPrivacyText() {
    const el = document.getElementById('privacy-text');
    if (!el) return;
    const items = PRIVACY_TEXT.items.map((s, i) => `<li><b>${i + 1}.</b> ${esc(s)}</li>`).join('');
    el.innerHTML = `
      <div style="margin-bottom:6px;">${esc(PRIVACY_TEXT.intro)}</div>
      <ol style="padding-left:18px; list-style:none;">${items}</ol>
    `;
  }

  // === 제출 ===
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const studentsPayload = [];
    let validationErr = null;
    const guardianMotivation = (document.getElementById('guardian_motivation').value || '').trim() || null;
    // 다문화는 가정 단위 1회 — 다문화 우대형 선택이 있는 경우에만 노출되는 체크박스.
    const householdMc = !!(document.getElementById('household_multicultural') &&
                           document.getElementById('household_multicultural').checked);

    students.forEach((s, i) => {
      if (validationErr) return;
      const name = (s.cache.name || '').trim();
      const grade = Number(effGradeForStudent(i));
      const cls = Number(s.cache.class_no);
      const program_ids = Array.from(s.selected);

      if (!name) { validationErr = `학생 ${i + 1}의 이름을 입력해 주세요.`; return; }
      if (!grade || grade < 1 || grade > 6) { validationErr = `${name}의 학년을 1~6 사이로 입력해 주세요.`; return; }
      if (!cls || cls < 1 || cls > 30) { validationErr = `${name}의 반을 1~30 사이로 입력해 주세요.`; return; }
      if (program_ids.length === 0) { validationErr = `${name}이(가) 신청할 프로그램을 1개 이상 선택해 주세요. (② 영역에서 체크)`; return; }

      for (const pid of program_ids) {
        const p = programs.find(x => x.id === pid);
        if (!p) continue;
        if (!gradeIncluded(p, grade)) {
          validationErr = `${name}: "${p.title}"은(는) ${formatGradesLabel(p.grades)} 대상입니다.`;
          return;
        }
      }

      studentsPayload.push({
        student_name: name,
        grade, class_no: cls,
        motivation: guardianMotivation,
        program_ids,
        is_multicultural: householdMc, // 가정 단위 1회 (서버에서 다문화 우대형 행에만 적용)
      });
    });

    if (validationErr) { alert(validationErr); return; }
    if (studentsPayload.length === 0) { alert('학생 정보가 없습니다.'); return; }

    const guardianName = document.getElementById('guardian_name').value.trim();
    const guardianPhone = document.getElementById('guardian_phone').value.trim();
    if (!guardianName) { alert('보호자 이름을 입력해 주세요.'); return; }
    if (!isValidPhone(guardianPhone)) {
      alert('올바른 휴대폰 번호를 입력해 주세요(010-XXXX-XXXX).');
      document.getElementById('guardian_phone').focus();
      return;
    }
    if (!document.getElementById('privacy_agreed').checked) {
      alert('개인정보 수집·이용 동의가 필요합니다.');
      return;
    }

    const payload = {
      students: studentsPayload,
      guardian_name: guardianName,
      guardian_phone: guardianPhone,
      privacy_agreed: true,
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
      // 추가 신청 시 보호자 정보 자동 채움용으로 보존
      try {
        sessionStorage.setItem('saessak_guardian', JSON.stringify({ phone: guardianPhone, name: guardianName }));
      } catch {}
      renderResult(j, payload);
      window.scrollTo({ top: resultArea.offsetTop - 20, behavior: 'smooth' });
    } catch (err) {
      alert('서버에 연결할 수 없습니다: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '신청하기';
    }
  });

  function renderResult(result, payload) {
    const { accepted = [], rejected = [], sibling_group_id } = result;
    let html = '<div class="result-box">';
    html += '<h2>✅ 신청 결과</h2>';
    if (sibling_group_id) {
      html += `<div class="muted" style="margin-bottom:10px;">형제·자매 ${payload.students.length}명 묶음 접수</div>`;
    }
    const byStudent = {};
    accepted.forEach(a => { (byStudent[a.student_name] = byStudent[a.student_name] || { accepted: [], rejected: [] }).accepted.push(a); });
    rejected.forEach(r => { (byStudent[r.student_name] = byStudent[r.student_name] || { accepted: [], rejected: [] }).rejected.push(r); });

    Object.keys(byStudent).forEach(name => {
      const g = byStudent[name];
      html += `<div style="margin-top:14px;"><b>${esc(name)}</b></div>`;
      g.accepted.forEach(a => {
        const isWait = !!a.is_waitlist;
        const slot = a.slot_number;
        const stateLabel = isWait
          ? `<span class="badge waiting">대기 ${slot ?? ''}번</span>`
          : `<span class="badge open">접수 ${slot ?? ''}번째</span>`;
        const headLine = isWait
          ? `🕓 ${esc(a.title)} ${stateLabel}<br><span class="sub">대기로 접수되었습니다 (대기 ${slot ?? ''}번)</span>`
          : `✓ ${esc(a.title)} ${stateLabel}<br><span class="sub">접수되었습니다 (${slot ?? ''}번째 접수)</span>`;
        const schedLine = (window.SaessakSchedule && window.SaessakSchedule.format(a)) || a.schedule || '';
        html += `<div class="item">
          ${headLine}
          <div class="sub">${esc(schedLine)} · 접수시각: ${fmtTime(a.submitted_at)}</div>
        </div>`;
      });
      g.rejected.forEach(r => {
        html += `<div class="item reject">✗ ${esc(r.title)} <div class="sub">${esc(r.reason)}</div></div>`;
      });
    });

    if (accepted.length === 0 && rejected.length === 0) {
      html += '<div class="item">접수 결과가 없습니다.</div>';
    }
    html += '<div class="result-notice">';
    html += '<b>접수·대기는 확정이 아닙니다.</b><br>';
    html += '<span class="sub">선정 결과는 각 프로그램 시작 <b>1주일 전쯤</b> 선정된 분께 보호자 연락처로 개별 안내드립니다.</span>';
    html += '</div>';
    html += '<div class="result-me-cta">';
    html += '🔎 내 신청은 <b>보호자 연락처</b>로 언제든 조회·취소할 수 있어요.';
    html += '<a class="btn primary result-me-btn" href="/me">내 신청 확인 / 취소하기</a>';
    html += '</div>';
    html += '<div class="result-more-cta">';
    html += '<div class="result-more-text">다른 프로그램도 같은 보호자 연락처로 추가 신청할 수 있어요.</div>';
    html += '<a class="btn result-more-btn" href="/">+ 프로그램 더 신청하기</a>';
    html += '</div>';
    // 카카오톡 오픈채팅 문의 안내(공개 정보 · 개인정보 무관). 이미지 없어도 문구+링크는 정상 표시.
    const KAKAO_URL = 'https://open.kakao.com/o/gWzAidyi';
    html += '<div class="result-kakao">';
    html += '<div class="result-kakao-title">💬 카카오톡 문의</div>';
    html += '<div class="result-kakao-text">문의사항이 있으시면 아래 카카오톡 오픈채팅방에 들어오셔서 석암초 담당자에게 1:1로 문의해 주세요.</div>';
    html += `<a class="result-kakao-qr" href="${KAKAO_URL}" target="_blank" rel="noopener" aria-label="카카오톡 오픈채팅 QR 코드 (탭하면 열림)">`;
    html += '<img src="/images/kakao-qr.png" alt="카카오톡 오픈채팅 QR" onerror="this.parentNode.style.display=\'none\'">';
    html += '</a>';
    html += `<a class="btn result-kakao-btn" href="${KAKAO_URL}" target="_blank" rel="noopener">📨 카카오톡 오픈채팅방 열기</a>`;
    html += `<div class="result-kakao-link">또는 주소창에 직접 입력: <a href="${KAKAO_URL}" target="_blank" rel="noopener">open.kakao.com/o/gWzAidyi</a></div>`;
    html += '</div>';
    html += '</div>';
    resultArea.innerHTML = html;
    form.style.display = 'none';
    const bar = document.getElementById('submit-bar');
    if (bar) bar.style.display = 'none';
  }

  // === 학년 필터 칩 와이어링 ===
  function wireGradeFilter() {
    const filterEl = document.getElementById('grade-filter');
    if (!filterEl) return;
    filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn || !filterEl.contains(btn)) return;
      const raw = btn.dataset.grade;
      const next = (raw === '' || raw == null) ? null : Number(raw);
      if (next === activeGradeFilter) return;
      activeGradeFilter = next;
      filterEl.querySelectorAll('.chip').forEach(c => {
        const isActive = c === btn;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderDetailList();
      renderStep2();
    });
  }

  // === 모집상태 필터 칩 와이어링 (학년 필터와 동일 패턴) ===
  function wireStatusFilter() {
    const filterEl = document.getElementById('status-filter');
    if (!filterEl) return;
    filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn || !filterEl.contains(btn)) return;
      const raw = btn.dataset.status;
      const next = (raw === '' || raw == null) ? null : raw;
      if (next === activeStatusFilter) return;
      activeStatusFilter = next;
      filterEl.querySelectorAll('.chip').forEach(c => {
        const isActive = c === btn;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderDetailList();
      renderStep2();
    });
  }

  // === 유형 필터: 기타(type_custom) 값이 있는 프로그램이면 칩으로 동적 추가 ===
  function renderTypeFilterCustomChips() {
    const el = document.getElementById('type-filter');
    if (!el) return;
    // 이전에 추가한 custom 칩 제거 후 재생성
    el.querySelectorAll('.chip[data-type^="custom:"]').forEach(c => c.remove());
    const customs = Array.from(new Set(
      programs.map(p => customTypeOf(p)).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    customs.forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.type = 'custom:' + v;     // dataset 으로 안전 전달(HTML 인젝션 없음)
      btn.setAttribute('role', 'tab');
      btn.textContent = v;
      el.appendChild(btn);
    });
    // 현재 선택 상태를 칩에 반영(재생성 후에도 active 유지)
    el.querySelectorAll('.chip').forEach(c => {
      const raw = c.dataset.type;
      const tok = (raw === '' || raw == null) ? null : raw;
      const isActive = tok === activeTypeFilter;
      c.classList.toggle('active', isActive);
      c.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // === 유형 필터 칩 와이어링 (학년 필터와 동일 패턴, 이벤트 위임 → 동적 칩도 처리) ===
  function wireTypeFilter() {
    const filterEl = document.getElementById('type-filter');
    if (!filterEl) return;
    filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn || !filterEl.contains(btn)) return;
      const raw = btn.dataset.type;
      const next = (raw === '' || raw == null) ? null : raw;
      if (next === activeTypeFilter) return;
      activeTypeFilter = next;
      filterEl.querySelectorAll('.chip').forEach(c => {
        const isActive = c === btn;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderDetailList();
      renderStep2();
    });
  }

  // === 보호자 입력 → 진행 요약 갱신 ===
  function wireGuardianInputs() {
    const ids = ['guardian_name', 'guardian_phone'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => updateSubmitState(getTotalSelected()));
    });
  }

  // === 보호자 정보 자동 채움 (이전 조회/신청에서 sessionStorage 에 저장된 값) ===
  function prefillGuardianFromSession() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('saessak_guardian') || 'null'); } catch {}
    if (!saved) return;
    const nameEl = document.getElementById('guardian_name');
    const phoneEl = document.getElementById('guardian_phone');
    if (nameEl && saved.name && !nameEl.value) nameEl.value = saved.name;
    if (phoneEl && saved.phone && !phoneEl.value) phoneEl.value = saved.phone;
    // 제출 바 진행요약 갱신
    updateSubmitState(getTotalSelected());
  }

  // === 초기화 ===
  renderPrivacyText();
  attachPhoneFormatter(document.getElementById('guardian_phone'));
  wireGradeFilter();
  wireTypeFilter();
  wireStatusFilter();
  wireGuardianInputs();
  prefillGuardianFromSession();
  loadPrograms();
})();
