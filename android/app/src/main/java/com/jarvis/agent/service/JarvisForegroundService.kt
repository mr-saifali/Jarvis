package com.jarvis.agent.service

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
        createNotificationChannel()
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Jarvis Agent Active")
            .setContentText("Connected to Jarvis Brain & listening for commands")
            .setOngoing(true)
            .build()
        startForeground(NOTIF_ID, notif)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
            JarvisLogStore.append("Foreground bridge started -> ${config.brainUrl}")
            while (isActive) {
                try {
                    val telemetry = collectTelemetry()
                    val caps = collectCapabilities()
                    val commands = client.sendHeartbeat(telemetry, caps)
                    for (cmd in commands) {
                        JarvisLogStore.append("Executing command: ${cmd.prompt}")
                        val (status, resultActions) = executor.executeActions(cmd.actions)
                        client.ackCommand(cmd.id, status, "Handled on Android device", resultActions)
                    }
                } catch (e: Exception) {
                    JarvisLogStore.append("Heartbeat error: ${e.message}")
                }
                delay(8_000)
            }
        }
    }

    private fun collectTelemetry(): JSONObject {
        val batIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: 80
        val scale = batIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val batteryPct = if (scale > 0) (level * 100) / scale else 80

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val dnd = nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL

        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val brightnessRaw = try {
            Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS)
        } catch (_: Exception) {
            160
        }

        return JSONObject().apply {
            put("battery", batteryPct)
            put("dnd", dnd)
            put("locked", km.isKeyguardLocked)
            put("brightness", ((brightnessRaw / 255.0) * 100).toInt().coerceIn(5, 100))
        }
    }

    private fun collectCapabilities(): JSONObject = JSONObject().apply {
        put("accessibility", JarvisAccessibilityService.isReady())
        put("notifications", JarvisNotificationService.isReady())
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        put("dnd", nm.isNotificationPolicyAccessGranted)
        put("brightness", Settings.System.canWrite(applicationContext))
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
