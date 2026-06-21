-- 2026-06-21: 후기 작성자 마스킹 이름 + 사진 업로드
--
-- (1) reviewer_masked: 작성자 이름의 가운데 글자를 가린 값만 저장(원본 실명은 저장하지 않음).
--     마스킹은 반드시 서버(routes/public.js → utils/mask-name.js)에서 수행한다.
--     예: 홍길동→홍O동, 홍길→홍O, 남궁민수→남OO수
-- (2) photo_url / photo_type: 선택 사진. 서버가 Supabase Storage 'review-photos' 버킷에
--     서비스 키로 업로드(파일명 uuid)한 공개 URL과 종류(work=작품 / with_person=작품+본인)를 저장.
--
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — program_reviews 는 이미 비활성화 상태.

alter table program_reviews add column if not exists reviewer_masked text;
alter table program_reviews add column if not exists photo_url text;
alter table program_reviews add column if not exists photo_type text;

-- photo_type 은 work / with_person 만 허용(빈 사진이면 null)
alter table program_reviews
  drop constraint if exists program_reviews_photo_type_chk;
alter table program_reviews
  add constraint program_reviews_photo_type_chk
  check (photo_type is null or photo_type in ('work', 'with_person'));

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
