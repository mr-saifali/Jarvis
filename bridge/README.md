# 5-Minute Termux / MacroDroid Bridge

Test your J.A.R.V.I.S. Brain with your real Android phone in under 5 minutes without building the APK first.

## Option 1: Termux Bridge (`termux-jarvis-bridge.sh`)
1. Install **Termux** and **Termux:API** on your Android phone.
2. Copy `termux-jarvis-bridge.sh` to your phone and export your Brain URL & Pairing Token:
   ```bash
   export JARVIS_URL="https://<your-vercel-domain>"
   export JARVIS_TOKEN="jarvis-d4d0cd67"
   bash termux-jarvis-bridge.sh
   ```

## Option 2: MacroDroid Webhooks
1. Create a MacroDroid **Trigger**: Regular Interval (e.g., every 1 minute) or Notification Received.
2. Add **HTTP Request (POST)** action to `https://<your-vercel-domain>/api/devices/heartbeat`:
   - Header: `Content-Type: application/json`
   - Header: `X-Jarvis-Token: jarvis-d4d0cd67`
   - Body:
     ```json
     {
       "deviceId": "macrodroid-phone",
       "name": "My Android (MacroDroid)",
       "telemetry": {
         "battery": {battery},
         "wifi": "{ssid}"
       }
     }
     ```
3. Parse the returned `commands` array and run MacroDroid actions for `set_dnd`, `set_brightness`, `open_app`, or `notify`, then POST completion to `/api/commands/ack`.
