# Supabase 서버 연결 방법 (약 10분)

AI Footarch는 Supabase(로그인 + PostgreSQL 데이터베이스)를 서버로 씁니다. 무료 요금제로 시연과 소규모 연구가 가능합니다.

## 1. 프로젝트 만들기
1. https://supabase.com 에 가입하고 **New project**를 누릅니다.
2. Region은 **Northeast Asia (Seoul)**을 고릅니다. 개인정보를 국내 리전에 저장하기 위해서입니다.
3. 데이터베이스 비밀번호는 안전한 곳에 보관합니다(앱에는 쓰지 않습니다).

## 2. 테이블과 보안 규칙 만들기
1. 왼쪽 메뉴 **SQL Editor** → **New query**를 엽니다.
2. 이 폴더의 `schema.sql` 내용을 붙여 넣고 **Run**을 누릅니다.
3. 아래가 만들어집니다:
   - 프로필 `profiles`, 측정 기록 `exams`, 운동 기록 `exercise_logs`
   - 본인 데이터만 접근하는 RLS 정책
   - 회원 탈퇴 함수 `delete_user`

## 3. 로그인 설정
1. **Authentication → Sign In / Providers → Email**에서 **Confirm email을 끕니다.**
2. 앱은 아이디를 `아이디@users.footarch.app` 형식의 내부 주소로 바꿔 가입시킵니다. 이 주소로 메일을 보내지 않으므로 이메일 확인이 켜져 있으면 가입이 완료되지 않습니다.
3. (선택) 비밀번호 최소 길이를 8자로 맞춥니다. 앱도 8자 이상을 요구합니다.

## 4. 앱에 연결
1. 대시보드 왼쪽 아래 **Project Settings(톱니바퀴)**를 엽니다.
2. **API Keys**에서 **Publishable key**(`sb_publishable_`로 시작)를 복사합니다. 예전 프로젝트라면 Legacy API keys의 `anon public` 키(`eyJ`로 시작)를 써도 됩니다.
3. **Project URL**(`https://xxxx.supabase.co`)을 복사합니다. 대시보드 위쪽 **Connect** 버튼이나 Project Settings → Data API에 있습니다.
4. 저장소의 `public/config.js`에 넣고 커밋하면 GitHub Pages에 자동 배포됩니다.

```js
window.FOOTARCH_CONFIG = Object.assign({
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseAnonKey: 'sb_publishable_xxxxxxxx',
  emailDomain: 'users.footarch.app'
}, window.FOOTARCH_CONFIG || {});
```

> 공개 키는 앱에 드러나도록 만든 키입니다. 데이터 보호는 RLS가 담당합니다.
> **Secret key(`sb_secret_`)와 service_role 키는 절대 앱이나 저장소에 넣지 마세요.**
> 앱은 공개 키를 `apikey` 헤더로만 보냅니다. 새 공개 키는 JWT가 아니라서 Authorization 헤더에 넣으면 거부되기 때문입니다.

## 5. 관리자 서버 켜기 (관리자 앱 · AI 오차 보정)
1. SQL Editor에서 이 폴더의 `admin.sql`을 실행합니다. `schema.sql` 다음에 실행해야 합니다.
   - 관리자 명단 `admins`와 권한 확인 함수 `is_admin`
   - 연구 동의자만 열람하는 관리자 규칙
   - 임상 NDT 기준값 `reference_ndt`, AI 모델 `calibration_models`, 통계 함수 `admin_stats`
2. 관리자로 쓸 아이디로 **사용자 앱에서 먼저 회원가입**합니다.
3. SQL Editor에서 그 아이디를 관리자로 지정합니다. 관리자 지정은 앱으로는 할 수 없고 여기서만 됩니다.
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = '관리자아이디@users.footarch.app';
   ```
4. 관리자 앱 주소는 사용자 앱 주소 뒤에 `/admin/`을 붙인 곳입니다(예: `https://dit8601514-bot.github.io/foot-arch-app/admin/`).
   - 사용자 앱과 로그인 정보가 따로 저장됩니다.
   - 관리자가 아닌 계정은 서버가 거부합니다.

### 관리자가 볼 수 있는 범위
- **기록:** 회원가입 때 **[선택] 연구 활용 동의**를 한 사용자의 측정·운동 기록만 볼 수 있습니다(읽기 전용).
- **동의하지 않은 사용자:** 대시보드의 인원·건수에만 포함되고, 기록 내용은 서버가 보내지 않습니다.
- **전화번호:** 가려서 표시합니다.
- **CSV 내보내기:** 이름, 아이디, 전화번호 없이 참여자 코드(가명)로 나갑니다.

### AI 오차 보정 사용 순서
1. **같은 날 두 가지로 측정합니다.** 참여자가 앱으로 측정하고, 전문가가 표준 NDT(자로 발배뼈거친면 높이 측정)로도 잽니다.
2. **기준값을 입력합니다.** 관리자 앱 → 사용자·측정 → 해당 측정에 임상 NDT(mm)와 측정자를 입력합니다.
3. **학습합니다.** 관리자 앱 → AI 보정 모델 → 학습하기. 짝 자료 16건 이상, 참여자 8명 이상이 필요합니다.
4. **교차검증에서 개선이 확인되면 배포합니다.** 사용자 앱 결과에 "AI 보정 (임상 NDT 추정)"이 앱 측정값과 함께 표시됩니다. 앱 측정값과 분류는 그대로입니다.
5. **문제가 있으면 "배포 중지"를 누릅니다.** 사용자 앱이 바로 앱 측정값만 쓰게 됩니다.

## 6. 운동(중재) 영상 올리기

1. Supabase → **SQL Editor** → New query에 `supabase/content.sql` 내용을 전부 붙여 넣고 **Run** (운동 표와 영상 저장소 `exercise-videos`가 만들어집니다. 한 번만).
2. 관리자 앱(`…/admin/`) → 위쪽 **운동 영상** → 처음이면 **기본 운동 3개 불러오기**.
3. 운동 **편집** → **영상 파일 선택(mp4·mov)** 또는 유튜브 링크 입력 → 보여 줄 분류(정상·경증·중등도·중증) 체크 → **저장**.
4. 사용자 앱의 ‘발활 재활영상’과, 그 분류로 측정된 사용자의 결과 화면 ‘운동 중재’에 바로 나타납니다.

- 영상 파일은 하나에 **최대 50 MB**(Supabase 무료 요금제 한도). 휴대폰으로 찍은 영상은 사진 앱 편집에서 해상도를 낮추거나(720p 권장) 압축해서 올리세요. 큰 영상은 유튜브(일부 공개)에 올리고 링크를 넣어도 됩니다.
- 영상 저장소는 **공개 읽기**입니다(주소를 아는 사람은 볼 수 있음). 개인 정보가 담긴 영상은 올리지 마세요.
- 올리기·고치기·지우기는 서버가 관리자(`admins` 표)만 허용합니다.

## 개인정보 관련 체크리스트
- 회원가입 시 [필수] 개인정보 수집·이용 동의와 [필수] 민감정보(건강 관련) 처리 동의를 따로 받습니다. [선택] 연구 활용 동의도 받습니다. 동의 시각은 `profiles`에 저장됩니다.
- 촬영 사진은 서버에 올리지 않고 측정 좌표·값만 동기화합니다.
- 회원 탈퇴 시 계정과 모든 기록이 서버에서 삭제됩니다(on delete cascade).
- 연구 데이터로 쓰려면 기관 IRB 승인과 개인정보 처리방침 게시가 별도로 필요합니다.
