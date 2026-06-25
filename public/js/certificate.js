// 증서(참가 확인증 · 이수증) 생성/출력 공통 모듈 (강사 페이지·관리자 공용)
// 읽기 전용: 이미 화면에 로드된 프로그램 정보 + 신청자 명단으로 인쇄용 HTML을 만든다(DB 변경 없음).
// window.SaessakCertificate.openDialog({ groups, defaultContact, ... }) 한 함수만 외부에 노출.
//   groups: [{ program, candidates }]
//     program   : { id, title, location, instructors, organization, session_dates, start_time, end_time, extra_sessions }
//     candidates : [{ student_name, grade, class_no, status, is_waitlist }]  (취소 제외 전 후보 — 모듈이 필터)
//   defaultContact: 발급자 기본값 보조(없으면 '')
//   certImages    : 공통 이미지(QR·로고) 설정 { enabled, items:[{src,caption}] } (없으면 null)
//   onSaveImages  : async ({enabled, items}) => void  — 이미지 설정 저장 콜백
//   certConfig    : 증서 디자인 설정 { template, color, logoUrl } (없으면 null) — 마지막 선택 기억
//   onSaveConfig  : async ({template, color, logoUrl}) => void  — 디자인 설정 저장 콜백
//   onUploadLogo  : async (dataUrl) => url  — 로고 업로드(cert-assets 버킷) 콜백, public URL 반환
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

  // 메인 일정 / 보충 일정 텍스트(SaessakSchedule 재사용).
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
  // 시간 텍스트(시작~끝). 없으면 ''.
  function timeText(program) {
    const a = (program.start_time || '').toString().slice(0, 5);
    const b = (program.end_time || '').toString().slice(0, 5);
    if (a && b) return `${a} ~ ${b}`;
    return a || b || '';
  }
  // 발급일 기본값: 오늘(YYYY년 M월 D일). 브라우저 환경이므로 Date 사용 가능.
  function todayKo() {
    try {
      const d = new Date();
      return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    } catch (e) { return '2026년'; }
  }
  // 프로그램 담당교사명(첫 줄/첫 항목). 없으면 ''.
  function teacherOf(program) {
    const raw = (program && program.instructors) ? String(program.instructors).trim() : '';
    if (!raw) return '';
    // 쉼표/줄바꿈/슬래시로 여러 명이면 그대로(한 줄) 표시
    return raw.replace(/\s*\n\s*/g, ', ');
  }
  // 발급자 효과 문구: 사용자가 입력칸에 적었으면 그것, 아니면 "디지털새싹 · {담당교사}".
  function issuerFor(program, override) {
    const o = (override || '').trim();
    if (o) return o;
    const t = teacherOf(program);
    return '디지털새싹 · ' + (t || '담당교사');
  }

  // 증서 종류별 기본값
  const TYPES = {
    confirm: {
      title: '참가 확인증',
      body: '위 친구를 우리 프로그램 참가자로 선정했어요.',
      color: 'green',
      emoji: '🌱',
    },
    complete: {
      title: '이수증',
      body: '위 친구는 우리 프로그램을 끝까지 성실히 해냈어요. 잘했어요!',
      color: 'blue',
      emoji: '🎓',
    },
  };

  // ===== 디지털새싹 이수 도장판(마일리지) — 기존 기능 유지 =====
  const TITLE = { 새싹왕: 10, 새싹신: 20 };
  function titleForCount(count) {
    let best = '새싹 회원', bestN = -1;
    Object.keys(TITLE).forEach(name => {
      const n = TITLE[name];
      if (count >= n && n > bestN) { best = name; bestN = n; }
    });
    return best;
  }
  function sproutFilledSvg() {
    return `<svg class="seed-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 22 V12" stroke="#2E7D32" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M12 13 C12 8 7 6.5 3.5 7.8 C4.6 12 9 13.2 12 13 Z" fill="#81C784"/>
      <path d="M12 13 C12 7.5 17 6.5 20.5 7.8 C19.4 12 15 13.2 12 13 Z" fill="#43A047"/>
    </svg>`;
  }
  function sproutEmptySvg() {
    return `<svg class="seed-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 22 V12" stroke="#C8E6C9" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M12 13 C12 8 7 6.5 3.5 7.8 C4.6 12 9 13.2 12 13 Z" fill="none" stroke="#C8E6C9" stroke-width="1.4"/>
      <path d="M12 13 C12 7.5 17 6.5 20.5 7.8 C19.4 12 15 13.2 12 13 Z" fill="none" stroke="#C8E6C9" stroke-width="1.4"/>
    </svg>`;
  }
  function sealSvg() {
    return `<svg class="seed-seal" viewBox="0 0 40 40" width="20" height="20" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="none" stroke="#E53935" stroke-width="3"/>
      <text x="20" y="26" text-anchor="middle" font-size="15" font-weight="800" fill="#E53935">이수</text>
    </svg>`;
  }
  function stampMatch(att, s) {
    if (String(s.student_name || '').trim() !== String(att.student_name || '').trim()) return false;
    const c = att.guardian_phone;
    if (c) return s.guardian_contact === c;
    return (s.grade ?? '') === (att.grade ?? '') && (s.class_no ?? '') === (att.class_no ?? '');
  }
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
  function isStampedNow(att, program) {
    const pid = program && program.id != null ? String(program.id) : null;
    if (pid == null) return false;
    return stampedProgramsFor(att).some(p => p.program_id === pid);
  }
  // 화면 전용 "도장 찍기" 버튼(인쇄 시 숨김).
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
      stamped,
    };
    if (entry.program_id == null) return '';
    const label = stamped ? '✅ 이수 완료 — 취소하려면 클릭' : '🟢 도장 찍기 (이수)';
    return `<div class="stamp-ctrl no-print">
      <button type="button" class="stamp-btn ${stamped ? 'on' : ''}" data-stamp="${esc(JSON.stringify(entry))}">${label}</button>
      <span class="stamp-hint">※ 이 버튼은 인쇄물에는 나오지 않아요</span>
    </div>`;
  }
  // 이수 도장판 블록. compact 면 아이콘만 한 줄로 간략히.
  function growthBoard(program, att, compact, opts) {
    const filled = stampedProgramsFor(att);
    const count = filled.length;
    const emptyCount = compact ? 2 : 3;
    const filledHtml = filled.map(f => `<div class="seed filled">
      <div class="seed-top">${sproutFilledSvg()}${sealSvg()}</div>${
      compact ? '' : `<span class="seed-label" title="${esc(f.title)}">${esc(f.title)}</span>`
    }</div>`).join('');
    let emptyHtml = '';
    for (let i = 0; i < emptyCount; i++) {
      emptyHtml += `<div class="seed empty"><div class="seed-top">${sproutEmptySvg()}</div>${compact ? '' : '<span class="seed-label">&nbsp;</span>'}</div>`;
    }
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

  // 공통 이미지(QR·로고 등)를 본문 아래에 캡션과 함께 표시.
  function certImagesHtml(opts, compact) {
    const imgs = (opts && opts.images) || [];
    if (!imgs.length) return '';
    const cells = imgs.map(it => {
      if (!it || !it.src) return '';
      const cap = (it.caption && String(it.caption).trim())
        ? `<figcaption class="cert-img-cap">${esc(String(it.caption).trim())}</figcaption>` : '';
      return `<figure class="cert-img"><img src="${esc(it.src)}" alt="">${cap}</figure>`;
    }).join('');
    if (!cells) return '';
    return `<div class="cert-imgs${compact ? ' compact' : ''}">${cells}</div>`;
  }

  // 교육 장소·날짜·시간 정보박스(확인증 옵션). 값은 입력 override 우선, 없으면 프로그램 자동.
  function infoBoxHtml(program, opts) {
    const sch = scheduleTexts(program);
    const loc = (opts.infoLocation || '').trim() || program.location || '';
    const date = (opts.infoDate || '').trim() || sch.main || '';
    const time = (opts.infoTime || '').trim() || timeText(program) || '';
    const items = [];
    if (loc) items.push(`<span class="info-item"><span class="info-ic">📍</span>${esc(loc)}</span>`);
    if (date) items.push(`<span class="info-item"><span class="info-ic">📅</span>${esc(date)}</span>`);
    if (time) items.push(`<span class="info-item"><span class="info-ic">🕐</span>${esc(time)}</span>`);
    if (!items.length) return '';
    return `<div class="cert-infobox">${items.join('')}</div>`;
  }

  // 증서 1장.
  function certCard(program, att, opts, compact, flags) {
    const t = TYPES[opts.type] || TYPES.confirm;
    const sub = [att.grade ? att.grade + '학년' : '', att.class_no ? att.class_no + '반' : '']
      .filter(Boolean).join(' ');

    const logo = (opts.logoUrl)
      ? `<div class="cert-logo"><img src="${esc(opts.logoUrl)}" alt=""></div>` : '';

    const message = (opts.bodyText && opts.bodyText.trim())
      ? `<div class="cert-message">${nl2br(opts.bodyText.trim())}</div>` : '';

    // 교육 장소·날짜·시간(확인증 전용 옵션)
    const info = (opts.type === 'confirm' && opts.showInfo) ? infoBoxHtml(program, opts) : '';

    // 선생님 한마디(공통 옵션) — 노란 메모박스
    const note = (opts.showNote && opts.note && opts.note.trim())
      ? `<div class="cert-note"><span class="cert-note-lbl">✏️ 선생님 한마디</span>${nl2br(opts.note.trim())}</div>` : '';

    // 기타 주의사항(확인증 전용 옵션) — 노란 안내 줄
    const caution = (opts.type === 'confirm' && opts.showCaution && opts.caution && opts.caution.trim())
      ? `<div class="cert-caution"><span class="cert-caution-lbl">⚠ 안내</span> ${nl2br(opts.caution.trim())}</div>` : '';

    const board = opts.showBoard
      ? stampControl(program, att) + growthBoard(program, att, compact, opts) : '';

    const issuer = issuerFor(program, opts.issuer);
    const dateStr = (opts.issueDate || '').trim() || todayKo();

    const cls = ['cert', 'tpl-' + (opts.template || 'sprout'), 'clr-' + (opts.color || t.color)];
    if (compact) cls.push('cert-compact');
    if (flags && flags.pageBreak) cls.push('pb');

    return `<div class="${cls.join(' ')}">
      <div class="cert-inner">
        <div class="cert-deco" aria-hidden="true"></div>
        ${logo}
        <div class="cert-head">
          <div class="cert-school">${t.emoji} 석암초 디지털새싹</div>
          <div class="cert-title">${esc(t.title)}</div>
        </div>
        <div class="cert-body">
          <div class="cert-name-wrap">
            ${sub ? `<div class="cert-sub">${esc(sub)}</div>` : ''}
            <div class="cert-name">${esc(att.student_name || '')}</div>
          </div>
          <div class="cert-prog">${esc(program.title || '')}</div>
          ${message}
          ${info}
          ${note}
          ${caution}
          ${board}
        </div>
        <div class="cert-foot">
          <div class="cert-date">${esc(dateStr)}</div>
          <div class="cert-issuer">${esc(issuer)}</div>
        </div>
        ${certImagesHtml(opts, compact)}
      </div>
    </div>`;
  }

  function buildCards(groups, opts) {
    const cards = [];
    groups.forEach((g) => {
      const { accepted, waitlist } = splitCandidates(g.candidates);
      let list = accepted.slice();
      if (opts.includeWaitlist) list = list.concat(waitlist);
      list.forEach((att) => {
        cards.push(certCard(g.program, att, opts, opts.perPage !== 1, {}));
      });
    });
    return cards;
  }

  // 출력 크기 프리셋 → 한 페이지당 장수
  function perPageCount(perPage) {
    if (perPage === 2) return 2;
    if (perPage === 4) return 4;
    if (perPage === 'card') return 2;
    return 1;
  }

  // 카드들을 페이지 단위(N장)로 묶어 .page 로 감싼다. 여러 장이면 자르기 점선.
  function paginate(cards, opts) {
    const n = perPageCount(opts.perPage);
    const isCard = opts.perPage === 'card';
    const ppClass = isCard ? 'pp-card' : ('pp-' + n);
    const multi = n > 1;
    const pages = [];
    for (let i = 0; i < cards.length; i += n) {
      const chunk = cards.slice(i, i + n);
      pages.push(`<div class="page ${ppClass}${multi ? ' multi' : ''}">${chunk.join('')}</div>`);
    }
    return pages.join('');
  }

  function printCss(opts) {
    const scale = Math.max(0.5, Math.min(1.5, (opts && opts.scale ? opts.scale : 100) / 100));
    return `
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Pretendard','Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
  color: #25303a; background: #eef1f4;
}
.toolbar {
  position: sticky; top: 0; z-index: 50; background: #37474F; color: #fff; padding: 10px 16px;
  display: flex; align-items: center; gap: 10px; font-size: 14px; flex-wrap: wrap;
}
.toolbar button {
  background: #fff; color: #263238; border: 0; border-radius: 8px;
  padding: 8px 16px; font-size: 14px; font-weight: 800; cursor: pointer;
}
.toolbar button.ghost { background: rgba(255,255,255,.16); color: #fff; }
.toolbar .hint { font-size: 12.5px; opacity: .92; }
.book { padding: 14px 0 40px; }

/* ===== 페이지(출력 크기) ===== */
.page { width: 190mm; margin: 0 auto 16px; background: transparent; }
.page.pp-1 { display: block; }
.page.pp-2 { display: grid; grid-template-rows: 1fr 1fr; gap: 6mm; min-height: 277mm; }
.page.pp-4 { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 5mm; min-height: 277mm; }
.page.pp-card { display: grid; grid-template-rows: 1fr 1fr; gap: 8mm; min-height: 277mm; justify-items: center; }
.page.multi .cert { height: 100%; }

/* ===== 증서 카드 ===== */
.cert {
  --c-main: #2E7D32; --c-dark: #1B5E20; --c-soft: #A5D6A7; --c-bg: #E8F5E9; --c-grad: #F1F8E9;
  background: #fff; border-radius: 18px; overflow: hidden; position: relative;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  page-break-inside: avoid; break-inside: avoid;
}
.cert.pb { page-break-before: always; break-before: page; }
.cert-inner { position: relative; padding: 26px 30px; zoom: ${scale}; height: 100%; display: flex; flex-direction: column; }

/* 테마 색 */
.clr-green  { --c-main:#2E7D32; --c-dark:#1B5E20; --c-soft:#A5D6A7; --c-bg:#E8F5E9; --c-grad:#F1F8E9; }
.clr-blue   { --c-main:#1565C0; --c-dark:#0D47A1; --c-soft:#90CAF9; --c-bg:#E3F2FD; --c-grad:#E8F1FB; }
.clr-orange { --c-main:#E65100; --c-dark:#BF360C; --c-soft:#FFCC80; --c-bg:#FFF3E0; --c-grad:#FFF6EA; }

.cert { border: 2px solid var(--c-soft); }
.cert-deco { position: absolute; inset: 0 0 auto 0; height: 8px; background: linear-gradient(90deg, var(--c-main), var(--c-soft)); }

.cert-logo { text-align: center; margin: 4px 0 2px; }
.cert-logo img { max-height: 56px; max-width: 180px; object-fit: contain; }

.cert-head { text-align: center; padding: 8px 0 12px; margin-bottom: 10px; border-bottom: 2px dashed var(--c-soft); }
.cert-school { font-size: 15px; font-weight: 800; color: var(--c-main); letter-spacing: .3px; }
.cert-title { font-size: 26px; font-weight: 900; color: var(--c-dark); margin-top: 6px; }

.cert-body { flex: 1; }
.cert-name-wrap { text-align: center; margin-bottom: 12px; }
.cert-sub { font-size: 14px; color: #6b7682; margin-bottom: 2px; }
.cert-name { font-size: 32px; font-weight: 900; color: #1f2a33; }
.cert-prog {
  text-align: center; font-size: 17px; font-weight: 800; color: var(--c-main);
  background: var(--c-bg); border-radius: 999px; padding: 7px 16px; margin: 0 auto 14px;
  display: inline-block; left: 50%;
}
.cert-body { text-align: center; }
.cert-prog { display: table; margin-left: auto; margin-right: auto; }
.cert-message {
  font-size: 16px; line-height: 1.7; color: #36424d; margin: 6px auto 14px; max-width: 90%;
  background: var(--c-grad); border-radius: 12px; padding: 14px 18px;
}

/* 교육 장소·날짜·시간 정보박스 */
.cert-infobox {
  display: flex; flex-wrap: wrap; gap: 8px 18px; justify-content: center;
  background: #fff; border: 1.5px solid var(--c-soft); border-radius: 12px;
  padding: 10px 14px; margin: 0 auto 12px; max-width: 92%; font-size: 14px; color: #36424d;
}
.cert-infobox .info-item { white-space: nowrap; }
.cert-infobox .info-ic { margin-right: 4px; }

/* 선생님 한마디 — 노란 메모박스 */
.cert-note {
  text-align: left; margin: 0 auto 12px; max-width: 92%;
  background: #FFF8E1; border: 1.5px solid #FFE082; border-left: 5px solid #FBC02D;
  border-radius: 10px; padding: 10px 14px; font-size: 13.5px; line-height: 1.6; color: #5b4a16;
}
.cert-note-lbl { display: block; font-weight: 800; color: #B8860B; margin-bottom: 3px; font-size: 12.5px; }

/* 기타 주의사항 — 노란 안내 줄 */
.cert-caution {
  text-align: left; margin: 0 auto 12px; max-width: 92%;
  background: #FFFDE7; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; color: #6b5a14; line-height: 1.55;
}
.cert-caution-lbl { font-weight: 800; color: #C77800; margin-right: 4px; }

.cert-foot {
  margin-top: auto; padding-top: 14px; display: flex; align-items: flex-end; justify-content: space-between;
  border-top: 1px solid #eceff1;
}
.cert-date { font-size: 13px; color: #6b7682; }
.cert-issuer { font-size: 14px; font-weight: 800; color: var(--c-dark); }

/* 화면 전용 도장 버튼 */
.stamp-ctrl { margin: 12px auto 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.stamp-btn {
  border: 1.5px solid var(--c-main); background: #fff; color: var(--c-main);
  border-radius: 999px; padding: 7px 16px; font-size: 13.5px; font-weight: 800; cursor: pointer;
}
.stamp-btn.on { background: var(--c-main); color: #fff; }
.stamp-btn:disabled { opacity: .6; cursor: default; }
.stamp-hint { font-size: 11.5px; color: #8a9a8c; }

/* 이수 도장판 */
.cert-board {
  text-align: left; margin: 14px auto 0; max-width: 92%; padding: 14px 16px;
  background: var(--c-grad); border: 1.5px dashed var(--c-soft); border-radius: 12px;
  page-break-inside: avoid; break-inside: avoid;
}
.cert-board-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.cert-board-title { font-size: 14px; font-weight: 800; color: var(--c-main); }
.cert-board-count { color: var(--c-dark); font-weight: 800; white-space: nowrap; }
.cert-board-count .count-num { font-size: 26px; line-height: 1; }
.cert-board-count .count-unit { font-size: 12px; margin-left: 2px; }
.cert-board-grid { display: flex; flex-wrap: wrap; gap: 12px 14px; align-items: flex-start; }
.seed { display: flex; flex-direction: column; align-items: center; width: 64px; }
.seed-top { display: flex; align-items: center; gap: 2px; }
.seed-ico, .seed-seal { display: block; }
.seed-label {
  margin-top: 3px; font-size: 10.5px; line-height: 1.2; text-align: center; color: #33491f;
  max-width: 64px; max-height: 26px; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.seed.empty .seed-label { color: transparent; }
.cert-board-msg { margin-top: 12px; font-size: 12.5px; color: var(--c-main); text-align: center; font-weight: 700; }
.cert-reward { margin-top: 12px; text-align: center; }
.reward-badge {
  display: inline-block; background: #FFF3E0; color: #E65100; border: 1.5px solid #FFB74D;
  border-radius: 999px; padding: 4px 14px; font-size: 14px; font-weight: 800;
}
.reward-body { margin-top: 8px; font-size: 12.5px; color: #5D4037; line-height: 1.6; }
.cert-board-compact { margin-top: 10px; padding: 8px 12px; }
.cert-board-compact .cert-board-title { font-size: 12.5px; }
.cert-board-compact .cert-board-count .count-num { font-size: 18px; }
.cert-board-compact .cert-board-grid { gap: 6px; }
.cert-board-compact .seed { width: auto; }
.cert-board-compact .cert-board-msg, .cert-board-compact .cert-reward { margin-top: 6px; font-size: 11px; }

/* 공통 이미지(QR·로고) */
.cert-imgs { display: flex; flex-wrap: wrap; gap: 14px 18px; justify-content: center; align-items: flex-start; margin-top: 12px; page-break-inside: avoid; break-inside: avoid; }
.cert-img { margin: 0; display: flex; flex-direction: column; align-items: center; max-width: 150px; }
.cert-img img { display: block; width: auto; height: auto; max-width: 140px; max-height: 140px; object-fit: contain; background: #fff; border: 1px solid #cfd9cf; border-radius: 6px; padding: 3px; }
.cert-img-cap { margin-top: 5px; font-size: 11.5px; line-height: 1.35; color: #455; text-align: center; max-width: 140px; word-break: keep-all; }
.cert-imgs.compact { gap: 8px 12px; margin-top: 8px; }
.cert-imgs.compact .cert-img { max-width: 96px; }
.cert-imgs.compact .cert-img img { max-width: 90px; max-height: 90px; }
.cert-imgs.compact .cert-img-cap { font-size: 10px; max-width: 90px; margin-top: 3px; }

/* ===== 출력 크기별 본문 조정 ===== */
.pp-1 .cert { min-height: 273mm; }
.pp-1 .cert-name { font-size: 38px; }
.pp-1 .cert-title { font-size: 30px; }
.pp-1 .cert-message { font-size: 18px; }
.cert-compact .cert-inner { padding: 16px 20px; }
.cert-compact .cert-title { font-size: 19px; }
.cert-compact .cert-name { font-size: 23px; }
.cert-compact .cert-prog { font-size: 14px; padding: 5px 12px; }
.cert-compact .cert-message { font-size: 13px; padding: 9px 12px; margin-bottom: 9px; }
.cert-compact .cert-head { padding: 4px 0 8px; margin-bottom: 7px; }
.cert-compact .cert-logo img { max-height: 40px; }
.pp-4 .cert-inner { padding: 12px 14px; }
.pp-4 .cert-name { font-size: 20px; }
.pp-4 .cert-title { font-size: 17px; }
.pp-card .cert { max-width: 150mm; border-radius: 22px; border-style: solid; }
.pp-card .cert-inner { padding: 22px 26px; }

/* ===== 템플릿 ===== */
/* 심플형: 장식 최소화, 얇은 테두리 */
.tpl-simple { border-width: 1px; box-shadow: none; border-radius: 10px; }
.tpl-simple .cert-deco { display: none; }
.tpl-simple .cert-head { border-bottom-style: solid; border-bottom-width: 1px; }
.tpl-simple .cert-prog { background: transparent; border: 1.5px solid var(--c-soft); }
.tpl-simple .cert-message { background: transparent; border: 1px dashed var(--c-soft); }
/* 축하형: 풍성한 그라데이션 배경 + 굵은 장식 */
.tpl-celebrate { border-width: 3px; }
.tpl-celebrate .cert-inner { background: linear-gradient(160deg, var(--c-grad), #ffffff 55%); }
.tpl-celebrate .cert-deco { height: 14px; background: repeating-linear-gradient(45deg, var(--c-main), var(--c-main) 10px, var(--c-soft) 10px, var(--c-soft) 20px); }
.tpl-celebrate .cert-head { border-bottom: none; }
.tpl-celebrate .cert-head::after { content: '🎉  🎊  🎉'; display: block; font-size: 16px; margin-top: 6px; letter-spacing: 6px; }
.tpl-celebrate .cert-name { color: var(--c-dark); }
.tpl-celebrate .cert-prog { box-shadow: 0 2px 0 var(--c-soft); }

@media print {
  body { background: #fff; }
  .toolbar { display: none !important; }
  .no-print, .stamp-ctrl { display: none !important; }
  .book { padding: 0; }
  .page { width: auto; margin: 0; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .cert { box-shadow: none; margin: 0; }
}`;
  }

  function openPrintWindow(html) {
    const win = global.open('', '_blank');
    if (!win) {
      alert('팝업이 차단되어 증서 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.');
      return null;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    return win;
  }

  // 미리보기 창의 "도장 찍기" → opener(원래 창) 브릿지로 위임.
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

  function buildDoc(cards, opts) {
    const pages = paginate(cards, opts);
    const title = (TYPES[opts.type] || TYPES.confirm).title;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><style>${printCss(opts)}</style></head>
<body>
<div class="toolbar no-print">
  <button type="button" onclick="window.print()">🖨 인쇄</button>
  <button type="button" class="ghost" onclick="window.print()">📄 PDF로 저장</button>
  <span class="hint">PDF는 인쇄 대화상자에서 ‘대상 → PDF로 저장’을 고르면 파일로 받을 수 있어요.</span>
</div>
<div class="book">${pages}</div>
${PREVIEW_SCRIPT}
</body></html>`;
  }

  function rerenderPreview() {
    if (!state.win || state.win.closed) return;
    const cards = buildCards(state.groups, state.lastOpts || {});
    state.win.document.open();
    state.win.document.write(buildDoc(cards, state.lastOpts || {}));
    state.win.document.close();
  }

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
    stamps: [], canStamp: false, onToggleStamp: null,
    win: null, lastOpts: null,
    imgItems: [], imgEnabled: false, onSaveImages: null,
    // 디자인 설정(템플릿/색/로고)
    template: 'sprout', color: '', logoUrl: '', onSaveConfig: null, onUploadLogo: null,
  };

  const IMG_MAX_W = 600;

  // 파일을 캔버스로 리사이즈 후 흰 배경 합성하여 jpeg base64 dataURL 반환.
  function resizeImageFile(file, cb, maxW) {
    const limit = maxW || IMG_MAX_W;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) { URL.revokeObjectURL(url); cb(null); return; }
        if (w > limit) { h = Math.round(h * limit / w); w = limit; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cb(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { URL.revokeObjectURL(url); cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  function renderImgList() {
    if (!dlg) return;
    const wrap = dlg.querySelector('#cert-img-list');
    if (!wrap) return;
    if (!state.imgItems.length) {
      wrap.innerHTML = '<div class="muted" style="font-size:12px; padding:4px 0;">아직 추가된 이미지가 없습니다. 아래 “＋ 이미지 추가”로 올려 주세요.</div>';
      return;
    }
    wrap.innerHTML = state.imgItems.map((it, i) => `
      <div class="cert-imgrow" data-idx="${i}" style="display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-top:1px solid #eef2ee;">
        <img src="${esc(it.src)}" alt="" style="width:54px; height:54px; object-fit:contain; border:1px solid #dde5dd; border-radius:6px; background:#fff; flex:0 0 auto;">
        <input type="text" class="cert-imgcap" data-idx="${i}" value="${esc(it.caption || '')}" placeholder="안내문구(선택) 예: 카톡방 입장 QR"
          style="flex:1 1 auto; min-width:0; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:12.5px;">
        <button type="button" class="cert-imgdel btn" data-idx="${i}" style="flex:0 0 auto; padding:6px 10px; font-size:12px;">삭제</button>
      </div>`).join('');
  }

  // 로고 미리보기 갱신
  function renderLogo() {
    if (!dlg) return;
    const wrap = dlg.querySelector('#cert-logo-preview');
    if (!wrap) return;
    if (state.logoUrl) {
      wrap.innerHTML = `<img src="${esc(state.logoUrl)}" alt="" style="max-height:48px; max-width:160px; object-fit:contain; border:1px solid #dde5dd; border-radius:6px; padding:3px; background:#fff;">
        <button type="button" class="btn" id="cert-logo-clear" style="margin-left:8px; padding:5px 10px; font-size:12px;">로고 제거</button>`;
    } else {
      wrap.innerHTML = '<span class="muted" style="font-size:12px;">아직 없음 — 상단에 표시할 학교 로고/마스코트를 올려 주세요(선택).</span>';
    }
  }

  // 현재 다이얼로그 입력값 → opts
  function readOpts() {
    const type = (dlg.querySelector('input[name="cert-type"]:checked') || {}).value || 'confirm';
    const t = TYPES[type] || TYPES.confirm;
    const perPageRaw = (dlg.querySelector('input[name="cert-perpage"]:checked') || {}).value || '2';
    const perPage = perPageRaw === 'card' ? 'card' : Number(perPageRaw);
    const trChk = dlg.querySelector('#cert-title-reward');
    const colorSel = (dlg.querySelector('input[name="cert-color"]:checked') || {}).value || '';
    return {
      type,
      template: (dlg.querySelector('input[name="cert-template"]:checked') || {}).value || 'sprout',
      color: colorSel || t.color,
      perPage,
      scale: Number(dlg.querySelector('#cert-scale').value) || 100,
      bodyText: dlg.querySelector('#cert-body').value || t.body,
      issueDate: dlg.querySelector('#cert-date').value || '',
      issuer: dlg.querySelector('#cert-issuer').value || '',
      includeWaitlist: dlg.querySelector('#cert-waitlist').checked,
      showNote: dlg.querySelector('#cert-note-on').checked,
      note: dlg.querySelector('#cert-note').value || '',
      showInfo: dlg.querySelector('#cert-info-on').checked,
      infoLocation: dlg.querySelector('#cert-info-loc').value || '',
      infoDate: dlg.querySelector('#cert-info-date').value || '',
      infoTime: dlg.querySelector('#cert-info-time').value || '',
      showCaution: dlg.querySelector('#cert-caution-on').checked,
      caution: dlg.querySelector('#cert-caution').value || '',
      showBoard: dlg.querySelector('#cert-board-on').checked,
      showTitleReward: trChk.checked,
      rewardText: dlg.querySelector('#cert-reward').value || '',
      logoUrl: state.logoUrl || '',
      images: state.imgEnabled ? state.imgItems.slice() : [],
    };
  }

  // 증서 종류 바뀔 때 본문문구/테마색 기본값 동기화(사용자가 직접 안 건드렸으면)
  function syncTypeDefaults() {
    const type = (dlg.querySelector('input[name="cert-type"]:checked') || {}).value || 'confirm';
    const t = TYPES[type] || TYPES.confirm;
    const bodyEl = dlg.querySelector('#cert-body');
    if (!bodyEl.dataset.touched) bodyEl.value = t.body;
    bodyEl.placeholder = t.body;
    // 색을 직접 고르지 않았으면 종류 기본색으로
    if (!dlg.dataset.colorTouched) {
      const r = dlg.querySelector(`input[name="cert-color"][value="${t.color}"]`);
      if (r) r.checked = true;
    }
    // 확인증 전용 옵션(장소·시간 / 주의사항) 노출 토글
    const confirmOnly = dlg.querySelectorAll('.confirm-only');
    confirmOnly.forEach(el => { el.style.display = (type === 'confirm') ? '' : 'none'; });
  }

  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.className = 'dialog-mask';
    dlg.id = 'cert-dialog';
    dlg.innerHTML = `
      <div class="dialog" style="max-width:520px; max-height:90vh; overflow:auto;">
        <h2>🪪 증서 출력 (확인증 · 이수증)</h2>
        <p class="muted" id="cert-summary" style="margin-bottom:12px; font-size:13px;"></p>

        <div class="cert-sec">
          <div class="cert-sec-t">증서 종류</div>
          <div class="row-wrap">
            <label class="row"><input type="radio" name="cert-type" value="confirm" checked> 참가 확인증 <span class="muted">(선정)</span></label>
            <label class="row"><input type="radio" name="cert-type" value="complete"> 이수증 <span class="muted">(수료)</span></label>
          </div>
        </div>

        <div class="cert-sec">
          <div class="cert-sec-t">디자인</div>
          <div class="cert-sub-l">템플릿</div>
          <div class="row-wrap">
            <label class="row"><input type="radio" name="cert-template" value="sprout" checked> 새싹형</label>
            <label class="row"><input type="radio" name="cert-template" value="simple"> 심플형</label>
            <label class="row"><input type="radio" name="cert-template" value="celebrate"> 축하형</label>
          </div>
          <div class="cert-sub-l" style="margin-top:8px;">테마 색</div>
          <div class="row-wrap" id="cert-color-wrap">
            <label class="row"><input type="radio" name="cert-color" value="green" checked> 🟢 초록</label>
            <label class="row"><input type="radio" name="cert-color" value="blue"> 🔵 파랑</label>
            <label class="row"><input type="radio" name="cert-color" value="orange"> 🟠 주황</label>
          </div>
          <div class="cert-sub-l" style="margin-top:8px;">로고/마스코트 <span class="muted">(상단 표시·선택)</span></div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <div id="cert-logo-preview" style="display:flex; align-items:center; gap:6px;"></div>
          </div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap;">
            <label class="btn" style="cursor:pointer; font-size:12.5px;">＋ 로고 올리기
              <input type="file" id="cert-logo-file" accept="image/*" hidden>
            </label>
            <span id="cert-logo-status" class="muted" style="font-size:12px;"></span>
          </div>
        </div>

        <div class="cert-sec">
          <div class="cert-sec-t">출력 크기</div>
          <div class="row-wrap">
            <label class="row"><input type="radio" name="cert-perpage" value="1"> A4 1장</label>
            <label class="row"><input type="radio" name="cert-perpage" value="2" checked> 반쪽(2장)</label>
            <label class="row"><input type="radio" name="cert-perpage" value="4"> 4장</label>
            <label class="row"><input type="radio" name="cert-perpage" value="card"> 편지지(카드)</label>
          </div>
          <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
            <span class="cert-sub-l" style="margin:0;">크기 미세조정</span>
            <input type="range" id="cert-scale" min="70" max="120" value="100" step="1" style="flex:1;">
            <span id="cert-scale-val" class="muted" style="font-size:12.5px; width:42px; text-align:right;">100%</span>
          </div>
          <label class="row" style="margin-top:8px; font-size:13px;"><input type="checkbox" id="cert-waitlist"> 대기자도 포함 <span id="cert-wl-count" class="muted"></span></label>
        </div>

        <div class="cert-sec">
          <div class="cert-sec-t">내용</div>
          <div class="cert-sub-l">본문 문구</div>
          <textarea id="cert-body" rows="2" style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;"></textarea>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
            <div>
              <div class="cert-sub-l">발급일</div>
              <input type="text" id="cert-date" placeholder="예: 2026년 6월 25일" style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
            </div>
            <div>
              <div class="cert-sub-l">발급자</div>
              <input type="text" id="cert-issuer" placeholder="" style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
            </div>
          </div>
        </div>

        <div class="cert-sec">
          <div class="cert-sec-t">옵션 <span class="muted" style="font-weight:400;">(켜면 표시, 끄면 빠짐)</span></div>

          <label class="row opt-h"><input type="checkbox" id="cert-note-on"> ✏️ 선생님 한마디</label>
          <textarea id="cert-note" rows="2" placeholder="모든 증서에 공통으로 들어갑니다. 예: 끝까지 열심히 한 모습이 멋졌어요!" style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;" hidden></textarea>

          <div class="confirm-only">
            <label class="row opt-h" style="margin-top:10px;"><input type="checkbox" id="cert-info-on"> 📍 교육 장소·날짜·시간 <span class="muted">(확인증)</span></label>
            <div id="cert-info-fields" hidden style="display:grid; grid-template-columns:1fr; gap:6px;">
              <input type="text" id="cert-info-loc" placeholder="장소(자동: 프로그램 장소)" style="border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
              <input type="text" id="cert-info-date" placeholder="날짜(자동: 프로그램 일정)" style="border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
              <input type="text" id="cert-info-time" placeholder="시간(자동: 시작~끝)" style="border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;">
            </div>
          </div>

          <div class="confirm-only">
            <label class="row opt-h" style="margin-top:10px;"><input type="checkbox" id="cert-caution-on"> ⚠ 기타 주의사항 <span class="muted">(확인증)</span></label>
            <textarea id="cert-caution" rows="2" placeholder="예: 첫날 9시까지 1층 컴퓨터실로 와 주세요." style="width:100%; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;" hidden></textarea>
          </div>

          <label class="row opt-h" style="margin-top:10px;"><input type="checkbox" id="cert-board-on" checked> 🌱 이수 도장판 표시</label>
          <div id="cert-board-extra">
            <label class="row" style="font-size:12.5px; margin-top:4px;"><input type="checkbox" id="cert-title-reward"> 호칭·보상 안내 표시 <span class="muted">(누적 도장 수 기준)</span></label>
            <textarea id="cert-reward" rows="2" placeholder="체크 시 출력될 보상 안내. 예: 새싹왕 달성! (미입력 시 호칭만)" style="width:100%; margin-top:6px; border:1px solid #cbd5d1; border-radius:7px; padding:6px 9px; font-size:13px;" hidden></textarea>
          </div>
        </div>

        <div class="cert-sec">
          <div class="cert-sec-t">이미지(QR·로고 등) <span class="muted" style="font-weight:400;">— 본문 아래 표시</span></div>
          <label class="row" style="font-size:13px;"><input type="checkbox" id="cert-img-show"> 증서에 이미지 표시 <span class="muted">(안 켜면 안 나옴)</span></label>
          <p class="muted" style="font-size:11.5px; margin:4px 0 8px;">업로드 시 가로 최대 ${IMG_MAX_W}px로 자동 축소. 설정은 다음 출력·다른 기기에서도 기억됩니다.</p>
          <div id="cert-img-list"></div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">
            <label class="btn" style="cursor:pointer; font-size:12.5px;">＋ 이미지 추가
              <input type="file" id="cert-img-file" accept="image/*" multiple hidden>
            </label>
            <button type="button" class="btn" id="cert-img-save" style="font-size:12.5px;">이미지 설정 저장</button>
            <span id="cert-img-status" class="muted" style="font-size:12px;"></span>
          </div>
        </div>

        <div class="actions" style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px; position:sticky; bottom:0; background:#fff; padding-top:10px;">
          <button type="button" class="btn" id="cert-cancel">취소</button>
          <button type="button" class="btn primary" id="cert-print">미리보기 · 인쇄/PDF</button>
        </div>
      </div>`;
    // 다이얼로그 전용 약식 스타일(없으면 기본 .row/.btn 만 사용)
    const styleId = 'cert-dialog-style';
    if (!document.getElementById(styleId)) {
      const st = document.createElement('style');
      st.id = styleId;
      st.textContent = `
        #cert-dialog .cert-sec { border-top:1px solid #eef2ee; padding-top:12px; margin-top:12px; }
        #cert-dialog .cert-sec:first-of-type { border-top:0; padding-top:0; margin-top:0; }
        #cert-dialog .cert-sec-t { font-size:13px; font-weight:800; color:#37474F; margin-bottom:8px; }
        #cert-dialog .cert-sub-l { font-size:12px; font-weight:700; color:#607d8b; margin-bottom:4px; }
        #cert-dialog .row-wrap { display:flex; gap:14px; flex-wrap:wrap; font-size:13px; }
        #cert-dialog .row { display:flex; align-items:center; gap:5px; }
        #cert-dialog .opt-h { font-size:13px; font-weight:700; }
      `;
      document.head.appendChild(st);
    }
    document.body.appendChild(dlg);

    const close = () => dlg.classList.remove('open');
    dlg.querySelector('#cert-cancel').addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

    // 종류 변경 → 기본값 동기화
    dlg.querySelectorAll('input[name="cert-type"]').forEach(r =>
      r.addEventListener('change', syncTypeDefaults));
    // 본문/색 사용자 편집 흔적 표시(종류 바뀌어도 보존)
    dlg.querySelector('#cert-body').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    dlg.querySelectorAll('input[name="cert-color"]').forEach(r =>
      r.addEventListener('change', () => { dlg.dataset.colorTouched = '1'; }));

    // 크기 슬라이더 값 표시
    const scale = dlg.querySelector('#cert-scale');
    const scaleVal = dlg.querySelector('#cert-scale-val');
    scale.addEventListener('input', () => { scaleVal.textContent = scale.value + '%'; });

    // 옵션 토글 → 입력칸 노출
    const toggle = (chkId, targetId) => {
      const chk = dlg.querySelector(chkId);
      const tgt = dlg.querySelector(targetId);
      chk.addEventListener('change', () => { tgt.hidden = !chk.checked; });
    };
    toggle('#cert-note-on', '#cert-note');
    toggle('#cert-info-on', '#cert-info-fields');
    toggle('#cert-caution-on', '#cert-caution');
    const boardOn = dlg.querySelector('#cert-board-on');
    const boardExtra = dlg.querySelector('#cert-board-extra');
    boardOn.addEventListener('change', () => { boardExtra.style.display = boardOn.checked ? '' : 'none'; });
    const trChk = dlg.querySelector('#cert-title-reward');
    const trTa = dlg.querySelector('#cert-reward');
    trChk.addEventListener('change', () => { trTa.hidden = !trChk.checked; });

    // ===== 로고 업로드 =====
    const logoStatus = dlg.querySelector('#cert-logo-status');
    const logoFile = dlg.querySelector('#cert-logo-file');
    logoFile.addEventListener('change', (e) => {
      const f = (e.target.files || [])[0];
      e.target.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { logoStatus.textContent = '이미지 파일만 가능합니다.'; return; }
      logoStatus.textContent = '업로드 중…';
      resizeImageFile(f, async (dataUrl) => {
        if (!dataUrl) { logoStatus.textContent = '이미지 처리 실패'; return; }
        try {
          let url = dataUrl;
          if (state.onUploadLogo) url = await state.onUploadLogo(dataUrl); // 버킷 업로드 → public URL
          state.logoUrl = url;
          renderLogo();
          bindLogoClear();
          logoStatus.textContent = state.onUploadLogo ? '올렸어요 ✓' : '미리보기만(서버 저장 미지원)';
          logoStatus.style.color = '#2E7D32';
        } catch (err) {
          logoStatus.textContent = '업로드 실패: ' + ((err && err.message) || err);
          logoStatus.style.color = '#c0392b';
        }
      }, 400);
    });
    function bindLogoClear() {
      const btn = dlg.querySelector('#cert-logo-clear');
      if (btn) btn.addEventListener('click', () => { state.logoUrl = ''; renderLogo(); bindLogoClear(); });
    }
    dlg._bindLogoClear = bindLogoClear;

    // ===== 공통 이미지 설정 =====
    const imgStatus = dlg.querySelector('#cert-img-status');
    const setImgStatus = (msg, ok) => {
      imgStatus.textContent = msg || '';
      imgStatus.style.color = ok === false ? '#c0392b' : (ok ? '#2E7D32' : '#8a9a8c');
    };
    dlg.querySelector('#cert-img-show').addEventListener('change', (e) => {
      state.imgEnabled = e.target.checked;
    });
    const fileInput = dlg.querySelector('#cert-img-file');
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      setImgStatus('이미지 처리 중…');
      let pending = files.length;
      files.forEach(f => {
        if (!/^image\//.test(f.type)) { if (--pending === 0) { renderImgList(); setImgStatus(''); } return; }
        resizeImageFile(f, (dataUrl) => {
          if (dataUrl) state.imgItems.push({ src: dataUrl, caption: '' });
          if (--pending === 0) {
            renderImgList();
            if (!state.imgEnabled) { state.imgEnabled = true; dlg.querySelector('#cert-img-show').checked = true; }
            setImgStatus('추가됨 (저장하려면 “이미지 설정 저장”)', true);
          }
        });
      });
      e.target.value = '';
    });
    const imgList = dlg.querySelector('#cert-img-list');
    imgList.addEventListener('input', (e) => {
      const cap = e.target.closest('.cert-imgcap');
      if (!cap) return;
      const i = Number(cap.getAttribute('data-idx'));
      if (state.imgItems[i]) state.imgItems[i].caption = cap.value;
    });
    imgList.addEventListener('click', (e) => {
      const del = e.target.closest('.cert-imgdel');
      if (!del) return;
      const i = Number(del.getAttribute('data-idx'));
      state.imgItems.splice(i, 1);
      renderImgList();
      setImgStatus('삭제됨 (저장하려면 “이미지 설정 저장”)', true);
    });
    dlg.querySelector('#cert-img-save').addEventListener('click', async () => {
      if (!state.onSaveImages) { setImgStatus('이 화면에서는 저장을 지원하지 않습니다.', false); return; }
      setImgStatus('저장 중…');
      try {
        await state.onSaveImages({ enabled: state.imgEnabled, items: state.imgItems });
        setImgStatus('저장됨 ✓', true);
      } catch (err) {
        setImgStatus('저장 실패: ' + ((err && err.message) || err), false);
      }
    });

    // ===== 인쇄 =====
    dlg.querySelector('#cert-print').addEventListener('click', () => {
      const opts = readOpts();
      const cards = buildCards(state.groups, opts);
      if (cards.length === 0) {
        alert('출력할 대상이 없습니다. (취소자는 제외됩니다)');
        return;
      }
      // 이미지·디자인 설정 조용히 저장(다음 출력·다른 기기에서 기억). 실패해도 인쇄는 진행.
      if (state.onSaveImages) {
        Promise.resolve(state.onSaveImages({ enabled: state.imgEnabled, items: state.imgItems })).catch(() => {});
      }
      if (state.onSaveConfig) {
        Promise.resolve(state.onSaveConfig({ template: opts.template, color: opts.color, logoUrl: state.logoUrl || '' })).catch(() => {});
      }
      state.lastOpts = opts;
      state.win = openPrintWindow(buildDoc(cards, opts));
      close();
    });
    return dlg;
  }

  function openDialog(payload) {
    state.groups = (payload && payload.groups) || [];
    state.defaultContact = (payload && payload.defaultContact) || '';
    state.stamps = (payload && payload.stamps) || [];
    state.canStamp = !!(payload && payload.onToggleStamp);
    state.onToggleStamp = (payload && payload.onToggleStamp) || null;
    // 공통 이미지
    const ci = (payload && payload.certImages) || null;
    state.imgEnabled = !!(ci && ci.enabled);
    state.imgItems = (ci && Array.isArray(ci.items))
      ? ci.items.filter(x => x && x.src).map(x => ({ src: x.src, caption: x.caption || '' }))
      : [];
    state.onSaveImages = (payload && payload.onSaveImages) || null;
    // 디자인 설정(템플릿/색/로고)
    const cc = (payload && payload.certConfig) || null;
    state.template = (cc && cc.template) || 'sprout';
    state.color = (cc && cc.color) || '';
    state.logoUrl = (cc && cc.logoUrl) || '';
    state.onSaveConfig = (payload && payload.onSaveConfig) || null;
    state.onUploadLogo = (payload && payload.onUploadLogo) || null;
    state.win = null;
    state.lastOpts = null;
    ensureDialog();

    let accepted = 0, waitlist = 0;
    state.groups.forEach(g => {
      const s = splitCandidates(g.candidates);
      accepted += s.accepted.length;
      waitlist += s.waitlist.length;
    });
    const firstProg = (state.groups[0] && state.groups[0].program) || {};
    const progLabel = state.groups.length > 1
      ? `${state.groups.length}개 프로그램`
      : (firstProg.title || '');
    dlg.querySelector('#cert-summary').textContent =
      `${progLabel} · 접수/선정 ${accepted}명${waitlist ? ` · 대기 ${waitlist}명` : ''} (취소자 제외)`;

    // 대기자
    const wl = dlg.querySelector('#cert-waitlist');
    wl.checked = false;
    wl.disabled = waitlist === 0;
    dlg.querySelector('#cert-wl-count').textContent = waitlist ? `(${waitlist}명)` : '(없음)';

    // 종류·디자인 초기화
    dlg.querySelector('input[name="cert-type"][value="confirm"]').checked = true;
    const tplR = dlg.querySelector(`input[name="cert-template"][value="${state.template}"]`);
    if (tplR) tplR.checked = true; else dlg.querySelector('input[name="cert-template"][value="sprout"]').checked = true;
    delete dlg.dataset.colorTouched;
    if (state.color) {
      const cr = dlg.querySelector(`input[name="cert-color"][value="${state.color}"]`);
      if (cr) { cr.checked = true; dlg.dataset.colorTouched = '1'; }
    }

    // 출력 크기·슬라이더
    dlg.querySelector('input[name="cert-perpage"][value="2"]').checked = true;
    const scale = dlg.querySelector('#cert-scale');
    scale.value = 100;
    dlg.querySelector('#cert-scale-val').textContent = '100%';

    // 내용
    const bodyEl = dlg.querySelector('#cert-body');
    delete bodyEl.dataset.touched;
    bodyEl.value = TYPES.confirm.body;
    dlg.querySelector('#cert-date').value = todayKo();
    const issuerEl = dlg.querySelector('#cert-issuer');
    issuerEl.value = '';
    issuerEl.placeholder = issuerFor(firstProg, '');

    // 옵션 초기화
    const resetChk = (id, on) => { const c = dlg.querySelector(id); c.checked = !!on; };
    resetChk('#cert-note-on', false); dlg.querySelector('#cert-note').value = ''; dlg.querySelector('#cert-note').hidden = true;
    resetChk('#cert-info-on', false); dlg.querySelector('#cert-info-fields').hidden = true;
    // 장소·날짜·시간 자동채움(첫 프로그램 기준)
    const sch = scheduleTexts(firstProg);
    dlg.querySelector('#cert-info-loc').value = firstProg.location || '';
    dlg.querySelector('#cert-info-date').value = sch.main || '';
    dlg.querySelector('#cert-info-time').value = timeText(firstProg) || '';
    resetChk('#cert-caution-on', false); dlg.querySelector('#cert-caution').value = ''; dlg.querySelector('#cert-caution').hidden = true;
    resetChk('#cert-board-on', true); dlg.querySelector('#cert-board-extra').style.display = '';
    resetChk('#cert-title-reward', false);
    dlg.querySelector('#cert-reward').value = '';
    dlg.querySelector('#cert-reward').hidden = true;

    // 로고 미리보기
    renderLogo();
    if (dlg._bindLogoClear) dlg._bindLogoClear();
    dlg.querySelector('#cert-logo-status').textContent = '';
    if (!state.onUploadLogo) {
      dlg.querySelector('#cert-logo-status').textContent = '※ 이 화면은 로고 서버 저장 미지원(미리보기만)';
    }

    // 공통 이미지 섹션
    dlg.querySelector('#cert-img-show').checked = state.imgEnabled;
    const imgSave = dlg.querySelector('#cert-img-save');
    imgSave.disabled = !state.onSaveImages;
    imgSave.title = state.onSaveImages ? '' : '이 화면에서는 저장을 지원하지 않습니다.';
    dlg.querySelector('#cert-img-status').textContent = '';
    renderImgList();

    // 종류 기본값 적용(확인증 전용 옵션 노출 등)
    syncTypeDefaults();

    dlg.classList.add('open');
  }

  global.SaessakCertificate = { openDialog };

  // Node 환경(브라우저 아님)에서만: 렌더링 함수 단위 검증용 훅. 브라우저에는 영향 없음.
  if (typeof window === 'undefined') {
    global.__certTest = { buildCards, buildDoc, paginate, certCard, printCss, perPageCount, issuerFor, scheduleTexts, _state: state };
  }
})(typeof window !== 'undefined' ? window : globalThis);
