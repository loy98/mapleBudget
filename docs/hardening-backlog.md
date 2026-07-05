# 하드닝 백로그 — 전체 검수 종합 (2026-07-05)

Codex + 전문 에이전트 3종(아키텍처/SOLID, 보안/RLS, 코드품질)의 코드·프론트·백엔드·DB 감사 결과 종합.
**종합 위험도: LOW–MEDIUM.** Critical 보안 결함·시크릿 유출 없음. 데이터 정합·확장성·유지보수성 개선 위주.

## 진행 상태 (2026-07-06 반영)
- ✅ **완료·배포**: P0-1/P0-2(RLS 실측 안전 확인) · P0-3(schema app_config) · P1-1(useCloudSync 리팩터) · P1-2(테스트 22건) · P1-3(마지막 편집 플러시) · P1-4(게스트 설정 손실) · P1-5(안정 key) · P1-6(NumInput 소수점) · P2-1(CSP) · P2-2(IconView) · P2-5(force 키 OCP) · P2-6(충돌 모달)
- ✅ **분석 후 무변경 판단**: P2-8(in-flight payload) — 인자 평가 시점 캡처 + dataRef 참조 교체로 이미 안전.
- 📌 **의도적 결정(문서화)**: P2-4(calMode) — 기기별 뷰 설정이라 로컬 전용 유지(클라우드 미동기화). [storage.js loadCalMode 주석]
- ⏳ **보류(별도 설계 필요)**: P2-3(updated_at LWW) — 진짜 LWW엔 행 단위 `updatedAt`·tombstone(삭제 전파) 인프라가 필요. 현재는 "클라우드 우선(같은 id)"의 알려진 한계로 코드에 문서화됨. 다인용 동시편집이 실제 문제화될 때 착수.
- 아래는 원본 감사 상세.

우선순위: **P0 즉시(검증) · P1 다음 작업 전 기반 · P2 하드닝 · P3 관망**.

---

## P0 — 지금 확인/조치 (근간)

### P0-1. `user_data` RLS 4정책 실측 확인 (보안 최대 리스크)
- 앱 전체 보안이 이 정책 하나에 달림. `upsertUserData`가 클라이언트에서 `user_id`를 직접 지정하므로, RLS가 약하면 anon key로 **타인 데이터 read/write** 가능.
- 필요한 정책: SELECT `using(auth.uid()=user_id)`, INSERT `with check(auth.uid()=user_id)`, UPDATE `using()+with check()` 모두. upsert는 INSERT/UPDATE로 갈리므로 셋 다 필요.
- **검증법**(로그인 후 브라우저 콘솔): `supabase.from('user_data').select().neq('user_id', 내UUID)` → 빈 배열이어야. `supabase.from('user_data').update({}).eq('user_id','<타인>')` → 거부여야.

### P0-2. `app_config` 쓰기 불가 확인
- RLS = `for select using(true)`만, INSERT/UPDATE/DELETE 정책 **부재**여야 클라이언트가 시세값 조작 불가.
- 검증: 로그인 후 `supabase.from('app_config').update({config:{}}).eq('id',1)` → 거부여야.

### P0-3. `app_config`를 `supabase/schema.sql`에 추가 (인프라 재현성)
- 코드는 `app_config`를 읽지만 `schema.sql`엔 `user_data`만 있음 → 신규 환경에서 스키마만 적용하면 DB 시세/force 기능이 조용히 죽음(constants 폴백).
- 조치: 테이블 + `grant select to anon, authenticated` + RLS(select true, 쓰기 없음)를 schema.sql에 명시.

---

## P1 — 다음 작업 전에 다질 기반

### P1-1. 동기화 로직을 `useCloudSync` 훅/상태머신으로 추출 (SRP·최우선)
- `App.jsx`가 상태·자동저장·auth·config·force·동기화·업로드를 모두 떠안은 God-component. 정합성이 **useRef 8개**(upsertingRef/dirtyRef/liveUserIdRef/syncedUserRef/freshRef/configAppliedRef/forceAppliedForRef/pendingCloudSyncMarkRef/syncNonce) × **useEffect 9개**의 암묵적 상호작용에 의존.
- **실증**: 이번 세션 force 기능 하나가 Codex 재검수 **5라운드**(auth 레이스 → 이펙트 순서 → cloudReady stale read → syncedUserRef 미리셋)를 겪음. 이 취약성의 직접 증거.
- 조치: `idle→loading→merging→ready→uploading` 명시적 상태머신 + 순수 리듀서로 추출. 플래그 8개를 상태 enum으로 대체 → 순서 의존이 타입으로 드러나고 단위 테스트 가능.

### P1-2. 순수 함수 유닛 테스트 (저비용·고효과 안전망)
- `mergeSnapshots`/`mergeLedger`/`parseCalcState`/`normalizeLedger`는 이미 순수·결정적인데 테스트 0. 병합/승계 규칙이 앱 신뢰의 핵심.
- 조치: vitest로 구데이터 승계·conflict·id 합집합·rate 폴백 케이스 커버. P1-1 리팩터의 안전망.

### P1-3. 마지막 편집 유실 방지 — `visibilitychange`/`beforeunload` 플러시
- 업로드가 800ms 디바운스인데 그 안에 탭 닫기/새로고침하면 마지막 변경이 클라우드에 안 올라감 → 다른 기기에서 사라진 것처럼 보임. `writeLocalSnapshot`은 dead code.
- 조치: `visibilitychange`(hidden)에서 dirty면 `sendBeacon`/동기 업로드로 즉시 플러시.

### P1-4. `mergeSnapshots` — 게스트 설정 조용한 손실
- `conflict` 판정이 **거래 원장 유무에만** 의존. 거래 없이 시세·아이템만 세팅한 게스트가 로그인하면 프롬프트 없이 클라우드로 덮여 설정이 사라짐.
- 조치: `localActive` 판정에 calc/my_items의 "기본값에서 벗어남"도 포함.

### P1-5. 리스트 index key → 안정 key (재현 쉬운 실질 버그)
- `charges`/`items`/EntryForm draft 표들이 `key={i}` 사용. 중간 행 삭제 시 `NumInput`/`ItemCombo` 내부 state(draft/focus/open)가 **다른 행에 얹힘**.
- 조치: draft 항목에 생성 시 `uid()` 부여 → `key={x.id}`. charges/items도 안정 key.

### P1-6. `NumInput` 다중 소수점 → 값 0 소실
- `"1.2.3"` 입력 시 blur에서 `isFinite`가 false라 **onChange(0)**으로 값 소실.
- 조치: `emit`에서 둘째 점 제거(`clean.replace(/(\..*)\./g,"$1")`) 또는 마지막 유효값 유지.

---

## P2 — 하드닝

- **P2-1. CSP·보안 헤더** — `public/_headers`에 CSP(`connect-src`에 `https://*.supabase.co`)·`X-Content-Type-Options`·`Referrer-Policy`·`X-Frame-Options`. Cloudflare Pages 자동 적용. 심층방어(현재 XSS 벡터 거의 없음).
- **P2-2. `IconView` 임의 URL** — 아이콘 URL을 이모지 전용 또는 신뢰 호스트 allowlist로 제한 + `referrerPolicy="no-referrer"`. 동기화되는 값이라 트래킹 픽셀/콘텐츠 스푸핑 표면(스크립트 실행은 아님).
- **P2-3. `updated_at` LWW 반영** — fetch만 하고 병합에 미사용. 행 단위 `updated_at` 비교로 lost-update 완화. 장기적으로 ledger 항목별 `updatedAt`+tombstone(삭제 전파).
- **P2-4. `calMode` 클라우드 동기화 누락** — 동기화 대상을 단일 정의(`SYNCED_KEYS`)로. calMode 포함하거나 "로컬 전용" 명시.
- **P2-5. force/기본값 키 중복 하드코딩(OCP)** — `RATE_KEYS`가 적용부·force부 2곳 중복. "동기화 가능 설정 스키마"를 constants에 선언해 양쪽이 참조.
- **P2-6. `window.confirm` 병합 선택 → React 모달** — 데이터 흐름과 UI 분리, 테스트 가능화. `mergeSnapshots`가 이미 conflict 플래그 반환.
- **P2-7. `dataRef.current` 렌더 본문 갱신** — 부수효과를 렌더에서 수행(StrictMode/concurrent 취약). useEffect로 이동.
- **P2-8. in-flight upsert 계정전환 payload 스냅샷** — `await` 도중 계정 전환 시 payload 고정(`const payload={...dataRef.current}`) + 호출 후 재확인. (RLS가 1차 방어이나 앱단 가드 권장.)

## P3 — 관망 (지금 조치 불필요)

- **단일 행 JSONB blob**: 아이템 하나 수정에 calc+my_items+ledger 전량 전송. 규모 커지면 ledger 정규화 검토(임계치만 정해둘 것).
- **vite/esbuild dev-only CVE**: prod 산출물 무영향(prod 의존성 3개 클린). 급하지 않음.
- **OAuth redirect origin 기반**: Supabase Redirect URLs를 정확한 프로덕션 origin으로 최소화(넓은 와일드카드 금지).
- **dead code 제거**: `writeLocalSnapshot`(P1-3에서 활용하거나 제거).

---

## 잘 되어 있는 점 (검수 확인)
- 시크릿 유출 0(git 히스토리 포함), publishable 키만 커밋(공개 정상). `dangerouslySetInnerHTML`/`eval` 0.
- 동기화 직렬화(단일 in-flight + do-while)·userId 원시값 키잉·순수 함수 분리·모듈 스코프 컴포넌트·포맷 함수 `isFinite` 방어 — 견고.
- 마커를 첫 업로드 성공 후에만 기록(로그인 선택 유실 방지) 등 세심함.
