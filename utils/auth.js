function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: '관리자 인증이 필요합니다.' });
  }
  const adminPath = process.env.ADMIN_PATH || '/manage';
  return res.redirect(adminPath + '/login');
}

module.exports = { requireAdmin };
