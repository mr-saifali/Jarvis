#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

JARVIS_URL="${JARVIS_URL:-http://127.0.0.1:3000}"
JARVIS_TOKEN="${JARVIS_TOKEN:-jarvis-d4d0cd67}"
DEVICE_ID="${JARVIS_DEVICE_ID:-termux-android}"
DEVICE_NAME="${JARVIS_DEVICE_NAME:-Termux Android}"

echo "Registering $DEVICE_NAME with $JARVIS_URL..."
curl -sS -X POST "$JARVIS_URL/api/devices/register" \
  -H "Content-Type: application/json" \
  -H "X-Jarvis-Token: $JARVIS_TOKEN" \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"name\":\"$DEVICE_NAME\",\"model\":\"Termux Bridge\",\"telemetry\":{\"battery\":85,\"wifi\":\"Mobile\"}}"
echo ""

while true; do
  BAT=$(termux-battery-status 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')||'{}');console.log(d.percentage||85)" 2>/dev/null || echo "85")
  RESP=$(curl -sS -X POST "$JARVIS_URL/api/devices/heartbeat" \
    -H "Content-Type: application/json" \
    -H "X-Jarvis-Token: $JARVIS_TOKEN" \
    -d "{\"deviceId\":\"$DEVICE_ID\",\"name\":\"$DEVICE_NAME\",\"telemetry\":{\"battery\":$BAT}}")

  echo "[$(date +%H:%M:%S)] Heartbeat OK: $RESP"
  sleep 10
done
