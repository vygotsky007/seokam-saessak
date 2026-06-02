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
  .sheet { max-width: none; margin: 0; padding: 0; }
  .cert { margin: 0 0 8px; }
  .cert-b { margin-bottom: 0; }
}`;
  }

  function openPrintWindow(html) {
    const win = global.open('', '_blank');
    if (!win) {
      alert('팝업이 차단되어 확인증 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

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
</body></html>`;
  }

  // ===== 설정 다이얼로그 =====
  let dlg = null;
  let state = { groups: [], defaultContact: '' };

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
    dlg.querySelector('#cert-print').addEventListener('click', () => {
      const opts = {
        includeWaitlist: dlg.querySelector('#cert-waitlist').checked,
        layout: (dlg.querySelector('input[name="cert-layout"]:checked') || {}).value || 'a',
        note: dlg.querySelector('#cert-note').value || '',
        contact: dlg.querySelector('#cert-contact').value || '',
      };
      const cards = buildCards(state.groups, opts);
      if (cards.length === 0) {
        alert('확인증을 출력할 대상이 없습니다. (취소자는 제외됩니다)');
        return;
      }
      openPrintWindow(buildDoc(cards));
      close();
    });
    return dlg;
  }

  function openDialog(payload) {
    state.groups = (payload && payload.groups) || [];
    state.defaultContact = (payload && payload.defaultContact) || '';
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

    dlg.classList.add('open');
  }

  global.SaessakCertificate = { openDialog };
})(typeof window !== 'undefined' ? window : globalThis);
