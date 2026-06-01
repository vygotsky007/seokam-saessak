function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  // API 요청은 401 JSON으로 응답해야 한다(리다이렉트하면 fetch가 PUT/DELETE 메서드를
  // 그대로 유지한 채 302를 따라가 /login 으로 가서 404가 난다).
  // requireAdmin 은 ADMIN_PATH + '/api' 에 마운트되므로 req.path 는 '/api' 가 잘린다.
  // 잘리지 않는 req.originalUrl 로 API 여부를 판별한다.
  if (req.originalUrl && req.originalUrl.includes('/api/')) {
    return res.status(401).json({ ok: false, error: '관리자 인증이 필요합니다.' });
  }
  const adminPath = process.env.ADMIN_PATH || '/manage';
  return res.redirect(adminPath + '/login');
}

module.exports = { requireAdmin };
