# 촬영 방법 영상(고정촬영판 F2.12 기준) 만들기

결과: `AI_Footarch_촬영방법_F2.12.mp4` (1:23.5, 1920×1080, 원래 영상 배경음악)

1. 재료를 `/tmp/vid/assets/`에 둔다
   - `foot_clean.jpg` (이 폴더, 원래 영상 4초 장면에서 잘라 낸 오른발 안쪽 사진, 스티커는 그려 넣음)
   - 앱 화면: `self.png self-scroll.png result-flat.png result-normal.png exercises.png reminder.png` (가짜 서버로 앱을 열어 390×844·배율 3으로 찍음)
   - `capture.png` = `test/shots/s03-std-align.png` (e2e-self C 실행 결과, 카메라 영역에 실제 발 사진을 합성)
   - 배경음악: 원래 영상에서 `ffmpeg -i 원본.mp4 -vn -c:a pcm_s16le /tmp/vid/music.wav`
2. `NODE_PATH=$(npm root -g) node scenes.js` → `/tmp/vid/frames/*.jpg` + `plan.json` (장면별 상태·길이)
3. `python3 render.py` → 장면별 mp4(상태 사이 0.35초 교차, 장면 앞뒤 0.4초 페이드)
4. 이어 붙이기: concat `-c copy` → 음악 `apad,atrim,afade` 2.5초 마무리로 넣기
- 한 장면만 고치려면: `node scenes.js s05` → `python3 render.py s05` → 다시 이어 붙이기
