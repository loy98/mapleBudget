import React from "react";
import ReactDOM from "react-dom/client";
// 웹폰트(자체 호스팅) — 본문/한글 Noto Sans KR, 숫자 Sora. 필요한 웨이트만 로드(unicode-range 서브셋).
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-kr/800.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/700.css";
import "@fontsource/sora/800.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { installGlobalErrorHandlers } from "./lib/errorLog.js";
import "./styles.css";

// ErrorBoundary 가 못 잡는 것들(이벤트 핸들러·async·Promise 거절)도 로컬에 남긴다.
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
