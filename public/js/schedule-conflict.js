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

  // 두 프로그램이 시간 충돌이면 true, 아니면 false
  function programsConflict(a, b) {
    if (!hasStructuredSchedule(a) || !hasStructuredSchedule(b)) return false;
    var aS = parseTimeMinutes(a.start_time);
    var aE = parseTimeMinutes(a.end_time);
    var bS = parseTimeMinutes(b.start_time);
    var bE = parseTimeMinutes(b.end_time);
    if (aS == null || aE == null || bS == null || bE == null) return false;
    if (aS >= aE || bS >= bE) return false; // 비정상 시간 입력은 충돌로 보지 않음
    if (!timesOverlap(aS, aE, bS, bE)) return false;
    var setA = new Set(a.session_dates.map(function (d) { return String(d).trim(); }));
    for (var i = 0; i < b.session_dates.length; i++) {
      if (setA.has(String(b.session_dates[i]).trim())) return true;
    }
    return false;
  }

  var api = {
    programsConflict: programsConflict,
    parseTimeMinutes: parseTimeMinutes,
    hasStructuredSchedule: hasStructuredSchedule,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SaessakConflict = api;
})(typeof window !== 'undefined' ? window : globalThis);
