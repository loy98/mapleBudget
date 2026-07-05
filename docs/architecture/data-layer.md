# 데이터 계층 — storage.js (순수 함수 + localStorage)

**핵심 원칙**: 직렬화/파싱/정규화는 **순수 함수**로 분리해 **localStorage와 Supabase가 같은 형태를 공유**한다. 기존 저장 키를 유지해 구버전 데이터 승계. 이 함수들이 `pure.test.js`의 주 대상(회귀 안전망).

## localStorage 키
| 키 | 내용 | 동기화 |
|---|---|---|
| `mvpCalc_v4` (`KEY`) | 계산기 설정+충전+계산기 아이템 (serializeCalcState 형태) | 클라우드 `user_data.calc` |
| `mvpItems_v1` (`ITEMS_KEY`) | 자주 쓰는 아이템 | 클라우드 `user_data.my_items` |
| `mvpLedger_v2` (`LKEY`) | 거래 원장 | 클라우드 `user_data.ledger` |
| `mvpCalMode` (`CALMODE_KEY`) | 달력 보기(월력/MVP주간) | **로컬 전용(의도)** — 기기별 뷰 설정 |
| `mvpCloudSyncedUid` (`SYNC_KEY`) | 이 기기가 동기화된 계정 userId | 로컬 마커 |
| `mvpUserTouched` (`TOUCHED_KEY`) | 사용자가 계산기/아이템을 직접 편집함 | 로컬 마커 |

## 순수 변환 함수
- **`serializeCalcState(settings, charges, items)`** → `{...settings, charge: charges, items}` (클라우드/로컬 공통 calc 형태).
- **`parseCalcState(d)`** → `{settings, charges, items}`. 누락 설정은 `DEFAULT_SETTINGS`로 채우되 **빈 문자열/누락은 기본값**(`d[k] != null && d[k] !== ""`). charges/items에 `withRowKeys` 적용.
- **`normalizeLedger(d)`** → 4버킷 보장 + 항목에 `id` 부여 + 구 데이터 `won`→`rate` 승계(`meso>0`일 때만, 아니면 won 폴백).
- **`normalizeMyItems(d)`** → 비었으면 `DEFAULT_ITEMS`, 있으면 그대로 + `withRowKeys`.
- **`withRowKeys(arr)`** → 각 행에 안정 key `_k`(uid) 부여(기존 `_k`는 유지). index key 대체용. **직렬화되어 저장/클라우드에도 포함**(무해, React key 전용).

## 마커 헬퍼
- **`markUserTouched()` / `isUserTouched()`** — 사용자 직접 편집 여부(P1-4). App의 사용자 setter에서만 mark. config 자동적용·클라우드 동기화(훅이 `setCalcState/setMyItems` 직접 호출)는 표시 안 됨. `mergeSnapshots`의 `localTouched` 힌트로 전달 → 거래 없이 설정만 바꾼 게스트 보호.
- **`isCloudSynced(uid)` / `markCloudSynced(uid)` / `clearCloudSynced()`** — 이 기기·계정 최초 동기화 판별(최초 로그인 프롬프트를 1회만; 새로고침엔 안 뜸). 로그아웃 시 clear.
- **`hasStoredCalc()` / `hasStoredItems()`** — 첫 렌더에서 '저장 이력 없는 새 게스트'인지 판별(자동저장이 곧 채우므로 최초 시점에 캡처). config 시세 기본값을 '새 게스트에게만' 적용하는 데 쓰임.
- **`loadCalMode()` / `saveCalMode(m)`** — 달력 보기 로컬 저장(동기화 안 함).

## 클라우드 스냅샷
- **`localSnapshot()`** → `{calc, my_items, ledger}`(localStorage 3키 읽기) — 병합 입력.
- **`writeLocalSnapshot({calc, my_items, ledger})`** → 3키 쓰기(현재 미사용, 잠재 유틸).

## 내보내기 / 가져오기
- **`exportAll()`** — calc/myItems/ledger/**calMode** 포함 JSON 다운로드(백업 편의로 calMode 포함).
- **`importAll(text)`** — `app: "mvp-calculator"` 검증 후 localStorage 복원. 성공 시 App이 `location.reload()`로 상태 재초기화.
