-- Optional: run after provisioning the Brain. Enable Cron (pg_cron), pg_net
-- and Vault first. In Vault create jarvis_brain_url (HTTPS origin, no
-- trailing slash) and jarvis_cron_secret (same as the Brain's CRON_SECRET).
-- Named schedule is updated on re-run. Inspect cron.job_run_details and
-- net._http_response for scheduling and delivery errors respectively.
select cron.schedule('jarvis-minute-tick', '* * * * *', $$
  select net.http_post(
    url := origin.decrypted_secret || '/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token.decrypted_secret),
    body := '{}'::jsonb
  )
  from vault.decrypted_secrets origin, vault.decrypted_secrets token
  where origin.name = 'jarvis_brain_url' and token.name = 'jarvis_cron_secret';
$$);
