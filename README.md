# 메이플 MVP작 효율 계산기

메이플스토리 MVP 등급작(엠작) 최적 비용 계산기. 선물식·메소마켓·경매장 되팔기 비교, 마일리지, 거래 기록, 13주 달력, 등급 유지 스케줄 기능을 제공합니다.

기존 단일 HTML(`_archive/legacy/mvp-calculator.html`)을 Vite + React로 리팩터링한 버전입니다.

## 프로젝트 구조

```
index.html          진입 HTML (SEO 메타태그 포함)
vite.config.js      Vite + PWA 설정
public/             파비콘, PWA 아이콘
src/
  main.jsx          엔트리
  App.jsx           탭 전환, 상태 관리, 백업/복원
  styles.css        전체 스타일
  lib/              순수 로직 (UI 없음)
    constants.js    등급/충전방식/기본값 상수
    util.js         포맷·날짜 유틸
    calc.js         계산기 파생값 (충전 배분, 플랜 등)
    ledger.js       거래 원장 통계, 13주 누적, 예측
    storage.js      localStorage 저장/복원, JSON 백업
  components/
    ui.jsx          숫자 스테퍼, 커스텀 셀렉트, 날짜 피커 등
    CalcTab.jsx     계산기 탭
    LogTab.jsx      거래 기록 탭 (통계/달력/입력)
    ForecastTab.jsx 예상 & 추천 탭
```

## 개발

Node.js 18+ 필요.

```bash
npm install     # 최초 1회
npm run dev     # 개발 서버 (http://localhost:5173)
npm run build   # 배포용 빌드 → dist/
npm run preview # 빌드 결과 미리보기
```

## 배포

정적 호스팅 어디든 가능. `npm run build` 후 `dist/` 폴더를 올리면 됩니다.

- **Vercel / Netlify**: GitHub 저장소 연결 → 프레임워크 "Vite" 자동 감지 → 끝 (push마다 자동 배포)
- **GitHub Pages**: 저장소가 `<이름>.github.io`가 아니라면 `vite.config.js`에 `base: "/저장소이름/"` 추가 후 dist를 gh-pages 브랜치로 배포

## 데이터

모든 데이터는 브라우저 localStorage에 저장됩니다 (서버 없음).

- 기존 단일 HTML 버전과 **같은 저장 키**를 사용하므로, 같은 브라우저에서 열면 기존 데이터가 그대로 유지됩니다.
- 기기/브라우저 이동 시: 페이지 하단 **데이터 내보내기(백업) / 가져오기(복원)** 사용 (JSON 파일).

## PWA

빌드 버전은 PWA를 지원합니다. 모바일 브라우저에서 "홈 화면에 추가"로 앱처럼 설치할 수 있고, 오프라인에서도 동작합니다.
