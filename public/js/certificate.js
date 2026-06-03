// 참가 확인증 생성/출력 공통 모듈 (강사 페이지·관리자 공용)
// 읽기 전용: 이미 화면에 로드된 프로그램 정보 + 신청자 명단으로 인쇄용 HTML을 만든다(DB 변경 없음).
// window.SaessakCertificate.openDialog({ groups, defaultContact }) 한 함수만 외부에 노출.
//   groups: [{ program, candidates }]
//     program   : { title, location, instructors, organization, session_dates, start_time, end_time, extra_sessions }
//     candidates : [{ student_name, grade, class_no, status, is_waitlist }]  (취소 제외 전 후보 — 모듈이 필터)
//   defaultContact: 문의처 입력칸 기본값(없으면 '')
(function (global) {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\r?\n/g, '<br>'); }

  // 취소 제외. 선정(status='selected') 또는 접수(is_waitlist=false) = accepted, 그 외 대기 = waitlist.
  function splitCandidates(candidates) {
    const accepted = [], waitlist = [];
    (candidates || []).forEach(c => {
      if (!c || c.status === 'cancelled') return;
      if (c.status === 'selected' || c.is_waitlist !== true) accepted.push(c);
      else waitlist.push(c);
    });
    return { accepted, waitlist };
  }

  // 메인 일정 / 보충 일정 텍스트(SaessakSchedule 재사용). 보충은 따로 분리해 색을 달리 표기.
  function scheduleTexts(program) {
    const S = global.SaessakSchedule;
    let main = '', extra = '';
    if (S && typeof S.format === 'function') {
      main = S.format({
        session_dates: program.session_dates,
        start_time: program.start_time,
        end_time: program.end_time,
      }) || '';
    } else {
      main = program.schedule || '';
    }
    if (S && typeof S.formatExtras === 'function') {
      extra = S.formatExtras(program.extra_sessions) || '';
    }
    return { main, extra };
  }

  // ===== 디지털새싹 이수 도장판(마일리지) =====
  // 호칭 기준: 누적 도장(이수) 수가 값 "이상"이면 해당 호칭. 미만이면 '새싹 회원'.
  // ▼▼ 호칭 기준은 여기서만 바꾸면 됩니다 ▼▼
  const TITLE = { 새싹왕: 10, 새싹신: 20 };
  // ▲▲ 호칭 기준 설정 끝 ▲▲
  function titleForCount(count) {
    let best = '새싹 회원', bestN = -1;
    Object.keys(TITLE).forEach(name => {
      const n = TITLE[name];
      if (count >= n && n > bestN) { best = name; bestN = n; }
    });
    return best;
  }

  // 채워진 새싹(이수) SVG — 줄기 + 두 잎(연두/초록).
  function sproutFilledSvg() {
    return `<svg class="seed-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 22 V12" stroke="#2E7D32" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M12 13 C12 8 7 6.5 3.5 7.8 C4.6 12 9 13.2 12 13 Z" fill="#81C784"/>
      <path d="M12 13 C12 7.5 17 6.5 20.5 7.8 C19.4 12 15 13.2 12 13 Z" fill="#43A047"/>
    </svg>`;
  }
  // 빈 슬롯(다음 새싹) — 외곽선만.
  function sproutEmptySvg() {
    return `<svg class="seed-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 22 V12" stroke="#C8E6C9" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M12 13 C12 8 7 6.5 3.5 7.8 C4.6 12 9 13.2 12 13 Z" fill="none" stroke="#C8E6C9" stroke-width="1.4"/>
      <path d="M12 13 C12 7.5 17 6.5 20.5 7.8 C19.4 12 15 13.2 12 13 Z" fill="none" stroke="#C8E6C9" stroke-width="1.4"/>
    </svg>`;
  }
  // 이수 도장(빨강 원형 인장) SVG.
  function sealSvg() {
    return `<svg class="seed-seal" viewBox="0 0 40 40" width="20" height="20" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="none" stroke="#E53935" stroke-width="3"/>
      <text x="20" y="26" text-anchor="middle" font-size="15" font-weight="800" fill="#E53935">이수</text>
    </svg>`;
  }

  // 도장 수 집계 매칭: 보호자연락처 있으면 이름+연락처(학년/반 바뀌어도 누적, 형제는 이름으로 구분),
  // 없으면 이름+학년+반.
  function stampMatch(att, s) {
    if (String(s.student_name || '').trim() !== String(att.student_name || '').trim()) return false;
    const c = att.guardian_phone;
    if (c) return s.guardian_contact === c;
    return (s.grade ?? '') === (att.grade ?? '') && (s.class_no ?? '') === (att.class_no ?? '');
  }
  // 이 학생의 이수 도장 목록(프로그램 단위 중복 제거).
  function stampedProgramsFor(att) {
    const seen = new Set();
    const out = [];
    (state.stamps || []).forEach(s => {
      if (!stampMatch(att, s)) return;
      const pid = (s.program_id != null) ? String(s.program_id) : ('t:' + (s.program_name || ''));
      if (seen.has(pid)) return;
      seen.add(pid);
      out.push({ program_id: pid, title: s.program_name || '' });
    });
    return out;
  }
  // 현재 확인증 프로그램이 이 학생에게 도장 찍혔는지.
  function isStampedNow(att, program) {
    const pid = program && program.id != null ? String(program.id) : null;
    if (pid == null) return false;
    return stampedProgramsFor(att).some(p => p.program_id === pid);
  }

  // 화면 전용 "도장 찍기" 버튼(인쇄 시 숨김). 팝업창에서 opener 브릿지로 토글.
  function stampControl(program, att) {
    if (!state.canStamp) return '';
    const stamped = isStampedNow(att, program);
    const entry = {
      student_name: att.student_name || '',
      grade: att.grade ?? null,
      class_no: att.class_no ?? null,
      guardian_contact: att.guardian_phone || null,
      program_id: program && program.id != null ? program.id : null,
      program_name: (program && program.title) || '',
      stamped, // 현재 상태(토글 방향 판단용)
    };
    if (entry.program_id == null) return ''; // 프로그램 식별 불가면 버튼 생략
    const label = stamped ? '✅ 이수 완료 — 취소하려면 클릭' : '🟢 도장 찍기 (이수)';
    return `<div class="stamp-ctrl no-print">
      <button type="button" class="stamp-btn ${stamped ? 'on' : ''}" data-stamp="${esc(JSON.stringify(entry))}">${label}</button>
      <span class="stamp-hint">※ 이 버튼은 인쇄물에는 나오지 않아요</span>
    </div>`;
  }

  // 이수 도장판 블록. layout 'a' 면 라벨까지, 'b' 면 아이콘만 한 줄로 간략히.
  function growthBoard(program, att, layout, opts) {
    const filled = stampedProgramsFor(att);
    const count = filled.length;
    const emptyCount = layout === 'a' ? 3 : 2; // 다음에 채울 빈 슬롯(다음 새싹)
    const compact = layout !== 'a';
    const filledHtml = filled.map(f => `<div class="seed filled">
      <div class="seed-top">${sproutFilledSvg()}${sealSvg()}</div>${
      compact ? '' : `<span class="seed-label" title="${esc(f.title)}">${esc(f.title)}</span>`
    }</div>`).join('');
    let emptyHtml = '';
    for (let i = 0; i < emptyCount; i++) {
      emptyHtml += `<div class="seed empty"><div class="seed-top">${sproutEmptySvg()}</div>${compact ? '' : '<span class="seed-label">&nbsp;</span>'}</div>`;
    }

    // 호칭·보상(체크 시) 또는 중립 안내문구(미체크).
    let footer;
    if (opts && opts.showTitleReward) {
      const title = titleForCount(count);
      const reward = (opts.rewardText && opts.rewardText.trim())
        ? `<div class="reward-body">${nl2br(opts.rewardText.trim())}</div>` : '';
      footer = `<div class="cert-reward">
        <span class="reward-badge">🏅 ${esc(title)}</span>${reward}
      </div>`;
    } else {
      footer = `<div class="cert-board-msg">디지털새싹을 모을수록 나의 새싹이 자라요 🌱 다음 새싹에서 또 만나요!</div>`;
    }

    return `<div class="cert-board${compact ? ' cert-board-compact' : ''}">
      <div class="cert-board-head">
        <div class="cert-board-title">🌱 디지털새싹 이수 도장판</div>
        <div class="cert-board-count"><span class="count-num">${count}</span><span class="count-unit">개 이수</span></div>
      </div>
      <div class="cert-board-grid">${filledHtml}${emptyHtml}</div>
      ${footer}
    </div>`;
  }

  function infoRows(program, opts) {
    const sch = scheduleTexts(program);
    const rows = [];
    if (sch.main) rows.push(`<tr><th>일정</th><td>${esc(sch.main)}</td></tr>`);
    if (sch.extra) rows.push(`<tr class="extra"><th>보충</th><td>🔁 ${esc(sch.extra)}</td></tr>`);
    if (program.location) rows.push(`<tr><th>장소</th><td>${esc(program.location)}</td></tr>`);
    if (program.instructors) rows.push(`<tr><th>강사</th><td>${esc(program.instructors)}</td></tr>`);
    return rows.join('');
  }

  // 확인증 1장. layout: 'a'(1인 1장, 큼직) | 'b'(한 장 여러 명, 자르기 점선)
  function certCard(program, att, opts, layout, flags) {
    const sub = [att.grade ? att.grade + '학년' : '', att.class_no ? att.class_no + '반' : '']
      .filter(Boolean).join(' ');
    const note = (opts.note && opts.note.trim())
      ? `<div class="cert-note"><span class="cert-note-lbl">선생님 한마디</span>${nl2br(opts.note.trim())}</div>` : '';
    const contact = (opts.contact && opts.contact.trim())
      ? `<div class="cert-foot">문의처 · ${esc(opts.contact.trim())}</div>` : '';
    const cls = ['cert', layout === 'a' ? 'cert-a' : 'cert-b'];
    if (flags && flags.pageBreak) cls.push('pb');
    return `<div class="${cls.join(' ')}">
      <div class="cert-head">
        <div class="cert-school">🌱 석암초등학교 디지털새싹</div>
        <div class="cert-title">프로그램 참가 확인증</div>
      </div>
      <div class="cert-body">
        <div class="cert-name-wrap">
          <div class="cert-name">${esc(att.student_name || '')}</div>
          ${sub ? `<div class="cert-sub">${esc(sub)}</div>` : ''}
        </div>
        <div class="cert-prog">${esc(program.title || '')}</div>
        <table class="cert-info">${infoRows(program, opts)}</table>
        ${note}
        ${stampControl(program, att)}
        ${growthBoard(program, att, layout, opts)}
      </div>
      ${contact}
      ${layout === 'b' ? '<div class="cert-cut">✂ ─────────────────────────────────────────────</div>' : ''}
    </div>`;
  }

  function buildCards(groups, opts) {
    const cards = [];
    groups.forEach((g, gi) => {
      const { accepted, waitlist } = splitCandidates(g.candidates);
      let list = accepted.slice();
      if (opts.includeWaitlist) list = list.concat(waitlist);
      list.forEach((att, ai) => {
        // A 레이아웃: 매 장 새 페이지. B 레이아웃: 새 프로그램 시작 시에만 새 페이지.
        const pageBreak = (opts.layout === 'a')
          ? !(gi === 0 && ai === 0)
          : (ai === 0 && gi > 0);
        cards.push(certCard(g.program, att, opts, opts.layout, { pageBreak }));
      });
    });
    return cards;
  }

  function printCss() {
    return `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
  color: #16341c; background: #f4f7f4;
}
.toolbar {
  position: sticky; top: 0; background: #2E7D32; color: #fff; padding: 10px 16px;
  display: flex; align-items: center; gap: 12px; font-size: 14px;
}
.toolbar button {
  background: #fff; color: #2E7D32; border: 0; border-radius: 8px;
  padding: 8px 16px; font-size: 14px; font-weight: 800; cursor: pointer;
}
.toolbar .hint { font-size: 12.5px; opacity: .92; }
.sheet { max-width: 200mm; margin: 14px auto; padding: 0 6px; }

.cert {
  background: #fff; border: 2px solid #2E7D32; border-radius: 16px;
  padding: 22px 28px; margin: 0 0 14px; position: relative;
  page-break-inside: avoid; break-inside: avoid;
}
.cert.pb { page-break-before: always; break-before: page; }
.cert-head {
  text-align: center; border-bottom: 2px dashed #A5D6A7; padding-bottom: 12px; margin-bottom: 16px;
}
.cert-school { font-size: 15px; font-weight: 800; color: #2E7D32; letter-spacing: .5px; }
.cert-title { font-size: 24px; font-weight: 900; color: #1B5E20; margin-top: 6px; }
.cert-name-wrap { text-align: center; margin-bottom: 14px; }
.cert-name { font-size: 30px; font-weight: 900; color: #14331a; }
.cert-sub { font-size: 14px; color: #5b6b5e; margin-top: 2px; }
.cert-prog {
  text-align: center; font-size: 18px; font-weight: 800; color: #2E7D32;
  background: #E8F5E9; border-radius: 10px; padding: 8px 12px; margin-bottom: 14px;
}
.cert-info { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.cert-info th, .cert-info td { padding: 7px 10px; border-bottom: 1px solid #E0EAE0; text-align: left; vertical-align: top; }
.cert-info th { width: 64px; color: #2E7D32; font-weight: 800; white-space: nowrap; }
.cert-info tr.extra th { color: #C2410C; }
.cert-info tr.extra td { color: #9A3412; background: #FFF4EC; }
.cert-info tr:last-child th, .cert-info tr:last-child td { border-bottom: 0; }
.cert-note {
  margin-top: 14px; background: #F1F8E9; border-left: 4px solid #7CB342;
  border-radius: 8px; padding: 10px 14px; font-size: 13.5px; line-height: 1.6; color: #33491f;
  white-space: normal;
}
.cert-note-lbl { display: block; font-weight: 800; color: #558B2F; margin-bottom: 3px; font-size: 12.5px; }
.cert-foot { text-align: center; font-size: 12.5px; color: #6b7b6e; margin-top: 14px; }

/* 화면 전용 도장 찍기 버튼(인쇄 시 숨김) */
.no-print { }
.stamp-ctrl { margin-top: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stamp-btn {
  border: 1.5px solid #2E7D32; background: #fff; color: #2E7D32;
  border-radius: 999px; padding: 7px 16px; font-size: 13.5px; font-weight: 800; cursor: pointer;
}
.stamp-btn.on { background: #2E7D32; color: #fff; }
.stamp-btn:disabled { opacity: .6; cursor: default; }
.stamp-hint { font-size: 11.5px; color: #8a9a8c; }

/* 디지털새싹 이수 도장판 */
.cert-board {
  margin-top: 16px; padding: 14px 16px;
  background: #F1F8E9; border: 1.5px dashed #AED581; border-radius: 12px;
  page-break-inside: avoid; break-inside: avoid;
}
.cert-board-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.cert-board-title { font-size: 14px; font-weight: 800; color: #558B2F; }
.cert-board-count { color: #2E7D32; font-weight: 800; white-space: nowrap; }
.cert-board-count .count-num { font-size: 26px; line-height: 1; }
.cert-board-count .count-unit { font-size: 12px; margin-left: 2px; }
.cert-board-grid { display: flex; flex-wrap: wrap; gap: 12px 14px; align-items: flex-start; }
.seed { display: flex; flex-direction: column; align-items: center; width: 64px; }
.seed-top { display: flex; align-items: center; gap: 2px; }
.seed-ico { display: block; }
.seed-seal { display: block; }
.seed-label {
  margin-top: 3px; font-size: 10.5px; line-height: 1.2; text-align: center; color: #33491f;
  max-width: 64px; max-height: 26px; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.seed.filled .seed-label { font-weight: 700; }
.seed.empty .seed-label { color: transparent; }
.cert-board-msg { margin-top: 12px; font-size: 12.5px; color: #558B2F; text-align: center; font-weight: 700; }
.cert-reward { margin-top: 12px; text-align: center; }
.reward-badge {
  display: inline-block; background: #FFF3E0; color: #E65100; border: 1.5px solid #FFB74D;
  border-radius: 999px; padding: 4px 14px; font-size: 14px; font-weight: 800;
}
.reward-body { margin-top: 8px; font-size: 12.5px; color: #5D4037; white-space: normal; line-height: 1.6; }

/* B 레이아웃: 아이콘만 한 줄로 간략(자르기 흐트러짐 방지) */
.cert-board-compact { margin-top: 10px; padding: 8px 12px; }
.cert-board-compact .cert-board-title { font-size: 12.5px; }
.cert-board-compact .cert-board-count .count-num { font-size: 18px; }
.cert-board-compact .cert-board-grid { gap: 6px; }
.cert-board-compact .seed { width: auto; }
.cert-board-compact .cert-board-msg, .cert-board-compact .cert-reward { margin-top: 6px; font-size: 11px; }

/* A 레이아웃: 도장판을 본문 하단에 자연스럽게(빈 공간 채움) */
.cert-a .cert-board { margin-top: 20px; }
.cert-a .cert-board-title { font-size: 15px; }
.cert-a .seed { width: 76px; }
.cert-a .seed-label { max-width: 76px; font-size: 11px; }

/* A: 한 명당 한 장(A4 큼직) */
.cert-a { min-height: 252mm; display: flex; flex-direction: column; }
.cert-a .cert-body { flex: 1; }
.cert-a .cert-name { font-size: 38px; }
.cert-a .cert-title { font-size: 28px; }
.cert-a .cert-prog { font-size: 20px; }
.cert-a .cert-info { font-size: 16px; }

/* B: 한 장에 여러 명(자르기 점선) */
.cert-b { min-height: 82mm; border-style: solid; padding: 16px 22px; }
.cert-b .cert-title { font-size: 19px; }
.cert-b .cert-name { font-size: 24px; }
.cert-b .cert-prog { font-size: 15px; padding: 5px 10px; }
.cert-b .cert-info { font-size: 13px; }
.cert-b .cert-info th, .cert-b .cert-info td { padding: 4px 8px; }
.cert-cut { text-align: center; color: #9e9e9e; font-size: 11px; margin-top: 12px; letter-spacing: 1px; overflow: hidden; white-space: nowrap; }

@media print {
  body { background: #fff; }
  .toolbar { display: none !important; }
  .no-print, .stamp-ctrl { display: none !important; }
  .sheet { max-width: none; margin: 0; padding: 0; }
  .cert { margin: 0 0 8px; }
  .cert-b { margin-bottom: 0; }
}`;
  }

  function openPrintWindow(html) {
    const win = global.open('', '_blank');
    if (!win) {
      alert('팝업이 차단되어 확인증 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.');
      return null;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    return win;
  }

  // 미리보기 창에서 "도장 찍기" 클릭 → opener(원래 창)의 브릿지로 위임(인증은 원래 창에 있음).
  // 같은 출처이므로 window.opener 접근 가능. 토글 후 opener 가 미리보기 문서를 다시 그린다.
  const PREVIEW_SCRIPT = `<script>
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-stamp]');
    if(!b) return;
    var bridge = window.opener && window.opener.__saessakCertBridge;
    if(!bridge){ alert('도장 기능은 원래 관리자/강사 화면이 열려 있어야 합니다.'); return; }
    b.disabled = true; b.textContent = '처리 중…';
    try { bridge.toggle(b.getAttribute('data-stamp')); }
    catch(err){ alert('도장 처리 중 오류가 발생했습니다.'); b.disabled = false; }
  });
  <\/script>`;

  function buildDoc(cards) {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>참가 확인증</title><style>${printCss()}</style></head>
<body>
<div class="toolbar no-print">
  <button type="button" onclick="window.print()">🖨 인쇄 / PDF 저장</button>
  <span class="hint">미리보기 화면입니다. 인쇄 대화상자에서 ‘PDF로 저장’을 고르면 PDF로 받을 수 있습니다.</span>
</div>
<div class="sheet">${cards.join('')}</div>
${PREVIEW_SCRIPT}
</body></html>`;
  }

  // 미리보기 창 다시 그리기(도장 토글 후 도장판/버튼 상태 갱신).
  function rerenderPreview() {
    if (!state.win || state.win.closed) return;
    const cards = buildCards(state.groups, state.lastOpts || {});
    state.win.document.open();
    state.win.document.write(buildDoc(cards));
    state.win.document.close();
  }

  // opener 브릿지: 미리보기 창의 도장 버튼이 호출. 인증/통신은 호출측(admin/edit)이 준 onToggleStamp 가 담당.
  global.__saessakCertBridge = {
    toggle: async function (entryStr) {
      if (!state.onToggleStamp) return;
      let entry;
      try { entry = JSON.parse(entryStr); } catch (e) { return; }
      try {
        const newStamps = await state.onToggleStamp(entry);
        if (Array.isArray(newStamps)) state.stamps = newStamps;
        rerenderPreview();
      } catch (err) {
        if (state.win && !state.win.closed) state.win.alert('도장 처리 실패: ' + ((err && err.message) || err));
        rerenderPreview();
      }
    },
  };

  // ===== 설정 다이얼로그 =====
  let dlg = null;
  let state = {
    groups: [], defaultContact: '',
    stamps: [], canStamp: false, onToggleStamp: null, // 이수 도장
    win: null, lastOpts: null,
  };

  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.className = 'dialog-mask';
    dlg.id = 'cert-dialog';
    dlg.innerHTML = `
      <div class="dialog" style="max-width:460px;">
        <h2>🪪 참가 확인증 출력</h2>
        <p class="muted" id="cert-summary" style="margin-bottom:12px; font-size:13px;"></p>
        <div class="form-grid" style="display:grid; grid-template-columns:96px 1fr; gap:10px; align-items:start;">
          <label style="font-size:13px;">대상</label>
          <label class="row" style="font-size:13px;"><input type="checkbox" id="cert-waitlist"> 대기자도 포함 <span id="cert-wl-count" class="muted"></span></label>
          <label style="font-size:13px;">레이아웃</label>
          <div style="font-size:13px; display:flex; flex-direction:column; gap:6px;">
            <label class="row"><input type="radio" name="cert-layout" value="a" checked> A · 한 명당 한 장 (A4 큼직)</label>
            <label class="row"><input type="radio" name="cert-layout" value="b"> B · 한 장에 여러 명 (자르기 점선)</label>
          </div>
          <label style="font-size:13px;">선생님 한마디</label>
          <textarea id="cert-note" rows="3" placeholder="모든 확인증에 공통으로 들어갑니다. 예: 주말엔 정문이 닫혀 후문으로 오세요." style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;"></textarea>
          <label style="font-size:13px;">문의처</label>
          <input type="text" id="cert-contact" placeholder="예: 디지털새싹 담당 ○○○ / 052-000-0000" style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
          <label style="font-size:13px;">호칭·보상</label>
          <div style="font-size:13px;">
            <label class="row"><input type="checkbox" id="cert-title-reward"> 호칭·보상 안내 표시 <span class="muted">(누적 도장 수 기준 호칭 + 아래 문구)</span></label>
            <textarea id="cert-reward" rows="2" placeholder="체크 시 출력될 보상 안내를 직접 입력하세요. 예: 새싹왕 달성! 다음 학기 ○○ 안내 예정 (미입력 시 호칭만 표시)" style="width:100%; margin-top:6px; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;" hidden></textarea>
          </div>
        </div>
        <div class="actions" style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
          <button type="button" class="btn" id="cert-cancel">취소</button>
          <button type="button" class="btn primary" id="cert-print">미리보기 · 인쇄</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    const close = () => dlg.classList.remove('open');
    dlg.querySelector('#cert-cancel').addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    // 호칭·보상 체크 시에만 보상 문구 입력칸 노출
    const trChk = dlg.querySelector('#cert-title-reward');
    const trTa = dlg.querySelector('#cert-reward');
    trChk.addEventListener('change', () => { trTa.hidden = !trChk.checked; });
    dlg.querySelector('#cert-print').addEventListener('click', () => {
      const opts = {
        includeWaitlist: dlg.querySelector('#cert-waitlist').checked,
        layout: (dlg.querySelector('input[name="cert-layout"]:checked') || {}).value || 'a',
        note: dlg.querySelector('#cert-note').value || '',
        contact: dlg.querySelector('#cert-contact').value || '',
        showTitleReward: trChk.checked,
        rewardText: trTa.value || '',
      };
      const cards = buildCards(state.groups, opts);
      if (cards.length === 0) {
        alert('확인증을 출력할 대상이 없습니다. (취소자는 제외됩니다)');
        return;
      }
      state.lastOpts = opts;
      state.win = openPrintWindow(buildDoc(cards));
      close();
    });
    return dlg;
  }

  function openDialog(payload) {
    state.groups = (payload && payload.groups) || [];
    state.defaultContact = (payload && payload.defaultContact) || '';
    // 이수 도장판용: 학생의 도장 기록(없으면 빈 배열). 토글 콜백/권한은 호출측(admin/edit)이 주입.
    state.stamps = (payload && payload.stamps) || [];
    state.canStamp = !!(payload && payload.onToggleStamp);
    state.onToggleStamp = (payload && payload.onToggleStamp) || null;
    state.win = null;
    state.lastOpts = null;
    ensureDialog();

    let accepted = 0, waitlist = 0;
    state.groups.forEach(g => {
      const s = splitCandidates(g.candidates);
      accepted += s.accepted.length;
      waitlist += s.waitlist.length;
    });
    const progLabel = state.groups.length > 1
      ? `${state.groups.length}개 프로그램`
      : (state.groups[0] && state.groups[0].program && state.groups[0].program.title) || '';
    dlg.querySelector('#cert-summary').textContent =
      `${progLabel} · 접수/선정 ${accepted}명${waitlist ? ` · 대기 ${waitlist}명` : ''} (취소자 제외)`;
    const wl = dlg.querySelector('#cert-waitlist');
    wl.checked = false;
    wl.disabled = waitlist === 0;
    dlg.querySelector('#cert-wl-count').textContent = waitlist ? `(${waitlist}명)` : '(없음)';
    dlg.querySelector('#cert-note').value = '';
    dlg.querySelector('#cert-contact').value = state.defaultContact;
    dlg.querySelector('input[name="cert-layout"][value="a"]').checked = true;
    // 호칭·보상은 세션 한정(저장 안 함) — 열 때마다 초기화
    const trChk = dlg.querySelector('#cert-title-reward');
    const trTa = dlg.querySelector('#cert-reward');
    trChk.checked = false;
    trTa.value = '';
    trTa.hidden = true;

    dlg.classList.add('open');
  }

  global.SaessakCertificate = { openDialog };
})(typeof window !== 'undefined' ? window : globalThis);
