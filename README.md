# J.A.R.V.I.S. — Android AI Agent & Background Automation System

A complete **Hybrid Architecture** that connects your Android phone to an AI command & scheduling brain:
- **Voice & Natural Language Commands** ("Open WhatsApp and message Mom...", "Turn on DND and set brightness to 25%")
- **Background Schedules** (Cron expressions like `Every weekday at 8:30 AM...`, intervals, or one-shot timers)
- **Event-Driven Automation Rules** ("When battery < 20%...", "When I receive a WhatsApp from Mom...")
- **Cloud Workflows** (Summarize notifications & notes to Notion / Google Drive vault)

---

## Project Structure

```
Jarvis/
├── brain/        # Node.js 20+ Control Center, Scheduler, Planner, Vercel API & Phone Simulator
├── android/      # Native Kotlin + Jetpack Compose Android Agent App (APK project)
├── bridge/       # 5-minute Termux / MacroDroid bridge guide (test before building APK)
├── supabase/     # Postgres schema for cloud deployment
└── .github/      # GitHub Actions CI workflow to build debug APK automatically
```

---

## 1. Run the Jarvis Brain & Control Center Locally

```bash
cd brain
npm test   # Run automated unit + API tests
npm start  # Starts server on http://0.0.0.0:3000
```

Open the dashboard to test:
- Natural language & browser voice commands
- Interactive **Android Phone Simulator** (including lock-screen safety behavior, low-battery triggers, and simulated WhatsApp notifications)
- Background Cron / Interval / One-shot task scheduling
- Optional live LLM reasoning (OpenAI / Gemini / OpenRouter / Groq compatible) in **Brain Settings**

---

## 2. Cloud Deployment (Supabase + Vercel)

1. **Supabase**: Run `supabase/schema.sql` in your Supabase SQL Editor (already provisioned on `jarvis-brain` with 8 RLS-enabled tables).
2. **Vercel**: Set Root Directory to `brain` and configure:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Verify `GET /api/health` returns `{"ok":true,"service":"jarvis-brain","supabase":true,...}`.

---

## 3. Build & Install the Native Android App (`android/`)

### Option A: Android Studio
1. Open `android/` in Android Studio.
2. Build & install on your Android phone via USB/Wireless Debugging (`Build > Build APK(s)`).

### Option B: Automatic Cloud Build via GitHub Actions
1. Push to GitHub (`main` or trigger `.github/workflows/build-apk.yml` in the **Actions** tab).
2. Download the compiled `jarvis-agent-debug-apk` artifact and sideload `app-debug.apk` on your phone.

### Permissions to Enable on Phone
1. **Accessibility Service** (`Jarvis Agent`) — lets Jarvis read UI elements and tap/type inside third-party apps.
2. **Notification Listener** — lets Jarvis read incoming notifications and send background quick-replies.
3. **Unrestricted Battery Usage** — stops Android OEM battery killers (Samsung/Xiaomi/OnePlus) from sleeping the background daemon.
4. **Do Not Disturb & Modify System Settings** — for DND and brightness control.

---

## 4. What Stock Android Allows vs. Restricts

| Capability | Stock Android (No Root) | Notes / Workaround |
|---|---|---|
| Open apps, tap UI, scroll, type text | ✅ Yes (`AccessibilityService`) | Sideload your personal APK; Google Play restricts generic Accessibility apps. |
| Read & auto-reply to notifications | ✅ Yes (`NotificationListenerService`) | Works silently in background via `RemoteInput`. |
| Background schedules & triggers | ✅ Yes (`WorkManager` + Foreground Service) | Disable battery optimization for reliable timing. |
| Cloud tasks (Notion, Drive, summaries) | ✅ Yes (even when screen is locked) | Runs on Jarvis Brain 24/7. |
| Interact with UI while PIN-locked | ❌ Blocked by Android OS | Background/cloud/SMS/notification-reply still run; UI taps require unlock. |
| Read Banking / DRM screens | ❌ Blocked (`FLAG_SECURE`) | Android security enforces black frames on banking apps. |
| Toggle Wi-Fi / Mobile Data directly | ⚠️ Restricted on Android 10+ | Use Accessibility on Quick Settings or add **Shizuku** (non-root ADB bridge). |
