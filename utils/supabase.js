if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 스토리지 업로드 등 서버 전용 쓰기는 서비스 키 클라이언트로 수행한다.
// SUPABASE_SERVICE_KEY 가 없으면 기본 키로 폴백(로컬/구버전 호환). 서비스 키가 아니면
// Storage 쓰기는 RLS 로 막히므로, 운영에서는 SUPABASE_SERVICE_KEY 를 반드시 설정한다.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabaseAdmin = createClient(process.env.SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

supabase.admin = supabaseAdmin;
supabase.hasServiceKey = !!process.env.SUPABASE_SERVICE_KEY;

module.exports = supabase;
