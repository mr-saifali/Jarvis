package com.jarvis.agent.service

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.Settings
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.jarvis.agent.data.JarvisLogStore
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

class DeviceActionExecutor(private val context: Context) {

    companion object {
        private const val ALERT_CHANNEL = "jarvis_alerts"
    }

    suspend fun executeActions(actions: JSONArray): Pair<String, JSONArray> {
        val resultActions = JSONArray()
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val isLocked = keyguard.isKeyguardLocked
        var blocked = 0
        var executed = 0

        for (i in 0 until actions.length()) {
            val action = JSONObject(actions.getJSONObject(i).toString())
            val type = action.optString("type", "")
            val requiresUnlock = action.optBoolean("requiresUnlock", false)

            if (isLocked && requiresUnlock) {
                blocked++
                action.put("status", "blocked")
                action.put("detail", "Device locked — UI action paused")
                resultActions.put(action)
                continue
            }

            val ok = executeSingle(type, action)
            action.put("status", if (ok) "done" else "failed")
            if (ok) executed++ else blocked++
            resultActions.put(action)
        }

        val summary = "Executed $executed step(s)" + if (blocked > 0) ", $blocked skipped/blocked" else ""
        val status = if (executed == 0 && blocked > 0) "failed" else "completed"
        return status to resultActions
    }

    private suspend fun executeSingle(type: String, action: JSONObject): Boolean {
        return try {
            when (type) {
                "open_app" -> openApp(action.optString("app", ""))
                "send_message" -> {
                    val recipient = action.optString("recipient", "")
                    val msg = action.optString("message", "")
                    val acc = JarvisAccessibilityService.instance ?: return false
                    if (recipient.isNotBlank()) {
                        acc.clickNodeByText(recipient)
                        delay(700)
                    }
                    acc.typeTextIntoFocusedOrEditable(msg)
                    delay(400)
                    acc.clickNodeByText("Send")
                    true
                }
                "reply_notification" -> {
                    JarvisNotificationService.sendQuickReply(
                        action.optString("app", "WhatsApp"),
                        action.optString("sender", ""),
                        action.optString("message", "")
                    )
                }
                "set_dnd" -> setDnd(action.optBoolean("enabled", true))
                "set_brightness" -> setBrightness(action.optInt("level", 50))
                "set_alarm" -> setAlarm(action.optString("time", "06:30"), action.optString("alarmLabel", "Jarvis Alarm"))
                "send_sms" -> sendSms(action.optString("recipient", ""), action.optString("message", ""))
                "make_call" -> makeCall(action.optString("recipient", ""))
                "notify" -> showNotification(action.optString("title", "J.A.R.V.I.S."), action.optString("message", ""))
                "lock_screen" -> JarvisAccessibilityService.instance?.lockScreen() ?: false
                "navigate_home" -> JarvisAccessibilityService.instance?.goHome() ?: false
                "navigate_back" -> JarvisAccessibilityService.instance?.goBack() ?: false
                else -> {
                    JarvisLogStore.append("Handled cloud/noop step: $type")
                    true
                }
            }
        } catch (e: Exception) {
            JarvisLogStore.append("Action $type failed: ${e.message}")
            false
        }
    }

    private fun openApp(appName: String): Boolean {
        val pm = context.packageManager
        val knownPkg = when (appName.lowercase()) {
            "whatsapp" -> "com.whatsapp"
            "spotify" -> "com.spotify.music"
            "gmail" -> "com.google.android.gm"
            "settings" -> "com.android.settings"
            "clock" -> "com.google.android.deskclock"
            "notion" -> "notion.id"
            else -> null
        }

        val launchIntent = (knownPkg?.let { pm.getLaunchIntentForPackage(it) })
            ?: pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .firstOrNull {
                    pm.getApplicationLabel(it).toString().contains(appName, ignoreCase = true)
                }?.let { pm.getLaunchIntentForPackage(it.packageName) }

        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
            JarvisLogStore.append("Opened $appName")
            return true
        }
        return false
    }

    private fun setDnd(enabled: Boolean): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.isNotificationPolicyAccessGranted) return false
        nm.setInterruptionFilter(
            if (enabled) NotificationManager.INTERRUPTION_FILTER_PRIORITY
            else NotificationManager.INTERRUPTION_FILTER_ALL
        )
        JarvisLogStore.append("DND set to $enabled")
        return true
    }

    private fun setBrightness(percent: Int): Boolean {
        if (!Settings.System.canWrite(context)) return false
        val value = ((percent.coerceIn(5, 100) / 100.0) * 255).toInt().coerceIn(10, 255)
        Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, value)
        JarvisLogStore.append("Brightness set to $percent%")
        return true
    }

    private fun setAlarm(time: String, label: String): Boolean {
        val parts = time.split(":")
        val hour = parts.getOrNull(0)?.toIntOrNull() ?: 6
        val min = parts.getOrNull(1)?.toIntOrNull() ?: 30
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, min)
            putExtra(AlarmClock.EXTRA_MESSAGE, label)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        JarvisLogStore.append("Set alarm for $time")
        return true
    }

    private fun sendSms(recipient: String, message: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) return false
        val smsManager = context.getSystemService(SmsManager::class.java)
        smsManager.sendTextMessage(recipient, null, message, null, null)
        JarvisLogStore.append("Sent SMS to $recipient")
        return true
    }

    private fun makeCall(recipient: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CALL_PHONE)
            != PackageManager.PERMISSION_GRANTED
        ) return false
        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$recipient")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        return true
    }

    private fun showNotification(title: String, message: String): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(ALERT_CHANNEL, "Jarvis Alerts", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val notif = NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .build()
        nm.notify(System.currentTimeMillis().toInt(), notif)
        return true
    }
}
