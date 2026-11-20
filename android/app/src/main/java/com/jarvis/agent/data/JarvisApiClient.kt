package com.jarvis.agent.data

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class BrainCommand(
    val id: String,
    val prompt: String,
    val actions: JSONArray
)

class PairingRequired : Exception("Check the Brain URL and this phone’s device token in Setup, then tap Save & Connect.")

class JarvisApiClient(private val config: JarvisConfig) {

    private fun postJson(path: String, body: JSONObject, registration: Long? = null): JSONObject {
        val generation = registration ?: config.pairingGeneration
        if (registration == null && config.pairingPaused) throw PairingRequired()
        val base = config.brainUrl.trimEnd('/')
        val conn = (URL("$base$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Jarvis-Token", config.pairingToken)
        }

        try {
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val code = conn.responseCode
            if (code == 401) {
                config.pairingResult(generation, false)
                throw PairingRequired()
            }
            if (code !in 200..299) throw RuntimeException("HTTP $code")
            val text = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
            val response = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (registration != null) config.pairingResult(generation, true)
            return response
        } finally { conn.disconnect() }
    }

    suspend fun registerDevice(telemetry: JSONObject, capabilities: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("deviceId", config.deviceId)
                put("name", config.deviceName)
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("capabilities", capabilities)
                put("telemetry", telemetry)
            }
            postJson("/api/devices/register", body, config.beginPairing())
        }

    suspend fun sendHeartbeat(telemetry: JSONObject, capabilities: JSONObject): List<BrainCommand> =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("deviceId", config.deviceId)
                put("name", config.deviceName)
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("capabilities", capabilities)
                put("telemetry", telemetry)
            }
            flushAcks()
            val res = postJson("/api/devices/heartbeat", body)
            val arr = res.optJSONArray("commands") ?: JSONArray()
            val list = mutableListOf<BrainCommand>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    BrainCommand(
                        id = obj.getString("id"),
                        prompt = obj.optString("prompt", ""),
                        actions = obj.optJSONArray("actions") ?: JSONArray()
                    )
                )
            }
            list
        }

    suspend fun ackCommand(
        commandId: String,
        status: String,
        resultMessage: String,
        actions: JSONArray
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("commandId", commandId)
            put("status", status)
            put("resultMessage", resultMessage)
            put("actions", actions)
        }
        config.saveAck(commandId, body.toString())
        flushAcks()
    }

    private fun flushAcks() {
        for ((key, json) in config.pendingAcks()) {
            postJson("/api/commands/ack", JSONObject(json as String))
            config.clearAck(key)
        }
    }

    suspend fun postNotification(app: String, sender: String, text: String) =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("deviceId", config.deviceId)
                put("app", app)
                put("sender", sender)
                put("text", text)
            }
            postJson("/api/notifications", body)
        }

    suspend fun sendCommand(prompt: String): JSONObject =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("prompt", prompt)
                put("deviceId", config.deviceId)
                put("source", "android-app")
            }
            postJson("/api/command", body)
        }
}
