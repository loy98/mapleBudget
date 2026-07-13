// 첫 페인트 전에 테마를 선반영해 화면 번쩍임(FOUC)을 막는다.
// 기본 = 시스템(OS 설정) 추종. 저장값 'dark'/'light' 는 고정, 'system'/없음 은 OS 를 따른다.
// 다크가 기본(:root)이고 라이트만 data-theme="light" 로 켠다 — App.jsx 의 테마 이펙트와 같은 규칙.
//
// **인라인 <script> 로 두면 안 된다.** public/_headers 의 CSP 가 script-src 'self' 라 인라인은 차단되고,
// 그러면 이 코드가 아예 실행되지 않아 라이트 테마 이용자는 매 로드마다 다크 화면을 한 번 보게 된다.
// 같은 이유로 defer/async 를 붙이지 않는다 — 첫 페인트보다 먼저 끝나야 의미가 있다.
try {
  var t = localStorage.getItem('mvpTheme');
  var dark = t === 'dark' || ((!t || t === 'system') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (!dark) {
    document.documentElement.setAttribute('data-theme', 'light');
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', '#f4efe4');
  }
} catch (e) { /* localStorage 차단(프라이빗 모드 등) → 기본 테마로 둔다 */ }
