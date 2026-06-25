if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const path = require('path');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'ADMIN_PATH',
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('[FATAL] 누락된 환경변수:', missing.join(', '));
  process.exit(1);
}

const ADMIN_PATH = process.env.ADMIN_PATH.startsWith('/')
  ? process.env.ADMIN_PATH
  : '/' + process.env.ADMIN_PATH;

const app = express();
const PORT = process.env.PORT || 4002;

app.set('trust proxy', 1);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
app.locals.supabase = supabase;

// 후기 사진 업로드용 서비스 키 클라이언트 + 버킷 보장 함수(utils/supabase.js)
const db = require('./utils/supabase');

process.on('uncaughtException',  err    => console.error('[uncaughtException]',  err));
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));

// 확인증 공통 이미지(QR·로고 등)를 base64로 app_settings에 저장하므로 기본 100kb 한도를 넉넉히 올린다.
// 후기 사진은 base64(dataURL)로 들어오므로 기본 100kb 한도를 넉넉히 올린다(클라가 1.2MB 이하로 압축).
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(session({
  name: 'saessak.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 6,
  },
}));

app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  extensions: ['html'],
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.' },
});

const { requireAdmin } = require('./utils/auth');
const { normalizeMobile } = require('./utils/phone');

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/me', (req, res) => res.sendFile(path.join(__dirname, 'public', 'me.html')));
app.get('/outputs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'outputs.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 강사용 토큰 수정 페이지 — 토큰별 프로그램 1개만 수정(관리자 인증 없이 토큰+권한으로 게이트).
app.get('/edit/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit.html')));
app.get('/create/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'create.html')));
// 이수 학생용 후기 작성 페이지 — 토큰으로 게이트(서버 검증).
app.get('/review/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));

// 전체 후기 모음(공개·읽기 전용) — 숨김 아닌 후기 전부, 최신순. 메인 "프로그램 후기 모음" 모달용.
app.get('/api/reviews', async (req, res) => {
  try {
    const { data: reviews, error } = await supabase
      .from('program_reviews')
      .select('id, program_id, rating, content, grade_label, reviewer_masked, photo_url, photo_type, created_at')
      .neq('status', '숨김')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = reviews || [];
    const ids = [...new Set(list.map(r => String(r.program_id)))];
    const titleMap = {};
    if (ids.length) {
      const { data: progs } = await supabase
        .from('saessak_programs')
        .select('id, title')
        .in('id', ids);
      (progs || []).forEach(p => { titleMap[String(p.id)] = p.title; });
    }
    const data = list.map(r => ({ ...r, program_title: titleMap[String(r.program_id)] || '프로그램' }));
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[GET /api/reviews]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 교직원(관리자) 전용: 과거 신청 기록 전체(프로그램 불문)에서 학생을 느슨하게 검색.
// "신청자 추가" 모달의 자동완성 보조 기능. 라우터(requireAdmin)는 401을 주지만,
// 요구사항에 따라 본 엔드포인트는 비관리자에게 403을 직접 반환한다.
app.get('/api/applicants/search', async (req, res) => {
  if (!(req.session && req.session.isAdmin === true)) {
    return res.status(403).json({ ok: false, error: '관리자 전용 기능입니다.' });
  }
  try {
    const q = String(req.query.q || '').trim();
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
    if (!tokens.length) return res.json({ ok: true, data: [] });

    const onlyDigits = s => String(s == null ? '' : s).replace(/\D/g, '');
    const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
    function maskPhone(raw) {
      const n = normalizeMobile(raw);
      const m = n && n.match(/^(\d{3})-(\d{4})-(\d{4})$/);
      if (m) return `${m[1]}-${m[2]}-${m[3].slice(0, 2)}··`; // 예: 010-7559-16··
      const d = onlyDigits(raw);
      if (!d) return '';
      if (d.length <= 2) return '·'.repeat(d.length);
      return d.slice(0, -2) + '··';
    }

    // 과거 신청자 전체, 최신 우선(대표 레코드 선정용).
    const { data: rows, error } = await supabase
      .from('saessak_applications')
      .select('student_name, grade, class_no, guardian_name, guardian_phone, student_phone, submitted_at')
      .order('submitted_at', { ascending: false })
      .limit(8000);
    if (error) throw error;

    // 같은 학생(이름+보호자전화, 없으면 이름+보호자명/학생전화)으로 묶어 최신 기록을 대표로.
    const reps = new Map();
    for (const r of (rows || [])) {
      const nm = norm(r.student_name);
      if (!nm) continue;
      const gp = onlyDigits(r.guardian_phone);
      const key = nm + '|' + (gp || norm(r.guardian_name) || onlyDigits(r.student_phone) || '');
      if (!reps.has(key)) reps.set(key, r); // 정렬상 처음 = 최신 = 대표
    }

    // 토큰별로 어떤 필드가 맞았는지(이름/보호자/학년/반/전화). 하나라도 맞으면 후보.
    function evalRow(r) {
      const f = {
        name: norm(r.student_name),
        guardian: norm(r.guardian_name),
        grade: r.grade == null ? '' : String(r.grade),
        cls: r.class_no == null ? '' : String(r.class_no),
        phoneG: onlyDigits(r.guardian_phone),
        phoneS: onlyDigits(r.student_phone),
      };
      const matched = new Set();
      for (const tk of tokens) {
        const t = norm(tk);
        const td = onlyDigits(tk);
        if (t && f.name && f.name.includes(t)) matched.add('name');
        if (t && f.guardian && f.guardian.includes(t)) matched.add('guardian');
        const tg = t.replace('학년', '');
        if (tg && f.grade && tg === f.grade) matched.add('grade');
        const tc = t.replace('반', '');
        if (tc && f.cls && tc === f.cls) matched.add('class');
        if (td.length >= 2 && ((f.phoneG && f.phoneG.includes(td)) || (f.phoneS && f.phoneS.includes(td)))) {
          matched.add('phone'); // 전화는 숫자만, 뒷자리 부분일치 포함
        }
      }
      return matched;
    }

    const out = [];
    for (const r of reps.values()) {
      const matched = evalRow(r);
      if (matched.size < 1) continue;
      out.push({
        student_name: r.student_name || '',
        grade: r.grade == null ? null : r.grade,
        class_no: r.class_no == null ? null : r.class_no,
        guardian_name: r.guardian_name || '',
        phone_masked: maskPhone(r.guardian_phone),       // 목록 노출용
        phone_raw: normalizeMobile(r.guardian_phone) || (r.guardian_phone || ''), // 선택 시 자동입력용
        matched: [...matched],
        score: matched.size,                             // 최대 5 (이름/전화/학년/반/보호자)
        last_applied_at: r.submitted_at || null,
      });
    }
    // score 높은 순, 동점이면 최근 신청 순.
    out.sort((a, b) => b.score - a.score ||
      String(b.last_applied_at || '').localeCompare(String(a.last_applied_at || '')));
    res.json({ ok: true, data: out.slice(0, 15) });
  } catch (err) {
    console.error('[GET /api/applicants/search]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api/public', require('./routes/public'));
app.use('/api/public', require('./routes/me'));
app.use('/api/edit', require('./routes/edit'));
app.use('/api/create', require('./routes/create'));

app.get(ADMIN_PATH + '/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect(ADMIN_PATH);
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post(ADMIN_PATH + '/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ ok: false, error: '비밀번호를 입력하세요.' });
    }
    const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!ok) {
      return res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
    }
    req.session.isAdmin = true;
    req.session.loggedAt = new Date().toISOString();
    return res.json({ ok: true, redirect: ADMIN_PATH });
  } catch (err) {
    console.error('[POST admin/login]', err);
    res.status(500).json({ ok: false, error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.post(ADMIN_PATH + '/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('saessak.sid');
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

app.get(ADMIN_PATH, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(ADMIN_PATH + '/api', requireAdmin, require('./routes/admin'));

app.use((req, res) => {
  res.status(404).json({ error: `${req.method} ${req.url} 는 존재하지 않는 엔드포인트입니다.` });
});
app.use((err, req, res, _next) => {
  console.error('[Express 에러]', req.method, req.url, err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`🌱 석암 디지털새싹 관리 서버 실행 중: http://localhost:${PORT}`);
  console.log('  관리자 경로:', ADMIN_PATH);
  console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ 설정됨' : '❌ 없음');
  console.log('  SUPABASE_KEY:', process.env.SUPABASE_KEY ? '✅ 설정됨' : '❌ 없음');
  console.log('  서비스 롤 키:', db.hasServiceKey ? `✅ ${db.serviceKeyVar}` : '❌ 없음 (후기 사진 업로드 불가)');
  // 'review-photos' / 'cert-assets' 버킷 보장(없으면 생성). 결과는 위 함수가 직접 로그로 남긴다.
  db.ensureReviewBucket();
  db.ensureCertAssetsBucket();
});
