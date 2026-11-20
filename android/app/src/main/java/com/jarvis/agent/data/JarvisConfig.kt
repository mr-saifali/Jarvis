package com.jarvis.agent.data

import android.content.Context
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

object JarvisLogStore {
    private val _logs = MutableStateFlow<List<String>>(emptyList())
    val logs: StateFlow<List<String>> = _logs

    fun append(msg: String) {
        val ts = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        val line = "[$ts] $msg"
        _logs.value = (listOf(line) + _logs.value).take(50)
    }
}

class JarvisConfig(context: Context) {
    private val prefs = context.getSharedPreferences("jarvis_agent_prefs", Context.MODE_PRIVATE)

    var brainUrl: String
        get() = prefs.getString("brain_url", "https://jarvis-brain.vercel.app") ?: "https://jarvis-brain.vercel.app"
        set(value) = prefs.edit().putString("brain_url", value.trim().trimEnd('/')).apply()

    var pairingToken: String
        get() = prefs.getString("pairing_token", "jarvis-d4d0cd67") ?: "jarvis-d4d0cd67"
        set(value) = prefs.edit().putString("pairing_token", value.trim()).apply()

    var deviceId: String
        get() {
            val existing = prefs.getString("device_id", null)
            if (!existing.isNullOrBlank()) return existing
            val generated = "android-${UUID.randomUUID().toString().take(8)}"
            prefs.edit().putString("device_id", generated).apply()
            return generated
        }
        set(value) = prefs.edit().putString("device_id", value.trim()).apply()

    var deviceName: String
        get() = prefs.getString("device_name", "${Build.MANUFACTURER} ${Build.MODEL}") ?: "Android Phone"
        set(value) = prefs.edit().putString("device_name", value.trim()).apply()
}
