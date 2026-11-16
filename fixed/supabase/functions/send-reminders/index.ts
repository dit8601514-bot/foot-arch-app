// AI Footarch 고정촬영판 — 운동 알람 발송 함수(Supabase Edge Function, 이름: send-reminders)
// · ?vapid=1         → 앱이 쓸 공개 키(VAPID public key) 돌려줌(처음 실행 때 키를 만들어 push_config에 보관)
// · POST {run:true}  → 지금 시간이 된 알람을 보냄(pg_cron이 1분마다 부름). 같은 날·같은 시간은 한 번만
// · POST {test:true} + 로그인 토큰 → 그 사람 기기로 시험 알림
// 설정: 함수 설정에서 'Verify JWT' 끔(cron·공개 키 요청용). 보내는 일은 정해진 시간에만 하므로 누가 불러도 안전.
// 비밀 키는 코드·저장소에 없음: 함수가 직접 만들고 서버 표(push_config, 정책 없음)에만 보관.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const APP = "https://dit8601514-bot.github.io/foot-arch-app/fixed/";

async function keys() {
  const { data } = await sb.from("push_config").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_config").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  const { data: d2 } = await sb.from("push_config").select("public_key, private_key").eq("id", 1).single(); // 동시에 만들어진 경우 먼저 저장된 키 사용
  return d2!;
}
function localNow(tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  catch { return localNow("Asia/Seoul"); }
  const g = (t: string) => parts.find(p => p.type === t)!.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date: `${g("year")}-${g("month")}-${g("day")}`, wd, min: (+g("hour") % 24) * 60 + +g("minute") };
}
async function sendTo(userId: string, payload: unknown) {
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, sub").eq("user_id", userId);
  let ok = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600 }); ok++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
  }
  return { ok, total: (subs || []).length };
}
const MSG = { title: "발 운동 시간이에요", body: "오늘의 중재 운동(짧은 발 운동·수건 당기기·발가락 벌리기)을 해 주세요.", url: APP + "#/exercises", tag: "footarch-exercise" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const k = await keys();
    const url = new URL(req.url);
    if (url.searchParams.has("vapid")) return json({ publicKey: k.public_key });
    webpush.setVapidDetails(APP, k.public_key, k.private_key);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.test) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      if (!u || !u.user) return json({ error: "로그인이 필요합니다." }, 401);
      const r = await sendTo(u.user.id, { ...MSG, title: "알림 시험", body: "운동 알람이 이렇게 옵니다.", tag: "footarch-test" });
      return json(r);
    }
    // 정해진 시간이 된 알람 보내기: 정한 시각부터 10분 안, 같은 날·같은 시각 한 번만
    const { data: rems } = await sb.from("reminders").select("*").eq("enabled", true);
    let sent = 0;
    for (const r of rems || []) {
      const now = localNow(r.tz || "Asia/Seoul");
      if (!(r.days || []).includes(now.wd)) continue;
      const last = { ...(r.last_sent || {}) }; let changed = false;
      for (const t of r.times || []) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(t); if (!m) continue;
        const d = now.min - (+m[1] * 60 + +m[2]);
        if (d < 0 || d >= 10 || last[t] === now.date) continue;
        last[t] = now.date; changed = true;
        const res = await sendTo(r.user_id, MSG); sent += res.ok;
      }
      if (changed) await sb.from("reminders").update({ last_sent: last }).eq("user_id", r.user_id);
    }
    return json({ ok: true, checked: (rems || []).length, sent });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
