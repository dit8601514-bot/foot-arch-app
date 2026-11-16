-- AI Footarch 고정촬영판: 1분마다 발송 함수 실행(정해진 요일·시간이 된 환자에게만 보냄, 같은 날 같은 시간은 한 번만)
-- 먼저 Edge Function 'send-reminders'를 배포한 뒤 실행. 여러 번 실행해도 안전.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('footarch-reminders') where exists (select 1 from cron.job where jobname = 'footarch-reminders');
select cron.schedule('footarch-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://dwgwojexnerqyilngkuy.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"run":true}'::jsonb,
    timeout_milliseconds := 20000);
$$);
