package com.jarvis.agent.service

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.AlarmClock
import android.provider.Settings
import android.telephony.SmsManager
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.data.JarvisLogStore
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

class DeviceActionExecutor(private val context: Context) {

    companion object {
        private const val ALERT_CHANNEL = "jarvis_alerts"
    }

    suspend fun executeActions(actions: JSONArray, speakResult: Boolean = false): Pair<String, JSONArray> {
        val resultActions = JSONArray()
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val isLocked = keyguard.isKeyguardLocked
        var blocked = 0
        var executed = 0
        var lastLabel = ""
        var spokeExplicitly = false

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
            if (ok) {
                executed++
                lastLabel = action.optString("label", type)
                if (type == "speak_tts") spokeExplicitly = true
            } else {
                blocked++
            }
            resultActions.put(action)
        }

        val config = JarvisConfig(context)
        if ((speakResult || config.voiceFeedback) && !spokeExplicitly && executed > 0 && lastLabel.isNotBlank()) {
            JarvisVoiceEngine.speak(context, "Done, sir. $lastLabel")
        }

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
                    acc.sendWhatsAppMessage(recipient, msg)
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
                "set_flashlight" -> setFlashlight(action.optBoolean("enabled", true))
                "set_volume" -> setVolume(
                    action.optInt("level", 60),
                    action.optString("mode", "level")
                )
                "media_control" -> dispatchMediaKey(action.optString("command", "play_pause"))
                "speak_tts" -> {
                    val text = action.optString("text", action.optString("message", ""))
                    JarvisVoiceEngine.speak(context, text)
                    true
                }
                "ring_phone" -> ringPhone(action.optString("message", "Jarvis is locating your phone"))
                "take_screenshot" -> JarvisAccessibilityService.instance?.takeScreenshotAction() ?: false
                "set_alarm" -> setAlarm(
                    action.optString("time", "06:30"),
                    action.optString("alarmLabel", "Jarvis Alarm")
                )
                "set_timer" -> setTimer(
                    action.optInt("seconds", 60),
                    action.optString("timerLabel", "Jarvis Timer")
                )
                "open_url" -> openUrl(action.optString("url", ""))
                "navigate_maps" -> openUrl("google.navigation:q=${Uri.encode(action.optString("destination", ""))}")
                "play_youtube" -> openUrl("https://www.youtube.com/results?search_query=${Uri.encode(action.optString("query", ""))}")
                "copy_clipboard" -> copyClipboard(action.optString("text", ""))
                "ui_tap" -> JarvisAccessibilityService.instance?.clickNodeByText(action.optString("target", "")) ?: false
                "ui_scroll" -> JarvisAccessibilityService.instance?.scroll(action.optString("direction", "down") != "up") ?: false
                "open_quick_settings" -> JarvisAccessibilityService.instance?.openQuickSettings() ?: false
                "open_notifications" -> JarvisAccessibilityService.instance?.openNotificationsShade() ?: false
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
            "whatsapp business" -> "com.whatsapp.w4b"
            "spotify" -> "com.spotify.music"
            "youtube" -> "com.google.android.youtube"
            "maps", "google maps" -> "com.google.android.apps.maps"
            "gmail" -> "com.google.android.gm"
            "chrome" -> "com.android.chrome"
            "instagram" -> "com.instagram.android"
            "telegram" -> "org.telegram.messenger"
            "settings" -> "com.android.settings"
            "clock" -> "com.google.android.deskclock"
            "notion" -> "notion.id"
            else -> null
        }

        val launchIntent = (knownPkg?.let { pm.getLaunchIntentForPackage(it) })
            ?: run {
                val mainIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                val resolved = pm.queryIntentActivities(mainIntent, 0)
                val match = resolved.firstOrNull {
                    it.loadLabel(pm).toString().contains(appName, ignoreCase = true)
                }
                match?.activityInfo?.packageName?.let { pm.getLaunchIntentForPackage(it) }
            }

        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
            JarvisLogStore.append("Opened $appName")
            return true
        }
        JarvisLogStore.append("App not found: $appName")
        return false
    }

    private fun setFlashlight(enabled: Boolean): Boolean {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = cm.cameraIdList.firstOrNull { id ->
            val chars = cm.getCameraCharacteristics(id)
            chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true &&
                chars.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: cm.cameraIdList.firstOrNull() ?: return false

        cm.setTorchMode(cameraId, enabled)
        JarvisLogStore.append("Flashlight ${if (enabled) "ON" else "OFF"}")
        return true
    }

    private fun setVolume(percent: Int, mode: String): Boolean {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        when (mode.lowercase()) {
            "mute" -> {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0)
                if (am.isVolumeFixed.not()) {
                    try { am.ringerMode = AudioManager.RINGER_MODE_SILENT } catch (_: Exception) {}
                }
                JarvisLogStore.append("Audio muted")
                return true
            }
            "vibrate" -> {
                try { am.ringerMode = AudioManager.RINGER_MODE_VIBRATE } catch (_: Exception) {}
                JarvisLogStore.append("Ringer set to vibrate")
                return true
            }
            "unmute", "normal" -> {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0)
                try { am.ringerMode = AudioManager.RINGER_MODE_NORMAL } catch (_: Exception) {}
                JarvisLogStore.append("Audio unmuted")
                return true
            }
            else -> {
                val maxMusic = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                val targetMusic = ((percent.coerceIn(0, 100) / 100.0) * maxMusic).toInt().coerceIn(0, maxMusic)
                am.setStreamVolume(AudioManager.STREAM_MUSIC, targetMusic, 0)
                JarvisLogStore.append("Media volume set to $percent%")
                return true
            }
        }
    }

    private fun dispatchMediaKey(command: String): Boolean {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val keyCode = when (command.lowercase()) {
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous", "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        JarvisLogStore.append("Media control: $command")
        return true
    }

    private suspend fun ringPhone(message: String): Boolean {
        showNotification("J.A.R.V.I.S. Find Phone", message)
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val maxAlarm = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        am.setStreamVolume(AudioManager.STREAM_ALARM, maxAlarm, 0)

        @Suppress("DEPRECATION")
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createOneShot(2500, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(2500)
        }

        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val ringtone = RingtoneManager.getRingtone(context, uri)
        ringtone?.play()
        JarvisLogStore.append("Ringing phone for 4 seconds")
        delay(4000)
        ringtone?.stop()
        return true
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

    private fun setTimer(seconds: Int, label: String): Boolean {
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceAtLeast(1))
            putExtra(AlarmClock.EXTRA_MESSAGE, label)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        JarvisLogStore.append("Set timer for ${seconds}s")
        return true
    }

    private fun openUrl(url: String): Boolean {
        if (url.isBlank()) return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        JarvisLogStore.append("Opened URI: $url")
        return true
    }

    private fun copyClipboard(text: String): Boolean {
        if (text.isBlank()) return false
        Handler(Looper.getMainLooper()).post {
            val cb = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cb.setPrimaryClip(ClipData.newPlainText("Jarvis", text))
        }
        JarvisLogStore.append("Copied to clipboard")
        return true
    }

    private fun sendSms(recipient: String, message: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            JarvisLogStore.append("Missing SEND_SMS permission")
            return false
        }
        val smsManager = context.getSystemService(SmsManager::class.java)
        smsManager.sendTextMessage(recipient, null, message, null, null)
        JarvisLogStore.append("Sent SMS to $recipient")
        return true
    }

    private fun makeCall(recipient: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.CALL_PHONE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            JarvisLogStore.append("Missing CALL_PHONE permission")
            return false
        }
        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$recipient")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        JarvisLogStore.append("Calling $recipient")
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
