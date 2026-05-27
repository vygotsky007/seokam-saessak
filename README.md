# 석암초등학교 디지털새싹 모집/운영 관리 앱

석암초등학교 디지털새싹 교실 프로그램의 **온라인 신청 접수**와 **선정·운영 관리**를 한 곳에서 처리하는 앱이다.

## 주요 기능

- 🌱 공개 신청 페이지 (학교종이 방식, 로그인 없음)
  - 여러 프로그램 장바구니식 다중 선택
  - 학년 자동 검증, 정원 실시간 차감
  - 같은 학생의 동일 프로그램 중복 신청 차단
  - 프로그램별 독립 선착순 + 동시 마감 시 부분 접수 처리
- 🛠 관리자 콘솔
  - 프로그램 등록/수정/삭제 + 모집 열기·닫기 토글
  - 프로그램별 신청자 명단(상태 변경, 수동 정렬, 직접 추가)
  - 학생 → 다른 프로그램으로 1클릭 복사
  - 종합 대시보드(프로그램 현황, 학년 분포, 중복 신청자)
  - 선정자 명단 엑셀(.xlsx) 내보내기
- 🔒 보안
  - ADMIN_PATH 환경변수로 관리자 경로 난독화
  - bcrypt + express-session 비밀번호 게이트
  - 로그인 실패 rate-limit (5회 / 15분)

## 기술 스택

- Node.js + Express
- Supabase (PostgreSQL)
- Vanilla JS (no framework)
- ExcelJS (엑셀 내보내기), bcryptjs, express-session, express-rate-limit

## 디렉토리

```
seokam-saessak/
├─ server.js                # 진입점 (라우팅, 세션, 인증)
├─ routes/
│  ├─ public.js             # GET /api/public/programs, POST /api/public/apply
│  └─ admin.js              # 관리자 API 전체 (ADMIN_PATH 하위)
├─ utils/
│  ├─ supabase.js
│  └─ auth.js               # requireAdmin 미들웨어
├─ public/
│  ├─ index.html            # 공개 신청 화면
│  ├─ login.html            # 관리자 로그인
│  ├─ admin.html            # 관리자 콘솔 (탭 4개)
│  ├─ css/                  # common · public · admin
│  └─ js/                   # public.js · admin.js
├─ migrations/
│  └─ 2026-05-27_init.sql   # 테이블 2개 생성 SQL
├─ scripts/
│  ├─ seed.js               # 샘플 프로그램 3개 (is_open=false)
│  ├─ hash-password.js      # bcrypt 해시 1줄 생성기
│  └─ gen-admin-path.js     # /manage-<32자 랜덤> 생성기
└─ .env
```

---

## 1. DB 스키마 (Supabase SQL Editor 에서 실행)

> 파일: `migrations/2026-05-27_init.sql`

```sql
create extension if not exists "pgcrypto";

-- 프로그램 마스터
create table if not exists saessak_programs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  schedule    text,
  location    text,
  grade_min   int  not null default 1,
  grade_max   int  not null default 6,
  capacity    int  not null default 20,
  instructors text,
  is_open     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 신청 내역
create table if not exists saessak_applications (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references saessak_programs(id) on delete cascade,
  student_name    text not null,
  grade           int,
  class_no        int,
  guardian_name   text,
  guardian_phone  text,
  student_phone   text,
  motivation      text,
  privacy_agreed  boolean not null default false,
  status          text not null default 'applied'
                  check (status in ('applied', 'selected', 'waiting', 'cancelled')),
  source          text not null default 'online'
                  check (source in ('online', 'manual')),
  submitted_at    timestamptz not null default now(),
  display_order   int,
  created_at      timestamptz not null default now()
);

create index if not exists idx_saessak_apps_program  on saessak_applications(program_id);
create index if not exists idx_saessak_apps_submitted on saessak_applications(submitted_at);
create index if not exists idx_saessak_apps_status   on saessak_applications(status);

-- 동일 프로그램 + (학생이름 + 보호자연락처) 중복 방지
create unique index if not exists uq_saessak_apps_dedup
  on saessak_applications(program_id, student_name, guardian_phone)
  where status <> 'cancelled';
```

---

## 2. 환경변수 (`.env`)

| 변수 | 설명 | 예시 |
|---|---|---|
| `PORT` | 서버 포트 | `4002` |
| `SUPABASE_URL` | Supabase 프로젝트 URL | `https://fyxskyrzkjbfzlhfukbg.supabase.co` |
| `SUPABASE_KEY` | publishable anon key | `sb_publishable_…` |
| `ADMIN_PATH` | **관리자 진입 경로** (긴 무작위 문자열) | `/manage-A8x7f…` |
| `ADMIN_PASSWORD_HASH` | bcrypt로 해시된 관리자 비번 | `$2a$10$…` |
| `SESSION_SECRET` | 세션 서명용 무작위 시크릿 | 64자 이상 권장 |

> `NODE_ENV=production`이면 `dotenv`를 스킵하고 호스트(Railway)의 환경변수를 그대로 사용한다.

### 🔐 ADMIN_PATH 생성

```bash
npm run gen-admin-path
# 출력 예) /manage-A8x7fK2pQzN3vRmTbYjUwHcXsEgL9D1o
```

### 🔐 비밀번호 해시 만들기

```bash
npm run hash -- "내가쓸비밀번호"
# 출력된 $2a$10$... 문자열을 ADMIN_PASSWORD_HASH 에 그대로 붙여넣기
```

> bcrypt 해시는 한 번 만들고 `.env` / Railway 환경변수에만 보관한다. 비번 자체는 어디에도 저장하지 않는다.

### SESSION_SECRET 빨리 만드는 법

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 3. 로컬 실행

```bash
cd seokam-saessak
npm install
# Supabase SQL Editor에서 migrations/2026-05-27_init.sql 한 번 실행
npm run seed       # (선택) 샘플 프로그램 3개 삽입
npm start
```

- 공개 페이지: <http://localhost:4002/>
- 관리자 로그인: <http://localhost:4002{ADMIN_PATH}/login>

> `/admin` 같은 뻔한 경로는 의도적으로 막혀 있다. `ADMIN_PATH` 환경변수에 설정한 경로로만 진입 가능하다.

---

## 4. Railway 배포

1. 이 레포를 Railway에 New Project로 연결한다.
2. **Variables** 탭에서 다음 환경변수를 등록한다:
   - `NODE_ENV=production`
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `ADMIN_PATH` (gen-admin-path로 생성한 값)
   - `ADMIN_PASSWORD_HASH` (hash 스크립트로 생성한 값)
   - `SESSION_SECRET` (긴 무작위 문자열)
   - `PORT` 는 Railway가 자동 주입하므로 생략 가능.
3. **Domains** 탭에서 도메인을 생성한다.
4. 관리자 진입 URL: `https://<도메인>{ADMIN_PATH}/login`

---

## 5. 포트 정책 (석암 봇 패밀리)

| 포트 | 앱 |
|---|---|
| 4000 | sunwater (선수교실) |
| 4001 | bogyeol (보결 매니저) |
| **4002** | **saessak (디지털새싹 — 본 앱)** |

---

## 6. 운영 메모

- 공개 페이지는 로그인 없이 누구나 접속 가능 → 학생/학부모 안내용.
- 같은 학생이 다른 프로그램에 여러 개 신청하는 건 자유, 단 **같은 프로그램에 두 번 신청은 차단**(DB unique index + 라우트 검증).
- 모집 마감: `is_open=false` 또는 정원 도달 시 자동. 관리자 화면 토글로 강제 마감/재개 가능.
- 선정 결과 발표: 관리자가 `status='selected'`로 변경 → 엑셀로 보호자 연락처 포함 명단 다운로드.

---

## 7. 마이그레이션

`migrations/` 폴더의 SQL 파일은 **Supabase 대시보드 → SQL Editor**에서 직접 실행한다. 모두 `IF NOT EXISTS`로 작성되어 여러 번 실행해도 안전하다.

| 파일 | 변경 내용 |
|---|---|
| `2026-05-27_init.sql` | `saessak_programs`, `saessak_applications` 두 테이블 생성 |
