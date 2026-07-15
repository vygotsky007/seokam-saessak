-- 2026-07-15: 프로그램 교구·작품 예시 사진
--
-- saessak_programs.photos : 사진 공개 URL 문자열 배열(jsonb). 최대 5장.
--   배열의 첫 번째가 카드 상단에 노출되는 "대표 사진". 순서는 관리자가 폼에서 드래그로 조정.
--   사진 파일은 Supabase Storage 'program-photos' 버킷에 서비스 키로 업로드(파일명 uuid),
--   그 public URL 을 이 배열에 저장한다. (버킷/정책 SQL 은 별도 파일 참조)
--
-- RLS 는 서버 권한 체크로 대체(프로젝트 표준) — saessak_programs 는 이미 비활성화 상태.

alter table saessak_programs
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
