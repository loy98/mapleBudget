# 동기화 · 백엔드 — useCloudSync + Supabase

동기화 로직은 **`src/lib/useCloudSync.js` 훅에 응집**(2026-07 리팩터로 App.jsx에서 추출). 동기화 관련 수정은 App이 아니라 이 훅을 본다. **fragile → 변경 시 반드시 빌드+런타임+Codex 2단계 검증.**

## 백엔드: Supabase
- **인증**: Google OAuth + 이메일 매직링크. `redirectTo/emailRedirectTo = window.location.origin` (도메인 바꾸면 Supabase Auth의 Site URL·Redirect URLs 갱신 필수, [infra-and-ops.md](infra-and-ops.md)).
- **테이블 `user_data`** (사용자당 1행): `user_id`(PK, auth.users), `calc`/`my_items`/`ledger`(JSONB), `updated_at`(트리거 자동 갱신). **RLS**: `FOR ALL to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)` → SELECT/INSERT/UPDATE/DELETE 전부 본인 행만, user_id 위조 불가, anon 접근 차단. (실측 확인됨.)
- **테이블 `app_config`** (id=1, `config` JSONB): 시세성 공용 설정. **RLS**: `for select using(true)`만(anon 포함 읽기), 쓰기 정책 없음 → 클라이언트 수정 불가, 대시보드(service role)로만. DDL·시드는 `supabase/schema.sql`.
- **공개키**(publishable/anon)만 `.env` 커밋(브라우저 노출 정상, 보안은 RLS). service key 등 시크릿 커밋 금지.

## cloud.js (얇은 API + 순수 병합)
- 인증: `onAuthChange/signInWithGoogle/signInWithEmail/signOut(→clearCloudSynced)`.
- 데이터: `fetchUserData(uid)`(updated_at 포함 select), `upsertUserData(uid, {calc,my_items,ledger})`.
- 설정: `fetchAppConfig()` → app_config.config(실패/오프라인/게스트면 null → constants 폴백).
- **순수 병합**: `mergeSnapshots(local, cloud, {localTouched})` → `{snapshot, conflict}`. ledger는 `mergeLedger`로 **id 기준 합집합**(거래 손실 없음, 같은 id는 클라우드 우선 — 항목별 타임스탬프 없어 정밀비교 불가한 알려진 한계). calc/my_items는 클라우드 비어있지 않으면 클라우드 우선. `conflict = (cloudHasCalc||cloudHasItems) && (ledgerActive || localTouched)`.

## useCloudSync 훅 — 반환 `{session, syncState, chargeOptions, conflictPrompt}`
입력: 계산기 state + 안정 세터(`setCalcState/setMyItems/setLedger`). 이펙트:
1. **세션 구독** — 첫 콜백=auth 해석(`authResolved`).
2. **app_config 로드** — `chargeOptions`(드롭다운, 즉시 반영)·`appConfig` 세팅.
3. **시세/기본아이템 기본값 적용** — auth 해석 후 '저장 이력 없는 게스트'에게만 1회. `configRatePatch`(공유 키 목록 `CONFIG_RATE_KEYS`).
4. **force 적용** — `appConfig.force` 배열의 키를 모든 유저에게 덮어씀. 컨텍스트('__guest__'/userId)별 '데이터 정착 후' 1회. 정착 신호=게스트 `authResolved`/로그인 `syncedUserRef===userId`.
5. **최초 로그인 동기화** — fetch→`mergeSnapshots`→상태 반영. conflict면 **테마 모달**(`conflictPrompt`, App이 렌더)로 선택(async 프로미스; cleanup서 안전 해소). 첫 로그인 마커는 첫 업로드 성공 후.
6. **디바운스 업로드**(800ms) + **탭 숨김 플러시**(visibilitychange) — 둘 다 `runUpload(uid)` 단일 러너 공유.

## 동기화 불변식 (깨면 데이터 꼬임 — 절대 유지)
1. **단일 in-flight 직렬화** — `upsertingRef`. 외부에서 리셋 금지(계정 전환 복구는 `syncNonce` 재예약으로).
2. **교차 계정 write 차단** — 각 upsert write 직전 `liveUserIdRef.current === 캡처 uid`. 불일치면 `aborted` 후 성공 처리 스킵(중단을 성공으로 오인 금지).
3. **최초 로그인 마커 1회** — `pendingCloudSyncMarkRef`, 첫 업로드 성공 후에만 `markCloudSynced`. 새로고침엔 프롬프트 안 뜸.
4. **계정 전환 재예약** — 업로드 중 계정 바뀌면 finally에서 `syncNonce++`(직렬화 유지한 채 새 계정 업로드 트리거).
5. **force 정착은 ref로** — `syncedUserRef`(실제 데이터 로드 완료), cloudReady state의 stale read 회피.
6. **`runUpload`는 `useCallback([])`** — refs+안정 setter만 읽어 안정 identity(이펙트 deps에 포함해도 재실행 없음), do-while dirty-retry로 플러시 중 변경도 소비.
7. **렌더 본문에서 `dataRef.current`·`liveUserIdRef.current` 갱신**(의도적) — async 콜백만 읽어 '항상 최신값' 필요, 파생값 재기록이라 StrictMode에 idempotent. useEffect로 옮기면 stale 창 생김.

## app_config 운영 (재배포 없이 수정)
Supabase SQL Editor:
```sql
update app_config set config = jsonb_set(config,'{mesoRate}','3200') where id=1;          -- 시세 변경
update app_config set config = jsonb_set(config,'{force}','["mesoRate"]') where id=1;      -- 모든 유저 강제
```
반영: chargeMethods=모두(새로고침 시), 시세/기본아이템=새 게스트에게(force면 모두). 상세 [/CLAUDE.md](../../CLAUDE.md), 메모리 `app-config-db`.

## 미해결(보류)
- **행 단위 LWW**: 진짜 lost-update 방지엔 항목별 `updatedAt`+삭제 tombstone 인프라 필요. 현재 "같은 id 클라우드 우선"의 알려진 한계. [../hardening-backlog.md](../hardening-backlog.md) P2-3.
