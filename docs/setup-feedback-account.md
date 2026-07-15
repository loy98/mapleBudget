# 배포 전 대시보드 작업 — 계정 삭제 · 문의 내역 · 첨부 · 메일 알림

> 코드는 `feature/account-and-feedback` 브랜치에 있다. **아래 ①~④를 먼저 해야** 새 기능이 실제로 동작한다.
> 시크릿(Resend 키 등)이 필요해서 저장소에 넣을 수 없다 — 전부 대시보드/CLI 작업이다.
>
> ①만 해도 **계정 삭제 · 문의 내역 · 상태/답변**은 동작한다(②~④는 첨부와 메일).
> 순서대로 하되, ②~④는 나중에 해도 앱이 깨지지 않는다(첨부 업로드만 실패한다).

---

## ① SQL 적용 (필수)

Supabase 대시보드 → **SQL Editor** → `supabase/schema.sql` **전체를 붙여넣고 Run**.
멱등(idempotent)하게 짜여 있어 이미 있는 테이블·정책은 건너뛴다. 새로 생기는 것:

| 대상 | 내용 |
|---|---|
| `feedback` 컬럼 | `status`(접수됨/확인 중/답변 완료/종료) · `reply` · `replied_at` · `attachments` · `updated_at` |
| `feedback` 정책 | 로그인 유저가 **본인 문의만** 조회(`feedback_select_own`) |
| `feedback` 트리거 | 클라이언트가 보낸 상태·답변은 무시하고 덮어씀 / 첨부 경로는 본인 폴더만 / 게스트 첨부 금지 |
| `feedback` 트리거 | `reply` 를 채우면 상태가 자동으로 `answered` + `replied_at` 기록 |
| Storage 버킷 | `feedback-attachments` (비공개, 5MB, 이미지만) + 본인 폴더·규약 경로만 업로드 + 시간당 20개 상한 + 본인 파일 삭제 |
| RPC | `delete_account()` — 앱의 '계정 삭제' 버튼이 호출 |

로컬 PostgreSQL 18 에 스텁을 세우고 **17개 항목을 실측**해 두었다(권한·트리거·탈퇴 시 남의 데이터 보존까지).

## ② 문의에 답변하는 법

대시보드 → **Table Editor → `feedback`** → 그 행의 **`reply`** 칸에 답변을 적고 저장하면 끝이다.

- 상태가 자동으로 **답변 완료**가 되고, 유저의 앱 '피드백 → 내 문의'에 바로 뜬다.
- 회신 이메일을 남긴 유저에게는 메일도 나간다(④까지 마쳤을 때).
- 답변 전에 "보고 있다"고 알리려면 `status` 를 `in_progress` 로 바꾼다.
- 답변하면서 바로 종료하려면 `reply` 를 채우고 `status` 를 `closed` 로 함께 지정한다(운영자 지정이 우선).

## ③ Resend 준비 (메일 알림용)

> ⚠️ **`WEBHOOK_SECRET` 은 필수다.** 이 함수는 `--no-verify-jwt` 로 배포되므로 그 헤더 검사가 유일한 문지기다.
> 설정하지 않으면 함수가 **아무 메일도 보내지 않고 500** 을 돌려준다(fail-closed).
> 예전 판은 경고만 찍고 통과시켰는데, 그러면 누구나 POST 하나로 **임의의 주소에 메일을 쏘는 릴레이**가 된다.

1. [resend.com](https://resend.com) 가입 → **API Keys** → 키 생성(`re_...`).
2. **도메인 인증**(권장): Domains → `maplemvpcalculator.com` 추가 → 안내된 DNS 레코드를 Cloudflare 에 추가.
   - 인증 전에는 샌드박스 발신 주소(`onboarding@resend.dev`)만 쓸 수 있고, **Resend 계정 소유자 본인에게만** 메일이 간다.
     즉 **운영자 알림은 오지만, 문의자에게 보내는 답변 메일은 나가지 않는다.**
   - 인증 후 `RESEND_FROM` 을 `MVP 계산기 <noreply@maplemvpcalculator.com>` 같은 주소로 바꾸면 답변 메일도 나간다.

## ④ Edge Function 배포 + 웹훅 연결

```bash
npx supabase login
npx supabase link --project-ref upyuxwpoiyiyzidncibx
npx supabase secrets set \
  RESEND_API_KEY=re_xxx \
  FEEDBACK_NOTIFY_TO=yesfine13@gmail.com \
  RESEND_FROM="MVP 계산기 <onboarding@resend.dev>" \
  WEBHOOK_SECRET=아무거나_긴_난수 \
  SITE_URL=https://maplemvpcalculator.com
npx supabase functions deploy feedback-notify --no-verify-jwt
```

`--no-verify-jwt` 인 이유: 웹훅은 유저 JWT 없이 호출된다. 대신 `WEBHOOK_SECRET` 헤더로 막는다(아래).

그다음 대시보드 → **Database → Webhooks → Create a new hook**:

| 항목 | 값 |
|---|---|
| Name | `feedback-notify` |
| Table | `public.feedback` |
| Events | **Insert**, **Update** |
| Type | HTTP Request → POST |
| URL | `https://upyuxwpoiyiyzidncibx.supabase.co/functions/v1/feedback-notify` |
| HTTP Headers | `Content-Type: application/json` , **`x-webhook-secret: 위에서 정한 난수`** |

동작:
- **Insert** → 운영자(`FEEDBACK_NOTIFY_TO`)에게 "새 문의" 메일.
- **Update** → `reply` 가 새로 채워졌고 회신 이메일이 있으면 **문의자**에게 "답변 등록" 메일.

메일 발송이 실패해도 함수는 200 을 돌려준다(웹훅 무한 재시도 방지). 실패 사유는
대시보드 → Edge Functions → `feedback-notify` → **Logs** 에서 본다.

---

## 확인 방법 (배포 후 5분)

1. 로그인 → 피드백 → **문의하기**: 이미지 1~2장 붙여 전송 → "잘 전달됐어요".
2. **내 문의** 탭: 방금 문의가 **접수됨** 배지로 보이고, 펼치면 첨부 이미지가 보인다.
3. 메일함: "[MVP 계산기] 새 문의" 도착(④까지 했다면).
4. Table Editor 에서 그 행의 `reply` 를 채운다 → 앱의 내 문의가 **답변 완료**로 바뀌고 답변이 보인다.
5. (선택) 테스트 계정으로 **계정 삭제** → 재로그인하면 데이터가 비어 있고, `feedback` 행은 남되 `user_id`/`email` 이 비어 있다.

## 한계 · 알아둘 것

- **게스트 문의는 '내 문의'에 안 나온다.** 주인을 증명할 방법이 없어서다(앱이 그렇게 안내한다).
- **게스트는 이미지 첨부 불가.** 익명 업로드를 열면 스토리지 남용의 문이 된다.
- **영상은 받지 않는다.** 무료 스토리지 1GB 를 몇 개로 채운다(이미지 5MB × 5장).
- 첨부는 비공개 버킷이라 **메일에 링크를 넣어도 열리지 않는다.** 대시보드에서 본다
  (Storage → `feedback-attachments` → 해당 유저 폴더). **답변 전에 미리 봐 둘 것** — 아래 이유로 사라질 수 있다.
- **유저는 자기 첨부를 지울 수 있다.** 전송 실패로 남은 고아 파일을 정리하고, 탈퇴 시 실물 파일을
  실제로 파기하려면 그 권한이 필요하다(SQL 로 행만 지우면 파일은 백엔드에 남는다).
  대가로, 이미 보낸 문의의 첨부도 유저가 지울 수 있다 — 자기 데이터를 지울 권리를 더 무겁게 봤다.
- **탈퇴 시 첨부는 파기된다.** 문의 글(본문)만 익명 상태로 남는다 — 첨부 경로에는 uid 가 박혀 있어
  남겨 두면 탈퇴한 사람의 문의들을 uid 로 다시 꿸 수 있다(= 익명화가 절반만 참이 된다).
- 스토리지 사용량은 가끔 확인할 것. 오래된 문의의 첨부를 지우면 용량이 회수된다.

### 고아 첨부 청소 (가끔)

탈퇴는 **계정 삭제(되돌릴 수 없는 쪽)를 먼저 확정하고** 그다음에 브라우저가 실물 파일을 지운다.
그 마지막 단계가 실패하면(탭을 닫았거나 네트워크가 끊겼거나) 파일이 남는다. **찾을 수 있게 설계돼 있다** —
소유자가 끊긴(`owner is null`) 객체가 그것이다:

```sql
-- 남은 고아 첨부 확인
select name, created_at from storage.objects
 where bucket_id = 'feedback-attachments' and owner is null
 order by created_at;
```

지우는 것은 **SQL 이 아니라 대시보드에서** 한다(Storage → `feedback-attachments` → 해당 파일 삭제).
SQL 로 행만 지우면 실물 파일이 백엔드에 남아 용량도 회수되지 않고 존재도 추적할 수 없게 된다.
