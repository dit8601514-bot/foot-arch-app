# AI Footarch 고정촬영판 (별도 앱)

- 주소: https://dit8601514-bot.github.io/foot-arch-app/fixed/
- 기존 앱(v3.5.0, 루트 주소)과 **코드·서버·기록이 분리**된 별도 앱입니다. 버전 표기 `F1.0.0`, 측정 알고리즘 `ALG-2.7.0`.
- 촬영 조건: 발 윤곽 가이드를 쓰지 않음. **스티커 P1·P2·P3가 모두 보이고 선명하며 움직이지 않을 때(고정)** 자동 촬영. 촬영 거리 **25 cm 고정**(± 2.5 cm, 설정으로 바꿀 수 없음).
- 서버: 고정촬영판 전용 Supabase 프로젝트 `dwgwojexnerqyilngkuy` (`fixed/public/config.js`). 표 만들기: `fixed/supabase/setup_all.sql`을 SQL Editor에서 한 번 실행
- 관리자 앱: https://dit8601514-bot.github.io/foot-arch-app/fixed/admin/ (기존 관리자 앱과 로그인 분리)
- 저장소 분리: IndexedDB `footarch-fixed`, localStorage `footarchFixed.*`, 캐시 `footfixed-*`, 서비스 워커 범위 `/fixed/`.
- 빌드: 루트에서 `node build.js` → `dist/fixed/` 도 함께 생성. main에 올리면 기존 앱과 함께 자동 배포.
- 소스: `fixed/src/` (기존 `src/`를 복사해 고친 것 — 기존 앱 수정이 자동으로 따라오지 않음)

## 기본 오차 보정 = 표본 학습 (F1.6.0~)
- 표본 파일: `fixed/calib/samples.json` — 앱 원래 값(`ai`, 결과 화면 "앱 측정 x mm")과 자로 잰 실측(`ref`) 짝. 새 표본은 맨 아래에 한 줄 추가
- 학습: `core.js` `learnSeedCorrection` — 이상치 제외(3×MAD) · 사람 단위 중간값(한 사람이 많이 보내도 전체를 끌지 못함) · 흔들림에 맞춘 수축 · 학습에 안 쓴 자료로 검증(3명 이상이면 한 사람씩 빼고) · 보정 없음 → 더하기 → 선형 순으로 확실히 나을 때만
- `node build.js`가 학습해서 앱(BUILTIN_MODEL)·관리자(SEED_SAMPLES)에 넣음. 결과는 `dist/fixed/calib-model.json`
- 보고서: `node fixed/calib/learn.js` · 시험: `node fixed/calib/test.js`(CI에서도 실행)
- 다른 사람 자료: 고정촬영판 관리자 앱 → AI 보정 모델 → "표본 파일 형식으로 내려받기" → samples.json에 붙이기. 관리자 학습(8명·16건 이상)에도 표본이 seed: 참여자로 합쳐짐
