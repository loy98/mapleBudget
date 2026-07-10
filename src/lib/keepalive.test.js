import { describe, it, expect, vi, beforeAll } from "vitest";

// supabaseClient 는 import.meta.env 를 읽는다. 테스트에서는 비활성(게스트) 경로로 두면
// createClient 를 부르지 않으므로 네트워크 의존이 없다.
beforeAll(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});

const { fitsKeepalive, KEEPALIVE_MAX_BYTES, setKeepalive } = await import("./supabaseClient.js");
const { keepaliveForBody } = await import("./useCloudSync.js");

// 탭이 닫히는 순간의 마지막 업로드는 `keepalive: true` 로 보내야 취소되지 않는다.
// keepalive 는 본문 64KB 상한이 있고, 넘기면 요청 자체가 거부된다 → 크기를 먼저 판정해야 한다.
describe("keepalive 플러시 — 본문 크기 판정", () => {
  it("작은 payload 는 keepalive 로 보낼 수 있다", () => {
    expect(fitsKeepalive({ calc: {}, my_items: [], ledger: { buys: [] } })).toBe(true);
  });

  it("상한을 넘는 payload 는 거부한다", () => {
    expect(fitsKeepalive({ blob: "x".repeat(KEEPALIVE_MAX_BYTES + 10) })).toBe(false);
  });

  // 한글은 UTF-8 에서 문자당 3바이트다. `s.length` 로 재면 실제 크기를 1/3 로 과소평가해
  // 64KB 를 넘는 요청을 keepalive 로 보내고 브라우저가 통째로 거부한다.
  it("바이트 길이로 잰다 (문자 길이가 아니다)", () => {
    const n = Math.floor(KEEPALIVE_MAX_BYTES / 2); // 문자 수로는 상한 이하, 바이트로는 초과
    const payload = { memo: "가".repeat(n) };
    expect(JSON.stringify(payload).length).toBeLessThan(KEEPALIVE_MAX_BYTES);
    expect(fitsKeepalive(payload)).toBe(false);
  });

  it("직렬화할 수 없는 값이면 안전하게 거부한다", () => {
    const circular = {};
    circular.self = circular;
    expect(fitsKeepalive(circular)).toBe(false);
    expect(fitsKeepalive(undefined)).toBe(false); // JSON.stringify(undefined) === undefined
  });

  it("setKeepalive 는 던지지 않는다 (플러시 종료 시 항상 되돌린다)", () => {
    expect(() => { setKeepalive(true); setKeepalive(false); }).not.toThrow();
  });
});

// Codex 지적: 판정을 '보내기 전 payload' 로 한 번만 하면, 충돌 재시도의 merged(서버 원장 합침)가
// 64KB 를 넘어도 keepalive 로 나가 브라우저가 요청을 거부한다 → 마지막 편집이 통째로 유실된다.
describe("keepalive 는 요청 단위로 판정한다 (Codex 지적)", () => {
  const small = { ledger: { buys: [] } };
  const big = { blob: "x".repeat(KEEPALIVE_MAX_BYTES + 10) };

  it("평상시 업로드는 keepalive 를 쓰지 않는다", () => {
    expect(keepaliveForBody(false, small)).toBe(false);
    expect(keepaliveForBody(false, big)).toBe(false);
  });

  it("플러시라도 본문이 상한을 넘으면 keepalive 를 쓰지 않는다", () => {
    expect(keepaliveForBody(true, small)).toBe(true);
    expect(keepaliveForBody(true, big)).toBe(false); // 병합으로 커진 merged 가 여기에 해당
  });
});
