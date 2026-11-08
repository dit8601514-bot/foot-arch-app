# AI Footarch 고정촬영판 (별도 앱)

- 주소: https://dit8601514-bot.github.io/foot-arch-app/fixed/
- 기존 앱(v3.5.0, 루트 주소)과 **코드·서버·기록이 분리**된 별도 앱입니다. 버전 표기 `F1.0.0`, 측정 알고리즘 `ALG-2.7.0`.
- 촬영 조건: 발 윤곽 가이드를 쓰지 않음. **스티커 P1·P2·P3가 모두 보이고 선명하며 움직이지 않을 때(고정)** 자동 촬영. 촬영 거리 **25 cm 고정**(± 2.5 cm, 설정으로 바꿀 수 없음).
- 서버: 고정촬영판 전용 Supabase 프로젝트 `dwgwojexnerqyilngkuy` (`fixed/public/config.js`). 표 만들기: `fixed/supabase/setup_all.sql`을 SQL Editor에서 한 번 실행
- 관리자 앱: https://dit8601514-bot.github.io/foot-arch-app/fixed/admin/ (기존 관리자 앱과 로그인 분리)
- 저장소 분리: IndexedDB `footarch-fixed`, localStorage `footarchFixed.*`, 캐시 `footfixed-*`, 서비스 워커 범위 `/fixed/`.
- 빌드: 루트에서 `node build.js` → `dist/fixed/` 도 함께 생성. main에 올리면 기존 앱과 함께 자동 배포.
- 소스: `fixed/src/` (기존 `src/`를 복사해 고친 것 — 기존 앱 수정이 자동으로 따라오지 않음)
