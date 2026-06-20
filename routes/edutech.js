const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');

// 관리자 게이트 — 세션 기반(server.js 의 requireAdmin 과 동일한 판정). 클라이언트 신뢰 금지.
// 여기서는 쓰기(POST/DELETE)에만 적용하며, 권한 없으면 명세대로 403 으로 막는다.
function requireAdmin403(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  return res.status(403).json({ ok: false, error: '관리자 전용입니다.' });
}

// GET /api/edutech — 공개. visible=true 만, 인증/추천/정렬순. 화면이 바로 쓰는 JSON 배열로 반환.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('edutech_tools')
      .select('*')
      .eq('visible', true)
      .order('is_certified', { ascending: false })
      .order('is_featured', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[GET /api/edutech]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/edutech — 관리자 전용. 도구 1개 추가.
router.post('/', requireAdmin403, async (req, res) => {
  try {
    const b = req.body || {};
    const name = b.name ? String(b.name).trim() : '';
    if (!name) return res.status(400).json({ ok: false, error: '이름을 입력하세요.' });

    const category = b.category ? String(b.category).trim() : '기타';
    const grades = Array.isArray(b.grades)
      ? b.grades.map(Number).filter(g => Number.isInteger(g))
      : [];

    const row = {
      name,
      one_liner: b.one_liner ? String(b.one_liner).trim() : null,
      url: b.url ? String(b.url).trim() : '',
      category,
      // 신·구 화면 호환: subjects 에도 [category] 한 개짜리 배열을 같이 넣는다.
      subjects: [category],
      grades,
      is_featured: !!b.is_featured,
      is_certified: !!b.is_certified,
      teacher: !!b.teacher,
      visible: true,
    };

    const { data, error } = await supabase
      .from('edutech_tools')
      .insert([row])
      .select();
    if (error) throw error;
    res.json({ ok: true, data: (data && data[0]) || null });
  } catch (err) {
    console.error('[POST /api/edutech]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/edutech/:id — 관리자 전용. 도구 1개 삭제.
router.delete('/:id', requireAdmin403, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, error: 'id 가 필요합니다.' });
    const { error } = await supabase.from('edutech_tools').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/edutech/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
