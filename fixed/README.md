# AI Footarch 고정촬영판 (별도 앱)

- 주소: https://dit8601514-bot.github.io/foot-arch-app/fixed/
- 기존 앱(v3.5.0, 루트 주소)과 **코드·서버·기록이 분리**된 별도 앱입니다. 버전 표기 `F1.0.0`, 측정 알고리즘 `ALG-2.7.0`.
- 촬영 조건: 발 윤곽 가이드를 쓰지 않음. **스티커 P1·P2·P3가 모두 보이고 선명하며 움직이지 않을 때(고정)** 자동 촬영. 촬영 거리 **25 cm 고정**(± 2.5 cm, 설정으로 바꿀 수 없음).
- 서버: 고정촬영판 전용 Supabase 프로젝트 `dwgwojexnerqyilngkuy` (`fixed/public/config.js`). 표 만들기: `fixed/supabase/setup_all.sql`을 SQL Editor에서 한 번 실행
- 로그인·회원가입(F2.1.0 다시 살림): 이름·학년·성별·아이디·비밀번호. 측정은 **오른발로 통일**
- 측정 후 결과 화면 '회차에 저장': 기본 측정·1~4회차 중 하나 + Y-balance(오른발) → 서버 `rounds` 표
- 관리자 앱 https://dit8601514-bot.github.io/foot-arch-app/fixed/admin/ → **측정 시트**(시트지와 같은 표: 이름·성별 × 기본 측정·1~4회차 측정날짜·RT·Y-balance), Y-balance 바로 고치기, CSV·인쇄
- 서버 설정: `fixed/supabase/setup_all.sql` → `fixed/supabase/rounds.sql`(성별, 회차 표, 관리자 열람). 이메일 확인 끄기, 관리자 지정은 SQL
- 저장소 분리: IndexedDB `footarch-fixed`, localStorage `footarchFixed.*`, 캐시 `footfixed-*`, 서비스 워커 범위 `/fixed/`.
- 빌드: 루트에서 `node build.js` → `dist/fixed/` 도 함께 생성. main에 올리면 기존 앱과 함께 자동 배포.
- 소스: `fixed/src/` (기존 `src/`를 복사해 고친 것 — 기존 앱 수정이 자동으로 따라오지 않음)

## 측정 정의 = 치료사 방식 (ALG-3.0.0~)
- 치료사는 **앉았다 일어섰을 때 P2(발배뼈거친면) 높이가 내려간 양**을 잰다 → 앱도 **앉은 사진 → 선 사진 사이 P2 스티커가 아래로 움직인 거리 × (mm/px)** (`core.js` `p2Movement`)
- 카메라 25 cm 고정 → 바닥은 두 사진에서 같은 자리이므로 바닥선·P1–P3 기준선이 필요 없음. '아래'는 앉은 자세 P1–P3 선(표준 20 mm 높이 → 바닥과 평행)에 수직 → 휴대폰이 기울어도 같은 값
- 카메라 흔들림 점검: 바닥선이 두 사진 모두 잡히면 바닥 이동만큼 빼 줌, 아니면 발꿈치(P3) 이동이 6 mm 넘으면 재촬영 안내
- 정의가 같으므로 처음엔 보정 없음. P2 이동 표본(p2Drop) 5개 이상이면 남은 계통 오차 학습. P2 이동을 못 잰 예외만 기준선+계수 추정

## 모든 사용자 공통 보정계수 (측정 알고리즘의 일부, ALG-2.8.0~)
- 원칙(사용자 결정): 촬영 거리 25 cm 고정 → 같은 조건의 계통 오차를 실측 표본으로 학습한 **공통 보정계수**로 줄인다. **개인별 보정 없음** — 처음 재는 사람도 같은 계수. 표본이 늘수록 계수를 다시 학습해 정확도를 올린다
- 원인: P1–P3 기준선 방식은 서면 P1·P3 자리도 내려앉아 실측(바닥에서 잰 값)보다 작게 나옴. 바닥 기준은 정의상 실측과 같은 양
- 표본 파일 `fixed/calib/samples.json`: `ai` = 기준선 하강 원래 값, `floorDrop` = 바닥 기준 하강(있으면), `ref` = 자로 잰 실측. 새 표본은 맨 아래에 추가
- 학습 `core.js` `learnPopulationCalib` → 방식별 `learnSeedCorrection`(이상치 제외 · 사람 단위 중간값 · 흔들림에 맞춘 수축 · 학습에 안 쓴 자료로 검증 · 보정 없음→더하기→선형 순). 바닥 기준 표본 5개 이상이고 같은 표본에서 더 정확하면 바닥선이 잡힌 측정은 바닥 기준 사용
- `node build.js`가 학습해 측정 엔진(`POP_CALIB`)에 넣음 → 결과·분류·기록·PDF 모두 같은 값. 원래 값은 `comparison.raw`에 남음. 결과 `dist/fixed/calib-model.json`
- 보고서 `node fixed/calib/learn.js` · 시험 `node fixed/calib/test.js`(CI 포함)
- 다른 사람 자료: 사용자 앱 설정 → "실측 표본 내보내기(보정 학습용)" → samples.json에 붙이기
- 바닥선 검출은 기존 앱 v3.5.1(ALG-2.6.1)의 카펫 개선을 이식(실제 사진 113/113 통과)
