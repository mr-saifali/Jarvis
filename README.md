# J.A.R.V.I.S. — Android AI Agent & Background Automation System

A complete **Hybrid Architecture** that connects your Android phone to an AI command & scheduling brain:
- **Voice & Natural Language Commands** ("Open WhatsApp and message Mom...", "Turn on DND and set brightness to 25%")
- **Background Schedules** (Cron expressions like `Every weekday at 8:30 AM...`, intervals, or one-shot timers)
- **Event-Driven Automation Rules** ("When battery < 20%...", "When I receive a WhatsApp from Mom...")
- **Cloud Workflows** (Summarize notifications and save notes in the Jarvis vault)

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
export JARVIS_OPERATOR_TOKEN=$(openssl rand -hex 32)  # enter this in the dashboard
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
1. After tests pass on `main`, the configured release job builds and verifies the signed APK.
2. Download the compiled `jarvis-agent-apk` artifact and sideload `app-release.apk` on your phone.

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
| Cloud tasks (Jarvis vault and summaries) | ✅ Yes (even when screen is locked) | Destination labels are internal vault entries, not uploads to Notion or Drive. |
| Interact with UI while PIN-locked | ❌ Blocked by Android OS | Background/cloud/SMS/notification-reply still run; UI taps require unlock. |
| Read Banking / DRM screens | ❌ Blocked (`FLAG_SECURE`) | Android security enforces black frames on banking apps. |
| Toggle Wi-Fi / Mobile Data directly | ⚠️ Restricted on Android 10+ | Use Accessibility on Quick Settings or add **Shizuku** (non-root ADB bridge). |

### Deployment and migration checklist
- Set `JARVIS_OPERATOR_TOKEN` to a unique random secret; the dashboard holds it only in memory. Serve over HTTPS. Local JSON storage is for one Node process only; use Supabase service-role access for serverless deployments.
- For each phone, read its ID in the app, generate a separate token (`openssl rand -hex 32`), and configure `JARVIS_DEVICE_TOKENS` on the server as a JSON object mapping IDs to those tokens. Redeploy after changes. Enter the HTTPS Brain URL and matching token on the phone. Remove a mapping to revoke it. Old shared tokens are no longer accepted.
- Configure `CRON_SECRET` and install the durable minute trigger in `supabase/schedule.sql` (Vault + Cron + pg_net), or use an external scheduler to call `/api/cron/tick` with `Authorization: Bearer <CRON_SECRET>`. Missed cron minutes expire; overdue one-shot/interval tasks run once on recovery. Occurrences and phone commands are claimed before side effects: after a crash during execution, inspect the result before manually retrying. Sensitive automation runs require individual approval.
- Android: JDK 17 and Android SDK 35; `cd android && ./gradlew testDebugUnitTest assembleDebug`. CI builds debug on PRs. Main publishes the verified release only after tests pass. Configure required reviewers on the `android-release` environment and supply **new** PKCS12 signing material via `JARVIS_KEYSTORE_BASE64`, `JARVIS_STORE_PASSWORD`, `JARVIS_KEY_ALIAS`, `JARVIS_KEY_PASSWORD`. The historical key is compromised: withdraw APKs signed by it and distribute the new certificate fingerprint independently. Without a trusted signing lineage users must uninstall the old app, reinstall, and re-pair; uninstall clears app data.

### Hindi/Hinglish shortcuts (no LLM key required)

| Try this command | Result |
| --- | --- |
| `WhatsApp kholo`, `DND chalu karo`, `brightness 30% karo` | Open the app, enable Do Not Disturb, or change brightness using the existing Android permissions. |
| `Kal subah 8 baje yaad dilana: dawa leni hai` or `कल सुबह ८ बजे याद दिलाना: दवा लेनी है` | Create a one-time reminder for tomorrow at 8 in the Brain’s configured timezone. `Aaj`, `shaam`, `raat` and `HH:MM` also work. |
| `Aaj ki briefing` or `Daily briefing` | See the selected phone’s reported battery, recent unread notifications and enabled schedules for today. |
| `Save routine Study mode: DND chalu karo; brightness 30% karo` | Save two ordered steps from the operator dashboard; use `Study mode` or `Run Study mode` from the dashboard or paired phone. Re-save the same name to replace it. Sensitive actions still require approval. |

For a hosted Brain, reapply `supabase/schema.sql` to add routine storage and configure the scheduler described above. For notifications, select a paired phone, install the updated Android app, allow notifications, and keep the bridge connected. **Snooze 10 min** reschedules locally with WorkManager (Android may delay delivery); **Complete** dismisses that occurrence. These buttons are not shown by the browser simulator.

### Personal Desk (Android, local only)
Open **Personal Desk** rather than the networked Voice & Command HUD. Type `yaad rakho: bike basement B2` and later `find bike`; `list` shows IDs and `forget #1` deletes an entry. Add estimated tasks with `task 10: revise notes` or `task! 15: pay bill` (important). `mere paas 25 min hain` chooses a combination within the budget, maximizing important tasks first, then task count, then time used. `done #2` removes a completed task; generating a plan alone never executes or completes anything.

Desk commands do not call the Brain, LLM, or Jarvis log. The desk uses device-local AES-GCM encryption with an Android Keystore key and needs no pairing or internet. It is not a password manager or a biometric lock: anyone using your unlocked app can open it. Clearing app data or uninstalling loses the desk.

**Notes, docs & messages** in the Android app is a local draft editor. Type a note or start with the meeting-notes template. Export plain text or a Word `.docx` using Android's file picker, or share the draft **as text** to the standard WhatsApp or Telegram app. Pick the recipient and confirm Send there. No Brain connection is required to draft or export. This editor does not generate prose from a topic or create a cloud Google Doc.

**Command from another app:** On a paired Android phone with notification permission and the foreground bridge active, expand the **J.A.R.V.I.S. command bar**, tap **Ask Jarvis**, and type a Brain command. A briefing can return in the notification itself. This is explicit input, not always-on microphone monitoring. Sensitive commands still require dashboard approval. The bar is hidden on the lock screen; on a secured phone use Android's PIN/pattern/biometrics first. Device operations that need another app's UI can interrupt the foreground app and cannot be promised to run invisibly.

**Share → Jarvis · Iska kaam bana** accepts plain text from another app, or paste it into the follow-up screen. The on-device Hindi/Hinglish/English keyword parser suggests editable checklists, local reminders and confirmation drafts; it does not send source text to the Brain. Select only the suggestions you want. Check actual dates, resolve missing times in 24-hour format, then approve. WorkManager reminders are approximate and require notifications. Open **Kya baaki hai?** to review outstanding items. Sharing a draft opens the system chooser, not a delivery receipt. Only mark it handled after you verify it yourself. Approved excerpts are saved in app-private SQLite (not the encrypted Personal Desk); uninstalling clears them.

**Ask Jarvis from Quick Settings (Android 7+):** After pairing, swipe down twice, edit the tiles and drag **Ask Jarvis** into the active area. From another app, pull down Quick Settings, tap the tile, type a command (or **Dictate** with your system speech recognizer), review and tap **Send**. Close the small panel to return to the previous app. This shortcut does not require overlay permission or an active bridge notification. Sending requires a reachable Brain; queued device actions still need the bridge and relevant permissions. A secured phone must unlock first. Dictation availability and processing depend on the installed recognizer.

**System assistant gesture:** In Jarvis → Setup → Assistant shortcut, choose Jarvis in Android’s default assistant picker. This replaces the current default assistant until you change it back. On supported unlocked phones the configured assistant gesture (e.g. long-press Home with button navigation) opens the compact Ask Jarvis panel over the current app. Type or dictate, review, then send. Gesture support varies by manufacturer and navigation settings; the Quick Settings tile remains an alternative. This entry point does not read the foreground screen, listen for a wake word, or require draw-over-apps or accessibility access.

**Managed Gemini Flash (optional):** Set `GEMINI_API_KEY` as a sensitive Brain server environment variable and redeploy. This selects `gemini-2.5-flash` (override with `GEMINI_FLASH_MODEL`) instead of the configurable dashboard LLM. Only unrecognized immediate command text is sent to Google for normalization. Known commands remain local to the Brain; translated commands still pass through the deterministic parser and existing approval checks. Provider timeout, quota or parsing errors fall back to deterministic handling. Remove the variable and redeploy to disable this mode. Never put a provider key in the APK or repository.

**Flash multi-task workflows:** With managed Gemini enabled, combine immediate phone settings and actions using `phir`, `aur`, `then`, `and` or semicolons. Example: `DND chalu karo, phir brightness 30% karo aur Spotify kholo`. Flash proposes 2–8 ordered steps, validated before queuing as one command. Supported: DND, flashlight, brightness, volume, timer, app launch and local notification. No arbitrary scripts or generic screen clicks. The updated handset reports each step and skips remaining steps if one fails; earlier effects are not rolled back. Schedules and saved routines retain their own execution paths. Mixed unsupported requests should be sent as individual commands.

**More phone controls:** `Bluetooth settings kholo`, `Open Wi-Fi settings`, `sound settings kholo` and `battery settings kholo` open the corresponding Android screen. They do not change connectivity or battery settings silently. Flash workflows can combine these screens with play/pause/next/previous media controls and clock alarms (`HH:MM` local time), e.g. `Music pause karo, phir subah 6:30 ka alarm lagao`. The phone needs an installed Clock handler for alarms and an active media session for playback controls; Android may restrict launching screens from the background.

**20 opt-in automation recipes (no Gemini key required):** In the dashboard select the phone, then **Automations → Automation library**. Review the trigger and actions and choose Enable or Disable. On the paired phone, type `list automations`, `enable automation charge-ready` or `disable automation charge-ready`. Recipes are bound to the selected device at installation (Auto resolves once). Schedules appear in Tasks and use the configured Brain timezone and scheduler tick. Phone-state recipes use consecutive telemetry samples and fire on entry, not on every heartbeat. Notification keyword recipes depend on notification access, matching app names and notification text; they show local reminders, not automatic messages or payments. Access to DND or system brightness is needed only for recipes changing those settings.
