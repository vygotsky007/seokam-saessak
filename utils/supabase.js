if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 서비스 롤 키 — Supabase/Railway 표준 이름(SUPABASE_SERVICE_ROLE_KEY) 우선.
// 과거 코드 호환을 위해 SUPABASE_SERVICE_KEY 도 허용한다.
const SERVICE_KEY_VAR = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? 'SUPABASE_SERVICE_ROLE_KEY'
  : (process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : null);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

// 진짜 서비스 롤 키인지 판별(anon/publishable 키로는 Storage 쓰기가 RLS 로 막힌다).
function looksLikeServiceKey(key) {
  if (!key) return false;
  if (key === process.env.SUPABASE_KEY) return false;   // 공개 키와 동일 = 잘못 설정
  if (key.startsWith('sb_secret_')) return true;         // 신형 secret 키
  if (key.startsWith('sb_publishable_')) return false;   // 신형 publishable 키
  try {                                                  // 구형 JWT: role 클레임 확인
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    return payload.role === 'service_role';
  } catch { return false; }
}

const HAS_SERVICE_KEY = looksLikeServiceKey(SERVICE_KEY);

// 업로드 등 서버 전용 쓰기 클라이언트. 서비스 키가 유효하면 그것으로, 아니면 기본 키로 폴백.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  HAS_SERVICE_KEY ? SERVICE_KEY : process.env.SUPABASE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const REVIEW_PHOTO_BUCKET = 'review-photos';
// 증서(확인증·이수증) 로고/마스코트 등 학교 단위 자산. public read.
const CERT_ASSETS_BUCKET = 'cert-assets';
// 프로그램 교구·작품 예시 사진(카드 대표 사진 + 자세히 갤러리). public read.
const PROGRAM_PHOTO_BUCKET = 'program-photos';

// 지정 버킷이 없으면 서비스 키로 생성(public read). 있으면 통과. (review-photos / cert-assets 공용)
async function ensureBucket(bucketName, label) {
  if (!HAS_SERVICE_KEY) {
    console.warn(`⚠️  [storage] 서비스 롤 키가 없어 ${label} 업로드가 동작하지 않습니다.`);
    console.warn('    → Railway Variables 에 SUPABASE_SERVICE_ROLE_KEY (Supabase service_role 키)를 설정하세요.');
    return;
  }
  try {
    const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
    if (listErr) {
      console.error(`⚠️  [storage] 버킷 목록 조회 실패: ${listErr.message}`);
      return;
    }
    if ((buckets || []).some(b => b.name === bucketName)) {
      console.log(`✅ [storage] '${bucketName}' 버킷 확인됨`);
      return;
    }
    const { error: createErr } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: true,
    });
    if (createErr) {
      console.error(`⚠️  [storage] '${bucketName}' 버킷 생성 실패: ${createErr.message}`);
      return;
    }
    console.log(`✅ [storage] '${bucketName}' 버킷 생성됨 (public read)`);
  } catch (e) {
    console.error(`⚠️  [storage] 버킷 준비 중 오류: ${e.message}`);
  }
}

async function ensureReviewBucket() { return ensureBucket(REVIEW_PHOTO_BUCKET, '후기 사진'); }
async function ensureCertAssetsBucket() { return ensureBucket(CERT_ASSETS_BUCKET, '증서 로고/이미지'); }
async function ensureProgramPhotoBucket() { return ensureBucket(PROGRAM_PHOTO_BUCKET, '프로그램 사진'); }

const crypto = require('crypto');
// 증서 로고/마스코트 업로드: 클라이언트가 보낸 dataURL(리사이즈·압축 완료)을 서비스 키로 cert-assets 버킷에 올린다.
// 성공 시 public URL 반환. 형식 오류/용량 초과/서비스키 없음은 throw.
async function uploadCertAsset(dataUrl) {
  if (!HAS_SERVICE_KEY) throw new Error('서버에 서비스 롤 키가 없어 업로드할 수 없습니다.');
  const m = /^data:(image\/(png|jpe?g|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) throw new Error('이미지 형식이 올바르지 않습니다.');
  const contentType = m[1];
  const ext = contentType === 'image/png' ? 'png'
    : contentType === 'image/webp' ? 'webp'
    : contentType === 'image/svg+xml' ? 'svg' : 'jpg';
  const buffer = Buffer.from(m[3], 'base64');
  if (buffer.length > 3 * 1024 * 1024) throw new Error('이미지 용량이 너무 큽니다.');
  const filename = `logo/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(CERT_ASSETS_BUCKET)
    .upload(filename, buffer, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(CERT_ASSETS_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// 프로그램 사진 업로드: 클라이언트가 보낸 dataURL(긴 변 1200px 리사이즈·JPEG 0.85 압축 완료)을
// 서비스 키로 program-photos 버킷에 올린다. 성공 시 public URL, 실패 시 throw.
async function uploadProgramPhoto(dataUrl) {
  if (!HAS_SERVICE_KEY) throw new Error('서버에 서비스 롤 키가 없어 업로드할 수 없습니다.');
  const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) throw new Error('사진 형식이 올바르지 않습니다.');
  const contentType = m[1];
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const buffer = Buffer.from(m[3], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('사진 용량이 너무 큽니다.');
  const filename = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(PROGRAM_PHOTO_BUCKET)
    .upload(filename, buffer, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(PROGRAM_PHOTO_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// public URL → 버킷 내 오브젝트 경로. 우리 버킷 URL 이 아니면 null(외부/무효 URL 은 삭제 대상 아님).
function programPhotoPath(url) {
  const s = String(url || '');
  const marker = `/storage/v1/object/public/${PROGRAM_PHOTO_BUCKET}/`;
  const i = s.indexOf(marker);
  if (i === -1) return null;
  const path = s.slice(i + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

// 프로그램 사진 URL 배열을 Storage 에서 정리(삭제). 서비스 키 없거나 대상 없으면 조용히 통과.
async function deleteProgramPhotos(urls) {
  if (!HAS_SERVICE_KEY) return;
  const paths = (Array.isArray(urls) ? urls : []).map(programPhotoPath).filter(Boolean);
  if (paths.length === 0) return;
  try {
    await supabaseAdmin.storage.from(PROGRAM_PHOTO_BUCKET).remove(paths);
  } catch (e) {
    console.error('[storage] 프로그램 사진 삭제 실패:', e.message);
  }
}

supabase.admin = supabaseAdmin;
supabase.hasServiceKey = HAS_SERVICE_KEY;
supabase.serviceKeyVar = SERVICE_KEY_VAR;
supabase.ensureReviewBucket = ensureReviewBucket;
supabase.ensureCertAssetsBucket = ensureCertAssetsBucket;
supabase.ensureProgramPhotoBucket = ensureProgramPhotoBucket;
supabase.uploadCertAsset = uploadCertAsset;
supabase.uploadProgramPhoto = uploadProgramPhoto;
supabase.deleteProgramPhotos = deleteProgramPhotos;
supabase.programPhotoPath = programPhotoPath;
supabase.REVIEW_PHOTO_BUCKET = REVIEW_PHOTO_BUCKET;
supabase.CERT_ASSETS_BUCKET = CERT_ASSETS_BUCKET;
supabase.PROGRAM_PHOTO_BUCKET = PROGRAM_PHOTO_BUCKET;

module.exports = supabase;
