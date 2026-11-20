-- J.A.R.V.I.S. Cloud Brain Schema (Supabase / PostgreSQL)
-- Matches live migration `init_jarvis_schema` on project `jarvis-brain` (flplfxxhtzgiwucltzmr)

CREATE TABLE IF NOT EXISTS public.jarvis_settings (
  id text PRIMARY KEY DEFAULT 'default',
  pairing_token text NOT NULL,
  confirm_sensitive_actions boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  llm_config jsonb NOT NULL DEFAULT '{"model": "gpt-4o-mini", "apiKey": "", "baseUrl": "https://api.openai.com/v1/chat/completions", "enabled": false, "provider": "openai-compatible"}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jarvis_devices (
  id text PRIMARY KEY,
  name text NOT NULL,
  model text,
  type text NOT NULL DEFAULT 'android',
  online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz DEFAULT now(),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  telemetry jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jarvis_commands (
  id text PRIMARY KEY,
  prompt text NOT NULL,
  summary text,
  source text NOT NULL DEFAULT 'user',
  device_id text,
  device_name text,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  result_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_commands_device_status
  ON public.jarvis_commands (device_id, status);

CREATE TABLE IF NOT EXISTS public.jarvis_scheduled_tasks (
  id text PRIMARY KEY,
  name text NOT NULL,
  prompt text NOT NULL,
  schedule_type text NOT NULL,
  cron_expr text,
  interval_seconds integer,
  run_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  target_device_id text NOT NULL DEFAULT 'auto',
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_run_at timestamptz,
  last_run_minute_key text,
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_tasks_enabled
  ON public.jarvis_scheduled_tasks (enabled);

CREATE TABLE IF NOT EXISTS public.jarvis_event_rules (
  id text PRIMARY KEY,
  name text NOT NULL,
  prompt text NOT NULL,
  event_type text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  cooldown_seconds integer NOT NULL DEFAULT 60,
  target_device_id text NOT NULL DEFAULT 'auto',
  last_triggered_at timestamptz,
  hit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_rules_event
  ON public.jarvis_event_rules (event_type, enabled);

CREATE TABLE IF NOT EXISTS public.jarvis_notifications (
  id text PRIMARY KEY,
  device_id text,
  app text NOT NULL,
  sender text,
  text text,
  read boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jarvis_cloud_vault (
  id text PRIMARY KEY,
  destination text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jarvis_logs (
  id text PRIMARY KEY,
  level text NOT NULL DEFAULT 'info',
  source text NOT NULL DEFAULT 'brain',
  message text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security (Brain accesses via SUPABASE_SERVICE_ROLE_KEY)
ALTER TABLE public.jarvis_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_event_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_cloud_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_logs ENABLE ROW LEVEL SECURITY;

-- Initial Seed
INSERT INTO public.jarvis_settings (id, pairing_token, confirm_sensitive_actions, timezone)
VALUES ('default', '', true, 'Asia/Kolkata')
ON CONFLICT (id) DO NOTHING;
