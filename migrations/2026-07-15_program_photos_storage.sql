-- 2026-07-15: 프로그램 사진 Storage 버킷 'program-photos' 생성 + 공개 읽기 정책
--
-- 업로드/삭제는 서버가 service_role 키로 수행하므로 RLS 를 우회한다(프로젝트 표준).
-- 학부모 공개 페이지에서 <img src> 로 바로 읽어야 하므로 public read 만 정책으로 열어 둔다.
-- (서버 부팅 시 utils/supabase.js 의 ensureProgramPhotoBucket() 가 버킷을 자동 생성하지만,
--  운영 DB 에서 수동으로 확실히 잡아두려면 아래 SQL 을 실행한다.)

-- 1) 버킷 생성(이미 있으면 public=true 로 보정)
insert into storage.buckets (id, name, public)
values ('program-photos', 'program-photos', true)
on conflict (id) do update set public = excluded.public;

-- 2) 공개 읽기 정책(anon + authenticated). 버킷이 public=true 라 URL 접근은 열려 있으나,
--    storage.objects RLS 가 켜진 환경을 대비해 select 정책을 명시한다.
drop policy if exists "program_photos_public_read" on storage.objects;
create policy "program_photos_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'program-photos');
