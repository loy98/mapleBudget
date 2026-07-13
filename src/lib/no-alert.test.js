import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// alert() 는 브라우저를 블로킹한다 — 거래를 저장할 때마다 모달을 손으로 닫아야 했고,
// 연속 입력이 사실상 불가능했다. 전부 토스트로 옮겼다.
// 이 테스트는 **다시 기어들어오는 것을 막는다.** (새 코드에서 무심코 alert 를 쓰기 쉽다)
//
// confirm/prompt 도 같이 막는다: 선택을 받아야 하면 앱 테마 모달(Modal.jsx)을 쓴다
// — 이미 ConflictModal · UnsyncedLogoutModal 이 그 방식이다.

const NAMES = "alert|confirm|prompt";
// 전역 객체를 거친 호출(window/globalThis/self)과 옵셔널 체이닝·대괄호 접근, 그 **조합**까지 잡는다.
// `foo.alert(...)` 처럼 우리 객체의 메서드는 잡지 않는다(오탐) — 전역 객체 이름이 앞에 있을 때만.
const GLOBALS = "window|globalThis|self";
const OPT = String.raw`(?:\?\.)?`;   // 옵셔널 체이닝: window?.alert / window.alert?.( / window?.["alert"]
const CALL = String.raw`${OPT}\s*\(`; // 호출부 — `?.(` 도 호출이다
const PATTERNS = [
  // 맨몸 호출: alert( / confirm( / prompt(   ← 앞에 `.`나 식별자 문자가 없어야 한다
  new RegExp(String.raw`(?<![.\w$])(?:${NAMES})\s*${CALL}`),
  // 점 접근: window.alert( , globalThis?.confirm( , self . prompt( , window.alert?.(
  new RegExp(String.raw`\b(?:${GLOBALS})\s*(?:\?\.|\.)\s*(?:${NAMES})\s*${CALL}`),
  // 대괄호 접근: window["alert"]( , globalThis['confirm']?.( , window?.["prompt"](
  new RegExp(String.raw`\b(?:${GLOBALS})\s*${OPT}\s*\[\s*["'\`](?:${NAMES})["'\`]\s*\]\s*${CALL}`),
];
const hasNativeDialog = (code) => PATTERNS.some((re) => re.test(code));

// 주석에서 언급하는 건 허용해야 한다 — 왜 걷어냈는지 설명하는 주석이 코드에 남아 있다.
// 줄 끝의 `\r` 를 먼저 턴다: `.` 는 `\r` 를 매치하지 않아, CRLF 파일에서는 `//.*$` 가 주석을 지우지 못하고
// 주석 속 `alert()` 가 코드로 오인된다. (git 이 체크아웃하며 LF→CRLF 로 바꾸면 실제로 그렇게 된다.)
const stripComment = (line) => line.replace(/\r$/, "").replace(/\/\/.*$/, "");

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { yield* sourceFiles(p); continue; }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (/\.test\.(js|jsx)$/.test(name)) continue; // 테스트는 스텁으로 부를 수 있다
    yield p;
  }
}

describe("네이티브 대화상자 금지", () => {
  it("src 어디에도 alert/confirm/prompt 호출이 없다", () => {
    const offenders = [];
    for (const file of sourceFiles("src")) {
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (hasNativeDialog(stripComment(line))) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  // Codex 지적: 정규식이 맨몸 호출만 잡으면 우회가 그대로 통과한다.
  // 검사기 자신을 검사한다 — 아래가 통과하지 않으면 위 테스트의 초록불은 아무 의미가 없다.
  it("검사기가 우회 호출도 잡는다", () => {
    const mustCatch = [
      `alert("x")`,
      `confirm("x")`,
      `prompt("x")`,
      `window.alert("x")`,
      `globalThis.confirm("x")`,
      `self.prompt("x")`,
      `globalThis?.alert("x")`,
      `window ["alert"] ("x")`,
      `globalThis['confirm']("x")`,
      `if (confirm("정말?")) doIt()`,
      `const ok = window . confirm ( "x" )`,
      // 조합형 우회 (Codex 2차 지적)
      `window?.["alert"]("x")`,
      `window["confirm"]?.("x")`,
      `window.alert?.("x")`,
      `alert?.("x")`,
    ];
    expect(mustCatch.filter((s) => !hasNativeDialog(s))).toEqual([]);
  });

  // 회귀: `.` 는 `\r` 를 매치하지 않는다 → CRLF 파일에서 `//.*$` 가 주석을 지우지 못하고,
  // "왜 alert() 를 걷어냈나" 같은 **주석이 코드로 오인**돼 초록불이 빨간불이 됐다.
  // (git 이 체크아웃하며 LF→CRLF 로 바꾸면 실제로 그렇게 된다.)
  it("CRLF 줄바꿈이어도 주석을 코드로 오인하지 않는다", () => {
    expect(hasNativeDialog(stripComment("// 왜 alert() 를 걷어냈나\r"))).toBe(false);
    expect(hasNativeDialog(stripComment("  toast.warn('x'); // confirm() 대신\r"))).toBe(false);
    // 그렇다고 진짜 호출을 놓치면 안 된다.
    expect(hasNativeDialog(stripComment("  alert('x');\r"))).toBe(true);
  });

  it("검사기가 무해한 코드를 오탐하지 않는다", () => {
    const mustPass = [
      `toast.warn("입력된 항목이 없습니다.")`,
      `setAskUnsynced(true)`,
      `const alerted = true`,             // 이름 일부가 겹칠 뿐
      `promptText.length > 0`,
      `this.confirmSelection(x)`,          // 우리 객체의 메서드
      `obj.alertCount += 1`,
      `<StorageAlert />`,
      `confirmUnsynced && renderModal()`,  // 호출이 아니다
    ];
    expect(mustPass.filter((s) => hasNativeDialog(s))).toEqual([]);
  });
});
