// AI Footarch 서버 설정 — Supabase 프로젝트의 Project URL과 anon(public) key를 넣으세요.
// anon key는 공개용 키이며, 데이터 보호는 supabase/schema.sql의 행 수준 보안(RLS)이 담당합니다.
// 비워 두면 로그인 없이 이 기기에만 저장하는 모드로 동작합니다.
window.FOOTARCH_CONFIG = Object.assign({
  supabaseUrl: '',
  supabaseAnonKey: '',
  emailDomain: 'users.footarch.app'
}, window.FOOTARCH_CONFIG || {});
