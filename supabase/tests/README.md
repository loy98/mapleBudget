# SQL 실측 (RLS · 트리거 · 탈퇴 RPC)

`schema.sql` 은 **테스트로 덮이지 않는 코드**다. 권한·정책·트리거는 앱 테스트를 아무리 늘려도 검증되지 않는다.
그래서 일회용 PostgreSQL 클러스터에 Supabase 환경을 **스텁으로 세우고 `schema.sql` 을 그대로 적용해** 실측한다.
**SQL 을 바꿨다면 반드시 다시 돌릴 것.**

| 파일 | 내용 |
|---|---|
| `00-supabase-stub.sql` | `auth.uid()`/`auth.role()`, `auth.users`, `storage.buckets`/`objects`/`foldername`, `anon`/`authenticated` 역할 |
| `01-feedback-account.sql` | 21개 어서션. 반복 실행 가능(맨 앞에서 데이터·레이트리밋 카운터를 비운다) |

## 돌리는 법 (Windows · Git Bash)

```bash
PG="/c/Program Files/PostgreSQL/18/bin"          # 사용자 클러스터(5432)는 건드리지 않는다
DATA="$(mktemp -d)/pgdata"
"$PG/initdb" -D "$DATA" -U postgres -A trust -E UTF8
"$PG/pg_ctl" -D "$DATA" -o "-p 55432" -l "$DATA/../pg.log" start

"$PG/psql" -h localhost -p 55432 -U postgres -c "create database t"
for f in supabase/tests/00-supabase-stub.sql supabase/schema.sql supabase/tests/01-feedback-account.sql; do
  "$PG/psql" -h localhost -p 55432 -U postgres -d t -v ON_ERROR_STOP=1 -q -f "$f"
done                                              # 마지막에 "=== 모든 SQL 실측 통과 ===" 가 나와야 한다

"$PG/pg_ctl" -D "$DATA" stop -m fast              # 끝나면 반드시 정리
```

## 무엇을 지키는가

- 상태·답변 **위조 차단**(클라이언트가 보낸 `status`/`reply` 는 트리거가 덮어쓴다)
- 첨부 경로: **본인 폴더 + 규약(`<uid>/[A-Za-z0-9._-]{1,120}`)만**, `..` 탈출·6장·게스트 첨부 차단
- 조회: 로그인 유저는 **본인 문의만**, 게스트는 조회 자체 불가(42501)
- 업로드: 남의 폴더·규약 밖 경로 차단, **시간당 20개** 상한
- 삭제: 자기 파일만(남의 파일은 **0행** — RLS 는 DELETE 를 예외가 아니라 '안 보임'으로 막는다)
- 탈퇴: 계정·동기화 데이터 삭제 / 문의는 **내용 보존 + 익명화**(첨부 참조까지 비움) / **남의 계정·데이터 무사**

## 함정 (다시 밟지 말 것)

- **`must_fail` 의 예외 핸들러가 자기가 던진 실패까지 삼키면 거짓 초록불이 된다.** 성공 여부를 플래그로
  들고 나와 블록 **밖에서** 판정한다(이 파일은 그렇게 돼 있다). 처음엔 이것 때문에 초록불이 났다.
- **RLS 는 DELETE/UPDATE 를 예외로 막지 않는다** — 대상 행이 안 보여 **0행**이 처리될 뿐이다.
  `must_fail` 로 쓰면 헛다리를 짚는다. `get diagnostics row_count` 로 본다.
- **뮤테이션 검증을 할 것.** 방어를 일부러 부수고(예: 첨부 경로 검사 제거, 탈퇴에서 `where` 제거)
  이 스크립트가 잡는지 확인한 뒤에야 초록불을 믿는다.
