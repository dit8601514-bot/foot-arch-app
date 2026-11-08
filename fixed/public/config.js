// AI Footarch 고정촬영판 서버 설정 — 기존 앱과 서버 분리(비워 둠 = 이 기기에만 저장). 새 Supabase 프로젝트를 만들면 여기에 넣으세요.
// (아래는 기존 안내) — Supabase 프로젝트의 주소(Project URL)와 공개 키를 넣으세요.
// 공개 키: 새 프로젝트는 Publishable key(sb_publishable_…), 예전 프로젝트는 anon key(eyJ…) — 둘 다 됩니다.
// 공개 키는 앱에 드러나도 되는 키입니다. 데이터 보호는 supabase/schema.sql·admin.sql의 행 수준 보안(RLS)이 담당합니다.
// Secret key(sb_secret_…)나 service_role 키는 절대 넣지 마세요.
// 비워 두면 로그인 없이 이 기기에만 저장하는 모드로 동작합니다.
window.FOOTARCH_CONFIG = Object.assign({
  supabaseUrl: '',
  supabaseAnonKey: '',
  emailDomain: 'users.footarch.app'
}, window.FOOTARCH_CONFIG || {});
