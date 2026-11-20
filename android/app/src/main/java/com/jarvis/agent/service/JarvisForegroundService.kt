package com.jarvis.agent.service

import android.app.Notification
import android.app.PendingIntent
import androidx.core.app.RemoteInput
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.data.JarvisLogStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

class JarvisForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    companion object {
        private const val CHANNEL_ID = "jarvis_daemon_channel"
        private const val ASK = "com.jarvis.agent.ASK"
        private const val INPUT = "prompt"
        private const val NOTIF_ID = 101

        fun start(context: Context) {
            val intent = Intent(context, JarvisForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        JarvisVoiceEngine.init(applicationContext)
        createNotificationChannel()
        startForeground(NOTIF_ID, commandNotification("Expand and tap Ask Jarvis to give a command"))
    }

    private fun commandNotification(message: String): Notification {
        // Inline replies need a mutable PendingIntent; bind it to this non-exported service.
        val intent = Intent(this, JarvisForegroundService::class.java).setAction(ASK)
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val pending = PendingIntent.getService(this, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
        val action = NotificationCompat.Action.Builder(android.R.drawable.ic_btn_speak_now, "Ask Jarvis", pending)
            .addRemoteInput(RemoteInput.Builder(INPUT).setLabel("Type a command").build())
            .setAuthenticationRequired(true).build()
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("J.A.R.V.I.S. command bar")
            .setContentText(message).setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setVisibility(NotificationCompat.VISIBILITY_SECRET).setOnlyAlertOnce(true)
            .setOngoing(true).addAction(action).build()
    }

    private fun status(message: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, commandNotification(message))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ASK) {
            val input = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(INPUT)?.toString()?.trim().orEmpty()
            val locked = getSystemService(KeyguardManager::class.java).isKeyguardLocked
            when {
                locked -> status("Unlock your phone, then submit again.")
                input.length !in 1..1000 -> status("Enter a command between 1 and 1000 characters.")
                else -> scope.launch {
                    try {
                        val result = JarvisApiClient(JarvisConfig(applicationContext)).sendCommand(input)
                        val cmd = result.optJSONObject("command")
                        status(when (cmd?.optString("status")) {
                            "awaiting_approval" -> "Waiting for approval in the dashboard."
                            "queued" -> "Queued for this phone. Check the command log for completion."
                            else -> result.optString("summary", "Command submitted.").take(500)
                        })
                    } catch (_: Exception) { status("Could not confirm submission. Check connection and command history before retrying.") }
                }
            }
        }
        if (pollJob?.isActive != true) {
            startPolling()
        }
        return START_STICKY
    }

    private fun startPolling() {
        val config = JarvisConfig(applicationContext)
        val client = JarvisApiClient(config)
        val executor = DeviceActionExecutor(applicationContext)

        pollJob = scope.launch {
            JarvisLogStore.append("Foreground bridge online -> ${config.brainUrl}")
            while (isActive) {
                if (config.pairingPaused) { delay(3_000L); continue }
                var sleepMs = 3_000L
                try {
                    val telemetry = collectTelemetry()
                    val caps = collectCapabilities()
                    val commands = client.sendHeartbeat(telemetry, caps)
                    for (cmd in commands) {
                        JarvisLogStore.append("Executing: ${cmd.prompt}")
                        val (status, resultActions) = executor.executeActions(cmd.actions, config.voiceFeedback)
                        client.ackCommand(cmd.id, status, "Executed on Android device", resultActions)
                    }
                } catch (_: com.jarvis.agent.data.PairingRequired) {
                    status("Pairing required. Open Setup and tap Save & Connect.")
                } catch (e: Exception) {
                    JarvisLogStore.append("Heartbeat error: ${e.message}")
                    sleepMs = 8_000L
                }
                delay(sleepMs)
            }
        }
    }

    private fun collectTelemetry(): JSONObject {
        val batIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: 80
        val scale = batIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = batIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val batteryPct = if (scale > 0) (level * 100) / scale else 80

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val dnd = nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL

        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val brightnessRaw = try {
            Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS)
        } catch (_: Exception) {
            160
        }

        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        val volumePct = ((curVol * 100.0) / maxVol).toInt().coerceIn(0, 100)

        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val networkLabel = when {
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "Wi-Fi"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "Mobile Data"
            else -> "Offline"
        }

        return JSONObject().apply {
            put("battery", batteryPct)
            put("charging", charging)
            put("dnd", dnd)
            put("locked", km.isKeyguardLocked)
            put("brightness", ((brightnessRaw / 255.0) * 100).toInt().coerceIn(5, 100))
            put("volume", volumePct)
            put("wifi", networkLabel)
            if (JarvisAccessibilityService.lastForegroundPackage.isNotBlank()) {
                put("activeApp", JarvisAccessibilityService.lastForegroundPackage.substringAfterLast('.'))
            }
        }
    }

    private fun collectCapabilities(): JSONObject = JSONObject().apply {
        put("accessibility", JarvisAccessibilityService.isReady())
        put("notifications", JarvisNotificationService.isReady())
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        put("dnd", nm.isNotificationPolicyAccessGranted)
        put("brightness", Settings.System.canWrite(applicationContext))
        put("tts", true)
        put("flashlight", true)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Jarvis Background Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
