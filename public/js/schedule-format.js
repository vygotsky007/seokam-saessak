// 디지털새싹 일정 자동 포맷 유틸 (공통)
// program.session_dates(YYYY-MM-DD 배열) + start_time/end_time 을 보기 좋게 합쳐 한 줄로 만든다.
// session_dates 가 비어 있으면 program.schedule 텍스트를 fallback 으로 그대로 돌려준다.
(function (global) {
  var WEEK = ['일','월','화','수','목','금','토'];

  function parseDateLocal(s) {
    // 'YYYY-MM-DD' → 로컬 자정 Date (브라우저 타임존 시프트 회피)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function isContiguous(dates) {
    if (dates.length < 2) return true;
    for (var i = 1; i < dates.length; i++) {
      if (diffDays(dates[i - 1], dates[i]) !== 1) return false;
    }
    return true;
  }

  // 같은 달이면 "6월 22·23·25·26일", 달이 섞이면 "6월 28·30일, 7월 3일" 식으로.
  function joinSameMonth(dates) {
    var parts = [];
    var bucket = null;
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      if (!bucket || bucket.m !== d.getMonth() || bucket.y !== d.getFullYear()) {
        bucket = { y: d.getFullYear(), m: d.getMonth(), days: [] };
        parts.push(bucket);
      }
      bucket.days.push(d.getDate());
    }
    return parts.map(function (b) {
      return (b.m + 1) + '월 ' + b.days.join('·') + '일';
    }).join(', ');
  }

  function formatRange(first, last) {
    var sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
    var sw = WEEK[first.getDay()];
    var ew = WEEK[last.getDay()];
    if (first.getTime() === last.getTime()) {
      return (first.getMonth() + 1) + '월 ' + first.getDate() + '일(' + sw + ')';
    }
    if (sameMonth) {
      return (first.getMonth() + 1) + '월 ' + first.getDate() + '일(' + sw + ')~' +
             last.getDate() + '일(' + ew + ')';
    }
    return (first.getMonth() + 1) + '월 ' + first.getDate() + '일(' + sw + ')~' +
           (last.getMonth() + 1) + '월 ' + last.getDate() + '일(' + ew + ')';
  }

  // program-like: { session_dates, start_time, end_time, schedule }
  function format(program) {
    var p = program || {};
    var rawDates = Array.isArray(p.session_dates) ? p.session_dates : [];
    var parsed = rawDates.map(parseDateLocal).filter(Boolean);
    parsed.sort(function (a, b) { return a.getTime() - b.getTime(); });
    // 중복 제거
    var uniq = [];
    var seen = {};
    for (var i = 0; i < parsed.length; i++) {
      var k = parsed[i].toDateString();
      if (seen[k]) continue;
      seen[k] = true;
      uniq.push(parsed[i]);
    }

    if (uniq.length === 0) {
      return p.schedule ? String(p.schedule) : '';
    }

    var dateText;
    if (isContiguous(uniq) && uniq.length >= 2) {
      dateText = formatRange(uniq[0], uniq[uniq.length - 1]);
    } else if (uniq.length === 1) {
      dateText = formatRange(uniq[0], uniq[0]);
    } else {
      // 불연속: 가운뎃점 묶음 + (시작 요일~종료 요일) 꼬리
      var head = joinSameMonth(uniq);
      var sw = WEEK[uniq[0].getDay()];
      var ew = WEEK[uniq[uniq.length - 1].getDay()];
      dateText = head + ' (' + sw + '~' + ew + ')';
    }

    var t = '';
    if (p.start_time && p.end_time) t = ' ' + p.start_time + '~' + p.end_time;
    else if (p.start_time) t = ' ' + p.start_time;
    else if (p.end_time) t = ' ~' + p.end_time;

    return dateText + t;
  }

  global.SaessakSchedule = { format: format };
})(typeof window !== 'undefined' ? window : globalThis);
