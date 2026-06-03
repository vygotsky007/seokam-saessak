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

process.on('uncaughtException',  err    => console.error('[uncaughtException]',  err));
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/me', (req, res) => res.sendFile(path.join(__dirname, 'public', 'me.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 강사용 토큰 수정 페이지 — 토큰별 프로그램 1개만 수정(관리자 인증 없이 토큰+권한으로 게이트).
app.get('/edit/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit.html')));
app.get('/create/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'create.html')));

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
});
