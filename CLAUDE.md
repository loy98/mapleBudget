# 메이플 MVP작 효율 계산기 — 프로젝트 가이드

메이플스토리 MVP 등급작(엠작) 최적 비용 계산기. Vite + React SPA. 한국어 UI.
탭: **계산기 · 거래 기록(통계/달력/입력) · 예상 & 추천**. 코드 구조는 [README.md](README.md) 참고.

---

## 작업 워크플로우 (필수)

- **`main`에서 직접 작업·커밋 금지.** `main` push = Cloudflare 프로덕션 자동 배포이므로 검증 끝난 것만 올린다.
- 흐름: **`dev` 브랜치 유지 → `dev`에서 feature 브랜치 생성 → 작업 → `dev`에 병합 → 최종 검증 → `dev`를 `main`에 병합(=배포)**.
- feature 브랜치가 서로 겹치는 파일을 크게 건드리면 병렬 대신 순차로 `dev`에 합친다.

## 검증 프로토콜 (코드 변경은 예외 없이 2단계)

1. **Claude 자체 검수** — `npm run build` + 로직/엣지케이스 확인. 가능하면 dev 서버 띄워 **실제 동작까지** 확인(빌드는 통과해도 런타임에서 깨질 수 있음).
2. **Codex 재검수** — `codex:rescue`(또는 `/codex:review`)로 diff 재검수 → 지적사항 반영(이견 시 보수적으로 수정).
- `.ts/.tsx/.js/.jsx/.py` 등 코드 변경에 적용. 단순 문서·설정 변경은 예외.

## 아키텍처 방향

- **게스트 모드 유지**: 로그인 없이도 `localStorage`로 그대로 사용 가능. 로그인은 "동기화 켜기"(선택).
- **다인용 클라우드 동기화**: **Supabase**. `user_data` 1행(JSONB: calc/my_items/ledger) + **RLS(본인 행만)**. 인증 = **Google 로그인 + 이메일 매직링크**.
- **데이터 계층 공유**: `storage.js`의 순수 함수(`parseCalcState`/`serializeCalcState`/`normalizeLedger`/`normalizeMyItems`)를 localStorage와 클라우드가 함께 사용. 기존 저장 키를 유지해 구버전 데이터 승계.
- **설정 주입**: 공개 설정(`VITE_SUPABASE_URL`, publishable key)은 저장소 `.env`에 커밋(브라우저 노출이 정상, 보안은 RLS가 담당). **시크릿(service key, SMTP/앱 비밀번호 등)은 절대 커밋 금지.**
- 상세는 프로젝트 메모리 `supabase-multiuser-sync` 참고.

## 배포

- **Cloudflare Pages** — `main` push 시 자동 배포. URL: https://maplebudget-1xp.pages.dev
- Framework=**Vite**, Build=`npm run build`, Output=`dist`, Production branch=`main`, Node=**22**(저장소 `.node-version`).
- 환경변수 대시보드가 불안정하면 위 `.env` 커밋 방식으로 대체(공개 값만).

## 도메인 / 기능 규칙

- **MVP 주 = 목요일 시작 ~ 수요일 마감**(주 과금 단위). 통계 '특정 주차'·주차별 집계·13주 누적 모두 이 기준(`weekStartThu`).
- **현금화**: 메소(억) + **억당(원/억)** 입력 → 판매현금 자동 산정. 구 데이터(`won` 직접 입력)는 `rate`로 승계(`meso=0`이면 손실 방지 위해 `won` 폴백).
- **숫자 입력**: 한 자리 남아도 **완전 삭제 가능** + 비운 채 벗어나면 **0** + 값은 문자열로 저장(계산부는 `+x || 0`로 처리). 모든 숫자 칸은 `ui.jsx`의 **`NumInput`** 사용.
- **아이템 입력**: 브라우저 기본 `datalist` 금지 — 앱 테마 콤보 **`ItemCombo`**(목록 상시 노출, 빠른 교체). 날짜·셀렉트도 커스텀 컴포넌트(`DateInput`/`CSelect`/`WeekPicker`).
- **UI 일관성**: 새 위젯은 브라우저 기본 대신 `ui.jsx`의 테마 컴포넌트를 재사용/추가한다.

## 하지 말 것

- `main`에 직접 커밋. 검증 안 된 코드 배포.
- 시크릿 키(Supabase service key, Gmail 앱 비밀번호 등) 저장소 커밋.
- 코드 변경 후 Codex 재검수 생략.
- 렌더 함수 내부에 컴포넌트 정의(리마운트로 입력 포커스 유실) — 모듈 스코프로 둘 것.
