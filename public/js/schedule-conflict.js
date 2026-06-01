// 두 프로그램의 일정·시간이 겹치는지 판정 (브라우저/Node 공용)
//
// 겹침 정의:
//   1) 두 프로그램의 session_dates 에 같은 날짜가 하나라도 있고,
//   2) 그날의 start_time~end_time 이 시간상으로 겹친다 (A.start < B.end && B.start < A.end).
// 둘 중 하나라도 구조화된 일정(session_dates + start_time + end_time)이 없으면 false (충돌 판정 제외).
(function (global) {
  function parseTimeMinutes(s) {
    if (s === null || s === undefined) return null;
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(s).trim());
    if (!m) return null;
    var h = Number(m[1]);
    var mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    return h * 60 + mm;
  }

  function hasStructuredSchedule(p) {
    if (!p) return false;
    return Array.isArray(p.session_dates)
      && p.session_dates.length > 0
      && !!p.start_time
      && !!p.end_time;
  }

  function timesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  // 프로그램의 모든 "회차"를 {date, s(분), e(분)} 목록으로 펼친다.
  // 메인 일정(session_dates × 공통 start/end) + 보충 회차(extra_sessions, 각자 시간) 모두 포함.
  function occurrencesOf(p) {
    var occ = [];
    if (!p) return occ;
    // 메인 일정
    if (Array.isArray(p.session_dates) && p.session_dates.length > 0 && p.start_time && p.end_time) {
      var s = parseTimeMinutes(p.start_time);
      var e = parseTimeMinutes(p.end_time);
      if (s != null && e != null && s < e) {
        for (var i = 0; i < p.session_dates.length; i++) {
          occ.push({ date: String(p.session_dates[i]).trim(), s: s, e: e });
        }
      }
    }
    // 보충 회차
    if (Array.isArray(p.extra_sessions)) {
      for (var j = 0; j < p.extra_sessions.length; j++) {
        var x = p.extra_sessions[j] || {};
        if (!x.date) continue;
        var xs = parseTimeMinutes(x.start);
        var xe = parseTimeMinutes(x.end);
        if (xs == null || xe == null || xs >= xe) continue;
        occ.push({ date: String(x.date).trim(), s: xs, e: xe });
      }
    }
    return occ;
  }

  // 두 프로그램이 시간 충돌이면 true, 아니면 false (메인·보충 회차 모두 고려)
  function programsConflict(a, b) {
    var oa = occurrencesOf(a);
    var ob = occurrencesOf(b);
    if (oa.length === 0 || ob.length === 0) return false;
    for (var i = 0; i < oa.length; i++) {
      for (var j = 0; j < ob.length; j++) {
        if (oa[i].date === ob[j].date && timesOverlap(oa[i].s, oa[i].e, ob[j].s, ob[j].e)) {
          return true;
        }
      }
    }
    return false;
  }

  var api = {
    programsConflict: programsConflict,
    parseTimeMinutes: parseTimeMinutes,
    hasStructuredSchedule: hasStructuredSchedule,
    occurrencesOf: occurrencesOf,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SaessakConflict = api;
})(typeof window !== 'undefined' ? window : globalThis);
