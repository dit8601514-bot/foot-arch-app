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
1. **Project Settings → API**에서 다음 두 값을 복사합니다:
   - **Project URL** (예: `https://abcd1234.supabase.co`)
   - **anon public** 키
2. 저장소의 `public/config.js`에 넣고 커밋하면 GitHub Pages에 자동 배포됩니다.

```js
window.FOOTARCH_CONFIG = Object.assign({
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
  emailDomain: 'users.footarch.app'
}, window.FOOTARCH_CONFIG || {});
```

> anon public 키는 앱에 공개되도록 만들어진 키입니다. 데이터 보호는 RLS가 담당합니다.
> **service_role 키는 절대 앱이나 저장소에 넣지 마세요.**

## 개인정보 관련 체크리스트
- 회원가입 시 [필수] 개인정보 수집·이용 동의와 [필수] 민감정보(건강 관련) 처리 동의를 따로 받습니다. [선택] 연구 활용 동의도 받습니다. 동의 시각은 `profiles`에 저장됩니다.
- 촬영 사진은 서버에 올리지 않고 측정 좌표·값만 동기화합니다.
- 회원 탈퇴 시 계정과 모든 기록이 서버에서 삭제됩니다(on delete cascade).
- 연구 데이터로 쓰려면 기관 IRB 승인과 개인정보 처리방침 게시가 별도로 필요합니다.
