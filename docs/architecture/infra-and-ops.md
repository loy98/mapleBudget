# 인프라 · 운영 — 배포·환경·보안헤더·테스트·워크플로우

## 빌드 / 배포 (Cloudflare Pages)
- **자동 배포**: `main` push → Cloudflare Pages 자동 빌드·배포. **`main`엔 검증 끝난 것만.**
- 설정: Framework=**Vite**, Build=`npm run build`, Output=`dist`, Production branch=`main`, **Node 22**(`.node-version`).
- **프로덕션 URL**: https://maplemvpcalculator.com (+`www`), 기존 https://maplebudget-1xp.pages.dev 도 유효.
- PWA(`vite-plugin-pwa`): service worker(`sw.js`/workbox), `manifest.webmanifest`, 오프라인 프리캐시. registerSW 스크립트는 외부 파일(인라인 없음 → CSP `script-src 'self'` 안전).

## 도메인 변경 시 (중요)
도메인을 바꾸면 **로그인 리다이렉트도 반드시 갱신**: Cloudflare Pages Custom domains 연결 + **Supabase → Auth → URL Configuration**의 Site URL·Redirect URLs에 새 도메인(`/**`) 추가. 안 하면 Google/매직링크 로그인이 새 도메인에서 막힘. 앱 코드는 `window.location.origin`이라 코드 변경 불필요.

## 환경 변수 (.env, 저장소 커밋)
- 공개 값만: `VITE_SUPABASE_URL`, publishable/anon key. 브라우저 노출 정상(보안은 RLS). Cloudflare 환경변수 대시보드가 불안정해 빌드타임 공개 설정을 `.env`로 커밋하는 방식.
- **시크릿(service key, SMTP/앱 비밀번호 등)은 절대 커밋 금지.** `.env.local`은 gitignore.

## 보안 헤더 (public/_headers → Cloudflare 자동 적용)
- **CSP**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`.
  - `connect-src`에 `https://*.supabase.co` 필수(인증/데이터). `img-src https:`는 사용자 아이콘 URL 허용. `style-src 'unsafe-inline'`은 React 인라인 스타일 대비. 인라인 `<script>` 없음이라 `script-src 'self'` 안전.
- 추가: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`(geo/mic/cam 차단).
- 프로덕션에서 헤더 적용·앱 로딩 실검증 완료. **CSP 수정 시 반드시 프로덕션에서 위반 없는지 확인**(잘못된 CSP=사이트 다운).

## DB 스키마 (supabase/schema.sql)
- 앱이 의존하는 **모든 테이블**을 단일 마이그레이션에 포함: `user_data`(+RLS `own_data` FOR ALL, updated_at 트리거) + `app_config`(+공개 읽기 RLS, GRANT, 시드). 신규 환경은 이 파일만 Run.
- RLS 실측: `select * from pg_policies where tablename in ('user_data','app_config')`.

## 테스트 / 검증
- **vitest**: `npm test`(`vitest run`). `src/lib/pure.test.js` — 순수 함수(mergeSnapshots·parseCalcState·normalizeLedger 등) 회귀 22건. 리팩터·병합 로직 변경의 안전망.
- **검증 프로토콜(코드 변경 예외 없이 2단계)**:
  1. **Claude 자체** — `npm run build` + 로직/엣지 + 가능하면 dev 프리뷰로 **실제 런타임**(localStorage 조작으로 새 게스트/기존 유저/로그인 경로 재현). DB값 여부 구분은 로컬 constants sentinel로, **원복**. **프로덕션 Supabase에 sentinel/테스트 값 쓰기 금지**(shared state 오염).
  2. **Codex 재검수** — `codex:rescue`/`/codex:review`로 diff 재검수 → PASS까지 반복.

## Git 워크플로우
- **`main` 직접 작업·커밋 금지**(=프로덕션 배포). 흐름: `dev` 유지 → feature 브랜치 → 작업 → `dev` 병합 → 검증 → `dev`를 `main`에(=배포).
- 겹치는 파일 크게 건드리면 병렬 대신 순차로 `dev`에 합침.

## 하지 말 것 (핵심)
- main 직접 커밋 / 검증 안 된 배포 / 시크릿 커밋 / Codex 재검수 생략.
- 렌더 함수 내부 컴포넌트 정의(포커스 유실) — 모듈 스코프.
- 프로덕션 DB에 테스트 값 쓰기. 동기화 불변식 위반([sync-backend.md](sync-backend.md)). DB 값을 검증 없이 렌더.
