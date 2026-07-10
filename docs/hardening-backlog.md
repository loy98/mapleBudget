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

---

# 2차 전체 검수 (2026-07-10) — 수익화·공개 서비스 전환

분야별 에이전트 5종(보안/동기화/도메인/프론트엔드/인프라) + Codex 독립 감사.
1차(2026-07-05)에서 지적된 항목은 **대체로 실제 반영 확인**. 이번 수확은 수익화 축과 데이터 정합 축.

## ✅ 이번에 해결 (feature/audit-2026-07)

- **약관·방침·크롤러 메타** — `public/privacy.html`·`terms.html`·`robots.txt`·`sitemap.xml`, 푸터 링크,
  넥슨 무관 고지, canonical/og 절대 URL.
- **feedback rate limit** — RLS는 '누가'만 통제하고 '얼마나 자주'는 통제하지 않았다.
  BEFORE INSERT 트리거로 출처당 10분/5건(로그인=user_id, 게스트=IP 솔트 해시. IP 원문 미저장).
- **malformed 입력 크래시** — `normalizeLedger` 등이 배열 아닌 값에 `.forEach` 로 던져 백지 화면.
  데이터 계층 가드 + `ErrorBoundary`(백업 내보내기 제공).
- **uid 충돌** — 4자 난수 → `crypto.getRandomValues`. ledger 병합이 id 합집합이라 충돌 = 거래 소실.
- **dev 의존성 취약점** — vite 6.4.3 / vitest 3.2.7 등, `npm audit` 5건 → 0건.
- **게임 규칙 하드코딩** — 경매장 수수료·마일리지 적립률·등급 기준을 `app_config.rules` 로.
  순수 함수엔 `rules` 인자 주입(순수성 유지), `resolveRules` 가 DB 값을 항목별 검증.
- **모달 a11y** — Esc·포커스 트랩·포커스 복귀·스크롤 잠금(`components/Modal.jsx`). `CSelect` 키보드 조작.
- **계정 간 원장 유입(CRITICAL)** — `mvpDataOwnerUid` 마커로 병합 게이트 + 로그아웃 시 계정 데이터 삭제.
- **예측 '이번 주 포함' 오답** — 이번 주 실제 과금이 계획값으로 대체돼 사라졌다. 지평도 14주→13주.
- **업로드 유실·무재시도** — 플러시 부채를 payload 캡처 시점에 털고, 지수 백오프 + `online` 재시도.
- **LogTab 분할** — 718줄 → 85줄 조립부 + `logtab/{useLedgerDerived,StatsPanel,CalendarPanel,EntryForm,ItemTables}`.
  분할 전후 SSR 마크업 13,506B 바이트 동일 확인.

## ⏳ 미해결 — 설계 필요 (착수 전 반드시 읽을 것)

### ~~B-1. 삭제 전파 부재 (tombstone)~~ — ✅ 해결 (feature/ledger-tombstones)
`ledger.deleted = { [id]: 삭제시각 }` 도입. 병합은 양쪽 표식을 먼저 합친 뒤(같은 id 는 더 늦은 시각)
그 id 를 어느 쪽 버킷에 있든 제거한다(**삭제 우선** — 한쪽이 지우고 다른 쪽이 수정해도 되살리지 않음).
단일 기기 변형(디바운스 전 탭 닫기)도 함께 해결된다. `ledger` 가 JSONB 라 DB 마이그레이션 불필요.
삭제 진입점은 `deleteLedgerEntry` 하나. 표식은 `TOMBSTONE_TTL_DAYS`(1년) 후 만료.
**남은 한계**:
1. TTL 보다 오래 오프라인이던 기기가 삭제된 항목을 아직 들고 있으면 부활시킨다.
   실사용에서 사실상 발생하지 않으며, 영구 보존하면 원장 blob 이 무한히 커진다.
2. ~~B-2(full-blob LWW)로 인한 표식 덮어쓰기~~ — ✅ 함께 해결(아래 B-2 참고).
3. ~~시계 오차로 인한 조기 만료~~ — ✅ 해결. 만료 기준은 서버 `updated_at`(보수적),
   미래 clamp 상한은 `max(서버 시각, 내 시계)`(정상적인 지금)로 **분리**했다(`tombstoneClock`).
   로컬 로드에서는 만료 정리를 아예 하지 않는다. 남은 이론적 구멍: 삭제한 기기의 시계가 TTL 이상
   과거로 틀어져 있으면 그 표식은 다른 기기에서 만료로 보인다(firstSeen 기록이 근본 해법이나 미채택).

### ~~B-2. 탭 2개가 서로를 통째로 덮어씀 (full-blob LWW)~~ — ✅ 해결 (feature/ledger-tombstones)
`updated_at` 을 버전으로 쓰는 **낙관적 동시성 제어**로 대체. `update ... where user_id=? and updated_at=?`
가 stale 이면 0행 → conflict → 서버 최신본을 읽어 재병합(`mergeForUpload`) 후 재시도(최대 5회).
행이 없으면 INSERT 시도, 경쟁하면 23505 → conflict. 로컬 PostgreSQL 18 로 전제 실측 확인:
트리거의 updated_at 증가, stale 조건부 UPDATE 0행, ISO 문자열 왕복 일치, 중복 INSERT 23505.
병합 규칙: 설정/아이템은 이 탭 우선(last-writer-wins), 원장은 합집합 + tombstone 차감.
이로써 B-1(tombstone)의 "stale 탭이 서버 표식을 덮어쓴다"는 한계도 함께 해소된다.
**남은 것**: 탭 간 즉시 반영(BroadcastChannel/`storage` 이벤트)은 없다 — 다른 탭의 변경은
그 탭이 다음 업로드에서 충돌·병합할 때 화면에 반영된다. 정합성 문제는 아니고 UX 지연이다.

### ~~B-2b. my_items 가 last-writer-wins~~ — ✅ 해결 (feature/myitems-merge)
`mergeForUpload` 가 원장만 진짜 병합하고 아이템은 이 탭의 배열을 그대로 썼다 →
stale 탭이 업로드하면 **다른 탭에서 추가한 아이템이 사라졌다.**

- **결정적 id**: 아이템의 정체성은 이름이다(`MY_ITEM_ID_FIELDS`). 같은 이름이 여럿이면 등장 순번으로 가른다.
  `_k`(React key) = `id` 로 두어 병합 후 리마운트되지 않는다.
  단, **빈 이름으로 시작하는 '+ 새 항목'만 `uid()`** 를 준다 — 이름에서 유도하면 두 기기의 새 행이 같은 id 가 된다.
- **삭제 표식**: `ledger.deleted` 안에 `item:<id>` 네임스페이스로 산다. DB 스키마·JSONB 형태를 바꾸지 않고,
  표식을 모르는 구버전 탭도 **모르는 키를 그대로 보존해 업로드**하므로 신버전이 만든 삭제가 살아남는다.
  TTL·개수 상한·병합 로직을 그대로 재사용한다. `safeRowId` 가 `item:` 으로 시작하는 행 id 를 거부해
  가공된 백업이 거래를 아이템 표식으로 지우는 것을 막는다.
- **지웠다가 다시 추가**: id 를 이름에서 유도하므로 표식이 있으면 같은 이름을 다시 넣어도 즉시 다시 지워진다.
  그래서 아이템에 `at`(목록에 들어온 시각)을 두고 **표식보다 나중에 추가된 아이템은 살린다**.
  `at` 없는 구 데이터는 표식이 이긴다(삭제 유지). 삭제는 표식을 `max(now, at+1)` 로 찍어 시계 역전에도 먹힌다.
  '기본 목록 복원'도 복원 시각을 `at` 으로 찍어 옛 표식을 이긴다.
- **같은 id 일 때 승자**: 업로드 충돌 → 이 탭(방금 고친 값), 최초 로그인 → 클라우드(`calc` 와 같은 기준).

함께 해결: ~~`normalizeMyItems` 가 `[]` 와 '없음'을 구분 못함~~ — `[]` = 사용자가 비운 목록,
`null`/비배열 = 데이터 없음 → 기본 목록. 이제 아이템 전체 삭제가 유지된다.

Codex 재검수 4건 중 3건 반영:
- (CRITICAL) 충돌 병합 결과의 `my_items` 를 상태에 반영하지 않아, 다음 자동 업로드가 stale 배열로 서버를
  덮어 다른 기기의 아이템을 지웠다. 반영을 `applyMergedSnapshot` 한 곳으로 묶어 키를 빠뜨릴 수 없게 했다.
- (HIGH) `normalizeDeleted` 가 미래 표식을 `ceiling` 으로 내리는데 `at` 은 안 내려서, 시계가 틀어진 기기의
  미래 `at` 이 clamp 된 표식을 이겨 **지운 아이템이 부활**했다 → `isItemDeleted` 가 `at` 도 같은 상한으로 clamp.
- (MEDIUM) 같은 밀리초에 지우고 복원하면 `at === ts` 라 복원이 삭제에 졌다 → `nextItemAt` 이 남아 있는
  아이템 표식보다 **뒤인** 시각을 고른다. 추가·복원이 모두 이 경로를 쓴다(`addMyItems`/`restoreDefaultMyItems`).

**반박한 지적 1건**: "'+ 새 항목' 이 `uid()` 를 받아 이름 기반 id 계약과 어긋난다."
이름이 채워질 때 id 를 다시 계산하면 React key 가 바뀌어 **입력 도중 리마운트로 포커스를 잃는다**
(CLAUDE.md 가 금지하는 바로 그 증상). id 는 한 번 정해지면 바뀌지 않는다는 규칙을 지키는 쪽을 택했다.

**남은 한계**
1. **구버전 탭의 삭제는 전파되지 않는다.** 표식을 만들지 못하고 배열만 줄여 올리므로 합집합에서 부활한다.
   B-2b 이전에도 결과는 같았다(그때는 LWW 였고 클라우드의 `[]` 를 '데이터 없음'으로 봐 로컬이 이겼다)
   → 회귀가 아니라 표식 방식의 내재적 한계다. 서비스워커 자동 갱신으로 구버전 탭은 곧 사라진다.
2. `TOMBSTONE_MAX`(2000) 를 넘겨 오래된 아이템 표식이 밀려나면 그 아이템은 부활할 수 있다
   (거래 표식과 같은 트레이드오프 — 무한히 쌓이는 것보다 낫다).
3. 두 기기가 각자 '+ 새 항목' 으로 같은 이름을 만들면 id 가 달라 둘 다 남는다(중복 행).
   이름을 각자 다르게 고쳐도 마찬가지다. 데이터 소실이 아니라 표시 중복이며, 사용자가 한쪽을 지우면 된다.

설정(`calc`)은 스칼라 묶음이라 LWW 를 유지한다.

### ~~B-2c. 게스트는 tombstone 이 영원히 쌓인다~~ — ✅ 해결
TTL 정리는 신뢰 가능한 서버 시각이 있을 때만 하므로 게스트에게는 돌지 않는다.
대신 **시계와 무관한 개수 상한**(`TOMBSTONE_MAX = 2000`)으로 묶는다 — 상대 순서만 쓰므로
틀어진 시계에 영향받지 않는다. 넘치면 오래된 표식부터 버린다(오래된 것일수록 아직 그 항목을
든 기기가 있을 확률이 낮다). `normalizeDeleted`/`mergeDeleted` 양쪽에 적용.

### ~~B-3. localStorage 파싱 실패 시 원본 파괴~~ — ✅ 해결 (feature/storage-corruption-guard)
`readJSON` 이 파싱 에러를 삼키고 null 을 반환 → 앱이 빈 상태로 로드 → `App.jsx` 의 자동저장 이펙트가
마운트 시 실행되어 **복구 가능했을 원본 문자열 위에 빈 값을 덮어썼다.** 실측 재현 확인.
· 파싱 실패 시 원본을 `<key>.corrupt` 에 백업한 뒤에만 null 반환. 최초 손상본을 보존(재손상 시 덮어쓰지 않음).
· 백업에 실패하면(공간 부족) 그 키에는 **아예 쓰지 않는다** — 덮어쓰면 원본이 사라진다.
· `exportAll` 이 손상된 원본을 `corruptRaw` 로 함께 내보낸다(백업 파일이 유일한 복구 수단).
· `importAll` 은 사용자가 명시적으로 덮어쓰기를 택한 것이므로 차단을 해제하고, 쓰기 실패 시 조용히
  반쪽 복원하지 않고 오류를 돌려준다.
· `StorageAlert` 배너로 사용자에게 알린다(이전에는 아무 표시도 없었다).

### ~~B-4. 주차 경계가 브라우저 로컬 타임존 기준~~ — ✅ 해결 (feature/week-tz)
MVP 주는 넥슨 서버(KST) 목요일 경계인데 `new Date()` 를 그대로 주차 계산에 넣어 **로컬 타임존**이 기준이었다.
UTC-8 사용자가 수요일 오후에 열면 KST 로는 이미 목요일(새 주)인데 앱은 지난 주를 보여줬다.

고친 방식은 `weekStartThu(dt, tz)` 가 아니다. 주차 함수들은 **민간 날짜(Y/M/D) 연산**이라 시간대를 몰라도 되고,
시간대 해석이 필요한 곳은 오직 **'지금'이 며칠인가** 하나뿐이다. 그래서 진입점을 하나로 모았다:
- `src/lib/tz.js` (의존성 없음 — `util.js`/`constants.js` 가 함께 쓴다)
  - `tzDateStr(instant, tz=APP_TZ)` — 그 순간의 KST 민간 날짜. `formatToParts` 로 조립(로케일 형식 비의존),
    Intl 시간대 데이터가 없으면 로컬로 폴백하고 던지지 않는다.
  - `dateOf("YYYY-MM-DD")` — 민간 날짜 Date. **정오 고정**: 로컬 타임존이 자정에 DST 전환을 하면
    (America/Santiago 등) 그 날 00:00 이 없어 날짜가 밀린다.
  - `nowD()` — 날짜 계산이 '지금'을 얻는 **유일한 진입점**. `todayStr()`/`start13()`/`curMonth()` 가 이것을 쓴다.
- 주차·달력 계산부의 `new Date()` 를 전부 `nowD()` 로 교체(`ledger.js`, `LogTab`, `CalendarPanel`,
  `StatsPanel`, `useLedgerDerived`, `ui.jsx`). `constants.js` 의 `nowStr` 도 `tzDateStr` 로.
- 백업 파일명도 KST(`todayStr()`) — UTC 면 아침 9시 이전 내보내기가 어제 날짜로 찍힌다.
  `exportedAt` 은 '순간'이므로 UTC ISO 유지.

**검증의 함정**: 개발 기계가 KST 라 로컬 기준 코드와 KST 기준 코드가 같은 답을 낸다.
게다가 **Windows 의 Node 는 `TZ=... npm test` 셸 프리픽스를 무시한다**(실측 확인 — 여전히 GMT+0900).
`src/lib/tz.test.js` 가 프로세스 안에서 `process.env.TZ = "America/Los_Angeles"` 를 할당하고
`vi.setSystemTime` 으로 시계를 고정한다. 뮤테이션 검증으로 결함을 실제로 잡는 것을 확인했다.

### ~~B-5. 과거 거래에 현재 설정을 소급 적용~~ — ✅ 해결 (feature/rate-snapshot)
근본 원인의 절반은 **넥슨 규칙을 사용자 설정으로 모델링한 것**이었다.
`mileageRate`("마일리지 결제 비율")는 게임이 정하는 상한인데 계산기에서 편집 가능했고,
바꾸면 `cumNow` 가 재계산되어 13주 누적 과금과 표시 등급이 흔들렸다(실측 41,300 → 47,200원).
→ `app_config.rules` 로 옮겨 편집 불가. 증상이 통째로 사라졌다.

나머지는 요율 성격별로:
· **게임 규칙**(수수료·마일리지 비율) — `rules` 가 발효일 배열 `[{effectiveFrom, ...}]` 을 받는다.
  거래 날짜에 유효한 규칙을 고른다(`resolveRuleHistory` / `rulesAt`). 과거도 정확하다.
  **규칙 값을 고치지 말고 이력을 추가할 것** — 고치면 과거가 소급 변경된다(schema.sql 에 명시).
  가장 이른 항목은 **이미 발효했을 때만** EPOCH 로 내려간다. 미래 발효 규칙을 내리면 아직 오지 않은
  규칙이 지금·과거에 소급된다(Codex 2차 지적). 계산기의 '현재 규칙'은 state 가 아니라 `today` 파생이라
  탭을 열어둔 채 자정을 넘겨도 발효일 경계가 반영된다.
· **사용자 상태**(등급→수수료, 충전 방식→할인) — 거래 행에 스냅샷(`sells._fee`, `buys._effD`).
  `cashes.rate` 가 없으면 `won` 으로 폴백하는 기존 패턴과 같다.
  스냅샷은 불변의 사실이므로 `mergeLedger` 가 병합에서 잃지 않는다(`keepSnapshots`).
  malformed 스냅샷(문자열·NaN·범위 밖)은 '없음' 으로 보고 현재 설정으로 폴백한다(`hasSnapshot`, `util.js`).
  병합도 같은 판정을 쓴다 — malformed 값을 '있음'으로 보면 살아 있는 스냅샷을 덮어 요율이 소실된다.
· **구 데이터** — 과거 요율이 어디에도 없어 복원 불가. 현재 설정 폴백 + 통계 화면에 '추정치' 명시(`hasLegacyRows`).

**남은 한계**: 구 데이터의 수수료·충전 할인은 복원할 수 없다. `pcRoom`(프리미엄 PC방) 이력도 없다.
등급은 원장에서 재구성할 수 있으나(그 주 기준 13주 누적 → estGrade) 원장 시작 직후 13주는 과소 추정되어
오히려 헛갈릴 수 있어 채택하지 않았다.

### ~~B-6. `importAll` 이 백업 파일을 검증하지 않음~~ — ✅ 해결 (feature/import-validation)
`data.app === "mvp-calculator"` 문자열 하나만 보고 파일 내용을 그대로 localStorage 에 썼다.
데이터 계층 가드 덕에 크래시는 없었지만, 형태가 깨진 값은 다음 로드에서 **조용히 기본값으로 떨어졌다** —
사용자는 "복원 완료"를 보고 데이터가 사라진 것을 나중에야 안다.

`validateBackup(data)` 순수 함수로 분리하고 두 종류를 구분한다:
- **거절(error)** — 아무것도 쓰지 않는다. 앱 파일이 아님 / 모르는 미래 `version` /
  복원할 데이터 없음 / `calc`·`myItems`·`ledger` 의 최상위 형태 오류 /
  **원장 버킷이 배열이 아님**(예전에는 조용히 `[]` 로 강등 → 판매 기록 전체 소실).
- **경고(warnings)** — 복원은 하되 알린다. 버려진 행 수, **읽을 수 없는 날짜**(주차·월별 집계에서 빠진다),
  malformed 아이템 수, 알 수 없는 `calMode`. `App.jsx` 가 복원 완료 알림에 함께 띄운다.

쓰기도 **정규 형태로** 한다: `calc` 는 `parseCalcState`→`serializeCalcState` 왕복,
`myItems` 는 malformed 원소 제거, `calMode` 는 아는 값만, `ledger` 는 기존대로 `normalizeLedger`.
`version` 은 `BACKUP_VERSION` 상수로 `exportAll` 과 묶었다.

복원은 **전부 아니면 전무**다. 순서대로 쓰다 뒤쪽이 쿼터로 실패하면 앞 키는 이미 덮인 채
"복원하지 못했습니다"를 돌려줬다(사용자는 아무 일도 없었다고 믿는다). 이제 쓰기 전에 원본 문자열을
잡아 두고 실패 시 되돌린다. 되돌리기까지 실패하면 그 사실을 문구로 알린다.

Codex 재검수 4건 반영:
- 검증은 배열 행을 '제외했다'고 경고하는데 `canonicalizeRows` 의 `typeof x === "object"` 가 배열을 통과시켜
  `{"0":1,"1":2,id:…}` 로 저장했다 → `isPlainObject` 로 통일(경고와 동작의 일치).
- `isValidDate` 가 정규식만 봐서 `2026-99-99`·`2026-02-30` 이 경고 없이 통과했다 → 달력 왕복 검사.
- `"version": null` 은 '버전 없음'이 아니라 형태를 모르는 파일 → 거절(`=== undefined` 만 v1 로 본다).
- 부분 쓰기 롤백(위).

Codex 2차 지적 2건도 반영:
- 롤백 원본 캡처가 `getItem` 예외를 `null` 로 저장해, **캡처 실패와 '원래 없던 키'가 같은 값**이 됐다.
  롤백이 그 키를 `removeItem` 해서 원본을 지웠다 → 원본을 읽지 못하면 **아무것도 쓰지 않는다**.
- `isValidDate` 의 `new Date(y, m-1, d)` 는 `0099` 를 1999년으로 해석한다(두 자리 연도 규칙).
  Date 를 버리고 윤년 산술로 검사한다 — 타임존·DST 도 끼어들지 않는다(B-4 와 같은 원칙).

### ~~B-7. 구버전 원장 행의 id 재발급 → 동기화 후 중복~~ — ✅ 해결 (feature/legacy-row-ids)
`normalizeLedger` 의 `if (!x.id) x.id = uid()` 가 **로드 시점에 랜덤** id 를 붙였다.
같은 pre-id 원장을 가진 두 기기(단일 HTML 시절 데이터, 같은 백업을 양쪽에서 import)가
같은 거래에 다른 id 를 만들고, 합집합 병합이 둘 다 보존 → 통계·13주 누적이 2배.

id 없는 행은 **내용에서 유도한 결정적 id** 를 받는다(`legacyRowId`, `util.js`). "L" 로 시작해 `uid()` 와 구분된다.
- ⚠️ **내용만 해시하면 안 된다.** "같은 날 같은 아이템을 같은 값에 두 번 산 것"은 서로 다른 두 거래인데
  하나로 합쳐진다(중복보다 나쁜 소실). 그래서 같은 내용의 **몇 번째 등장인지**를 함께 넣는다.
  순번은 'id 없는 행'끼리만 센다 — 이미 id 가 있는 행을 셈에 넣으면 나머지 순번이 어긋난다.
- `padDate` 를 **id 유도보다 먼저** 돌린다. 안 그러면 `"2026-7-2"` 와 `"2026-07-02"` 가 다른 id 를 얻는다.
- 필드는 타입별로 정규화(`"3"` 과 `3`, `true` 와 `1`). 구분자는 제어문자 ``
  (없으면 `{item:"ab",memo:"c"}` 와 `{item:"a",memo:"bc"}` 가 같은 id 가 된다).
- 요율 스냅샷(`_fee`/`_effD`)은 id 에 넣지 않는다 — 나중에 붙어도 id 가 흔들리면 안 된다.
- 정규화는 `canonicalizeRows(bucket, rows)` 하나로 모았다: **날짜 zero-pad → 파생값 유도 → id 부여** 순서가 계약이다.
  `mergeLedger` 도 양쪽에 이걸 적용한다(멱등). Codex 2차 지적 두 건이 여기서 나왔다:
  · `mergeLedger` 가 id 없는 클라우드 행을 `if (x && x.id)` 로 **조용히 버렸다**(구버전 클라이언트가 올린
    pre-id 원장이 병합 한 번에 소실). B-7 이전부터 있던 결함이고, 결정적 id 덕에 이제 살릴 수 있다.
  · `cashes` 의 `rate` 는 `won` 에서 유도되는데 id 를 **먼저** 만들어, 한 기기는 won 만 다른 기기는 rate 도 가진
    같은 거래가 다른 id 를 얻어 2건이 됐다.

**남은 한계**: 이 수정 **이전** 버전에서 이미 랜덤 id 를 받아 클라우드에 올린 기기가 있다면,
그 행과 새로 유도된 결정적 id 행은 여전히 별개로 보여 중복된다. 두 id 를 잇는 단서가 없어
자동 복구는 불가능하다(내용 기준으로 합치면 위의 '같은 내용 별개 거래'를 소실시킨다).
해당 사용자는 한쪽 기기에서 중복 행을 지우면 tombstone 으로 전파된다.

### B-9. feedback rate limit 의 IP 버킷은 best-effort — MEDIUM
익명 요청의 IP 는 `request.headers` 의 `cf-connecting-ip`/`x-forwarded-for` 에서 읽는다.
XFF 는 신뢰 프록시가 '뒤에 덧붙이는' 헤더라 마지막 항목을 읽도록 고쳤지만,
**Supabase 앞단이 실제로 이 헤더를 어떻게 정규화하는지는 프로덕션에 요청을 보내지 않고는 확인할 수 없다.**
정규화가 없다면 공격자가 요청마다 다른 XFF 를 보내 IP 버킷을 우회할 수 있다.
→ 그래서 위조 불가능한 **전역 익명 버킷**(`anon:__all__`, 100건/10분)을 백스톱으로 뒀다.
   우회해도 익명 전체 유입량은 이 상한에 묶인다. 대신 공격자가 상한을 소진시키면
   익명 피드백이 일시 차단된다(로그인 유저는 `auth.uid()` 버킷이라 영향 없음).
**제대로 된 해법**: Turnstile/CAPTCHA + 서버측에서 IP 를 확정하는 Edge Function 경유 INSERT.
배포 후 `feedback_throttle` 의 `anon:__all__` 카운터를 관찰해 상한을 조정할 것.

### B-8. 그 외 (LOW~MEDIUM)
- ~~`visibilitychange` 플러시가 평범한 `fetch`~~ — ✅ 해결. `keepalive: true` 로 보낸다(문서가 사라져도 요청이 산다).
  `sendBeacon` 은 **쓸 수 없다** — 헤더를 못 실어 PostgREST 의 `apikey`/`Authorization` 을 보낼 방법이 없다.
  keepalive 는 본문 64KB 상한이 있어 `fitsKeepalive`(UTF-8 바이트 기준)로 재고, 넘으면 평범한 요청으로 보낸다.
  `pagehide` 도 함께 듣는다(iOS Safari 는 visibilitychange 를 거르기도 한다).
- ~~`writeJSON` 이 `QuotaExceededError` 를 조용히 삼킴~~ — ✅ 해결(B-3 과 함께). `writeJSON` 이 성공 여부를
  반환하고, 쿼터 초과를 `StorageAlert` 로 노출한다. `save*` 도 boolean 을 반환하므로 `useEffect` 축약형
  금지(반환값이 cleanup 으로 해석된다 — App.jsx 주석 참고).
- ~~`normalizeMyItems`: `[]` 와 '데이터 없음'을 구분 못함~~ — ✅ 해결(B-2b 와 함께).
  충전 행을 비우면 `정가 (할인 없음)` 으로 되돌아오는 것은 남아 있다(`parseCalcState`).
- ~~`normalizeLedger` 가 입력 객체를 제자리 변형(mutate)~~ — ✅ 해결. 행을 얕은 복사한 뒤 정규화한다.
- `app_config` 검증이 `name` 만 확인(`chargeMethods` 의 rate/limit, `defaultItems` 의 cash 타입·범위 미검증).
  운영자 실수로 전체 유저 계산이 오염될 수 있다. `rules` 는 이번에 `resolveRules` 로 검증됨.
- `IconView` 가 http(s) 이면 임의 호스트 이미지를 로드(트래킹 픽셀 표면). allowlist 미완(1차 P2-2 부분 해결).
- 에러 트래킹 부재 — 프로덕션 오류를 알 방법이 없다(`ErrorBoundary.componentDidCatch` 에 전송 지점만 마련).
- ~~`mileageRate` 상한 미검증~~ — ✅ 해결. 규칙으로 이동 + `resolveRules` 가 100 이상 거부.
- ~~`manW` 만 `isFinite` 가드 없음~~, ~~`won(-0.4)` → `"-0원"`~~ — ✅ 해결. 포맷 함수 전체에 -0·무한대 가드.
  (`Math.round(-0.4)` 는 `-0`, `(-0.001).toFixed(2)` 는 `"-0.00"` 이다 — 화면엔 오작동으로 보인다.)
- ~~`computeFeePct` 의 조건이 `CalcTab.jsx` 에 재구현~~ — ✅ 해결. `hasFeeBenefit` 하나가 진실 원천이고
  `computeFeePct` 와 `CalcTab` 이 함께 쓴다.
- `MVP_GRADES[0] = "무등급 (15만 미만)"` 이 `TIERS[0].amt` 를 문자열로 복제. `"무등급"` 리터럴이 4곳.
- `ui.jsx`(576줄) 분할 권장: inputs / pickers / Sparkline / labels + `usePopover` 추출(5곳 복붙 ~50줄).
- 커스텀 위젯(`ItemCombo`·`DateInput`·`WeekPicker`·`YMPicker`·달력 셀)이 키보드로 조작 불가.
- CSP `script-src 'self'` 는 애드센스를 차단한다. 광고 종류 확정 시 해당 도메인만 허용할 것.
- `PRIVACY_CONTACT_EMAIL` 플레이스홀더를 실제 연락처로 치환해야 배포 가능.

## 오탐으로 판단해 고치지 않은 것

- **`allocateCharge` 의 `C=0` 폴백이 불연속이라는 지적** — 아니다. `C→0+` 이면 전액이 최고 할인 방식
  한도 안에 들어가 `dRate → topRate` 로 **연속 수렴**하며, 폴백값 `sorted[0].rate/100` 이 바로 그 극한이다.
- **`divisor = weekly 13 / biweekly 6 / 월간 3` 이 `SPLITS` 와 불일치라는 지적** — 아니다.
  이 값은 '13주 롤링 창에 최소 몇 번의 과금이 들어가는가'(격주 최악 6회, 월 1회 최소 3회)이므로
  창 유지에 필요한 회당 금액의 분모로는 올바르다.
