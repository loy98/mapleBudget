// feedback-notify · 피드백 메일 알림 (Supabase Edge Function, Deno)
//
// Database Webhook(feedback 테이블의 INSERT/UPDATE)이 이 함수를 부른다.
//  · INSERT → 운영자에게 "새 문의가 왔다" 메일
//  · UPDATE → reply 가 새로 채워졌고 회신 이메일이 있으면, 문의자에게 "답변이 등록됐다" 메일
//
// 메일 발송은 Resend(https://resend.com) REST API. 시크릿은 전부 환경변수로 받는다 —
// 저장소에는 절대 키를 두지 않는다.
//
// 환경변수(대시보드 → Edge Functions → Secrets):
//   RESEND_API_KEY      필수. Resend API 키.
//   FEEDBACK_NOTIFY_TO  필수. 운영자 수신 주소(예: yesfine13@gmail.com).
//   RESEND_FROM         선택. 기본 "MVP 계산기 <onboarding@resend.dev>".
//                       ⚠ 샌드박스 발신(onboarding@resend.dev)은 **Resend 계정 소유자에게만** 보낼 수 있다.
//                       문의자에게 답변 메일을 보내려면 Resend 에서 도메인(maplemvpcalculator.com)을
//                       인증하고 그 도메인 주소로 바꿔야 한다. 인증 전에는 운영자 알림만 도착한다.
//   WEBHOOK_SECRET      **필수.** 웹훅 헤더 x-webhook-secret 과 대조한다. 없으면 함수는 아무 일도 하지 않는다
//                       (fail-closed). 이 함수는 --no-verify-jwt 로 배포되므로, 이 검사가 유일한 문지기다.
//                       열어 두면 누구나 POST 로 record.email 을 넣어 **임의 주소로 메일을 쏘는 릴레이**가 된다.
//   SITE_URL            선택. 메일 본문에 넣을 서비스 주소. 기본 https://maplemvpcalculator.com

interface FeedbackRow {
  id: number;
  created_at: string;
  user_id: string | null;
  email: string | null;
  category: string | null;
  message: string;
  user_agent: string | null;
  status: string;
  reply: string | null;
  attachments: unknown;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: FeedbackRow | null;
  old_record: FeedbackRow | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  suggestion: "건의 · 개선",
  bug: "버그 신고",
  question: "질문",
  etc: "기타",
};

const env = (k: string) => Deno.env.get(k) ?? "";

async function sendMail(to: string, subject: string, text: string) {
  const key = env("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY 가 설정되지 않았습니다");
  const from = env("RESEND_FROM") || "MVP 계산기 <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    // 본문에 실패 사유가 들어 있다(도메인 미인증 등). 로그로만 남긴다 — 메일 실패가 웹훅을 무한 재시도시키지 않도록.
    throw new Error(`resend ${res.status}: ${await res.text()}`);
  }
}

// 첨부 개수만 센다(경로는 비공개 버킷이라 링크를 메일에 넣어도 열리지 않는다 → 대시보드에서 본다).
const countAttachments = (v: unknown) => (Array.isArray(v) ? v.length : 0);

// 시크릿 비교는 이르게 빠져나오지 않는다(문자 단위 조기 반환은 타이밍 정보를 흘린다).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  // 웹훅 외의 호출을 막는다. **fail-closed**: 시크릿이 없으면 아무 일도 하지 않는다.
  // 예전 판은 시크릿이 없으면 경고만 찍고 통과시켰다 — 그러면 이 함수는 인증 없는 공개 엔드포인트라,
  // 누구나 record.email 을 실은 가짜 UPDATE 를 POST 해 **임의의 주소로 메일을 보내는 릴레이**가 된다
  // (운영자 메일 폭탄도 마찬가지). 세팅이 덜 된 상태는 '메일이 안 오는' 것으로 드러나야 한다.
  const secret = env("WEBHOOK_SECRET");
  if (!secret) {
    console.error("[feedback-notify] WEBHOOK_SECRET 미설정 — 알림을 보내지 않습니다(설정 후 재배포할 것)");
    return new Response("misconfigured", { status: 500 });
  }
  // 길이가 달라도 상수 시간에 가깝게 비교한다(타이밍으로 시크릿을 재구성하는 것을 어렵게).
  if (!timingSafeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) {
    return new Response("forbidden", { status: 403 });
  }

  let body: WebhookPayload;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (body.table !== "feedback" || !body.record) {
    return new Response("ignored", { status: 200 });
  }

  const r = body.record;
  const site = env("SITE_URL") || "https://maplemvpcalculator.com";
  const cat = CATEGORY_LABEL[r.category ?? ""] ?? (r.category || "기타");
  const nAtt = countAttachments(r.attachments);

  try {
    if (body.type === "INSERT") {
      const to = env("FEEDBACK_NOTIFY_TO");
      if (!to) throw new Error("FEEDBACK_NOTIFY_TO 가 설정되지 않았습니다");
      await sendMail(
        to,
        `[MVP 계산기] 새 문의 · ${cat} (#${r.id})`,
        [
          `종류: ${cat}`,
          `문의번호: #${r.id}`,
          `작성자: ${r.user_id ? `로그인 유저 (${r.user_id})` : "게스트"}`,
          `회신 이메일: ${r.email || "(없음)"}`,
          `첨부: ${nAtt}장`,
          `브라우저: ${r.user_agent || "(없음)"}`,
          "",
          "─────────────────────────",
          r.message,
          "─────────────────────────",
          "",
          "답변하려면 Supabase 대시보드 → Table Editor → feedback 에서 그 행의 reply 를 채우세요.",
          "(reply 를 채우면 상태가 자동으로 '답변 완료'가 되고, 회신 이메일이 있으면 문의자에게 메일이 갑니다.)",
          site,
        ].join("\n"),
      );
      return new Response("notified:admin", { status: 200 });
    }

    if (body.type === "UPDATE") {
      const prev = body.old_record;
      const replyAdded = !!r.reply && r.reply !== (prev?.reply ?? null);
      if (!replyAdded) return new Response("ignored:no-new-reply", { status: 200 });
      if (!r.email) return new Response("ignored:no-email", { status: 200 });
      await sendMail(
        r.email,
        `[MVP 계산기] 문의하신 내용에 답변이 등록되었습니다 (#${r.id})`,
        [
          "보내주신 문의에 답변이 등록되었습니다. 앱에서도 '피드백 → 내 문의'에서 보실 수 있어요.",
          "",
          "─ 보내신 내용 ─",
          prev?.message ?? r.message,
          "",
          "─ 답변 ─",
          r.reply ?? "",
          "",
          site,
        ].join("\n"),
      );
      return new Response("notified:user", { status: 200 });
    }
  } catch (e) {
    console.error("[feedback-notify] 메일 발송 실패", e);
    // 200 을 돌려준다: 메일 실패로 웹훅이 재시도를 반복해도 이미 저장된 문의가 달라지지 않는다.
    // 실패는 함수 로그(대시보드 → Edge Functions → Logs)에서 확인한다.
    return new Response("mail-failed", { status: 200 });
  }

  return new Response("ignored", { status: 200 });
});
