import { createClient } from "@supabase/supabase-js";

// 환경변수(빌드타임 주입). 미설정이면 클라우드 동기화 비활성(게스트 전용).
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = !!(url && anon);

// ===== 탭이 닫히는 순간의 마지막 업로드 =====
// 평범한 `fetch` 는 문서가 사라질 때 함께 취소된다 → 탭을 닫으며 한 마지막 편집이 클라우드에 안 올라간다.
// `keepalive: true` 면 문서가 사라져도 요청이 살아남는다.
//
// `navigator.sendBeacon` 은 쓸 수 없다: 헤더를 설정할 수 없어 PostgREST 가 요구하는
// `apikey` / `Authorization: Bearer <token>` 를 실을 방법이 없다.
//
// keepalive 의 대가는 **본문 크기 상한(스펙상 64KB, 모든 in-flight keepalive 요청 합계)** 이다.
// 넘기면 요청 자체가 거부되므로, 큰 원장은 평범한 요청으로 보낸다(취소될 수 있지만 로컬에는 이미
// 저장돼 있어 다음 접속에 동기화된다 — 조용히 실패하는 것보다 낫다).
export const KEEPALIVE_MAX_BYTES = 60_000; // 64KB 에서 헤더·여유분을 뺀 값

export function fitsKeepalive(payload) {
  try {
    const s = JSON.stringify(payload);
    if (typeof s !== "string") return false;
    // UTF-8 바이트 길이. 한글은 문자당 3바이트라 `s.length` 로 재면 크게 과소평가된다.
    return new TextEncoder().encode(s).length <= KEEPALIVE_MAX_BYTES;
  } catch {
    return false; // 순환 참조 등 — 안전하게 평범한 요청으로
  }
}

let keepalive = false;
// 플러시 동안에만 켠다. 켜 둔 채로 두면 이후의 큰 업로드가 64KB 상한에 걸려 실패한다.
export const setKeepalive = (on) => { keepalive = !!on; };
const fetchMaybeKeepalive = (input, init = {}) => fetch(input, keepalive ? { ...init, keepalive: true } : init);

export const supabase = cloudEnabled
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: fetchMaybeKeepalive },
    })
  : null;
