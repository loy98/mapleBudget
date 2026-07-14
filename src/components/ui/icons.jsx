// ===== 인라인 아이콘 (stroke=currentColor) =====
// 헤더/테마 메뉴/스테퍼가 이모지 대신 쓰는 얇은 라인 아이콘. 색은 currentColor 를 따르므로
// 버튼 색만 바꾸면 아이콘도 함께 바뀐다. 크기는 CSS(width/height)로 조절한다.
const base = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

export const IconSun = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export const IconMonitor = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const IconCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconHelp = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconChat = (p) => (
  <svg {...base} {...p}>
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 20l1.4-4.5a8.4 8.4 0 0 1-.9-4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
  </svg>
);

// 후원('커피 한잔') 진입점. 이모지(☕) 대신 라인 아이콘 — 헤더의 다른 버튼들과 톤을 맞춘다.
export const IconCoffee = (p) => (
  <svg {...base} {...p}>
    <path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z" />
    <path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16" />
    <path d="M7 2.5v2M11 2.5v2" />
  </svg>
);

// 복사(계좌번호 등). 보편적인 '겹친 종이' 모양 — 아이콘만으로 뜻이 통하는 몇 안 되는 기호다.
export const IconCopy = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

// 카카오 말풍선(채움). stroke 아이콘들과 달리 면으로 채운다 — 카카오 버튼 위에 얹는 심볼이라.
export const IconKakaoBubble = (p) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden focusable="false" {...p}>
    <path d="M12 3.6C6.9 3.6 2.8 6.9 2.8 10.9c0 2.6 1.7 4.8 4.3 6.1l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.3 0 .7.1 1 .1 5.1 0 9.2-3.3 9.2-7.4S17.1 3.6 12 3.6z" />
  </svg>
);

// 스테퍼용 얇은 셰브론(위/아래). rotate 는 CSS 로.
export const IconChevron = (p) => (
  <svg {...base} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// 시세·조건(설정) 배지 아이콘 — 슬라이더.
export const IconSliders = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </svg>
);

// ===== 섹션/블록 배지용 라인 아이콘 세트 (헤더 컨트롤과 같은 얇은 라인 톤) =====
export const IconChart = (p) => (
  <svg {...base} {...p}>
    <path d="M3 21h18" />
    <path d="M6 21v-7M12 21V5M18 21v-10" />
  </svg>
);

export const IconTrendUp = (p) => (
  <svg {...base} {...p}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M17 7h4v4" />
  </svg>
);

export const IconTarget = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" />
  </svg>
);

export const IconCalendar = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18M8 2v4M16 2v4" />
  </svg>
);

export const IconEdit = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const IconWallet = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <circle cx="16" cy="14" r="1.2" />
  </svg>
);

export const IconCoins = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

export const IconCart = (p) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="20" r="1.3" />
    <circle cx="17" cy="20" r="1.3" />
    <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6" />
  </svg>
);

export const IconTag = (p) => (
  <svg {...base} {...p}>
    <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);

export const IconBanknote = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);

export const IconCard = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </svg>
);

export const IconCloud = (p) => (
  <svg {...base} {...p}>
    <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z" />
  </svg>
);

export const IconCalculator = (p) => (
  <svg {...base} {...p}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);

export const IconBook = (p) => (
  <svg {...base} {...p}>
    <path d="M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z" />
    <path d="M4 20a2 2 0 0 1 2-2h13" />
  </svg>
);

export const IconInfo = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
