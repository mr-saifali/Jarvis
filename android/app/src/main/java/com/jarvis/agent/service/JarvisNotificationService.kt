package com.jarvis.agent.service

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.data.JarvisLogStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

class JarvisNotificationService : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object {
        @Volatile
        var instance: JarvisNotificationService? = null
            private set

        private val replyActions = ConcurrentHashMap<String, Notification.Action>()

        fun isReady(): Boolean = instance != null

        fun sendQuickReply(app: String, sender: String, replyText: String): Boolean {
            val svc = instance ?: return false
            val key = "${app.lowercase()}::${sender.lowercase()}"
            val action = replyActions[key]
                ?: replyActions.entries.firstOrNull { it.key.startsWith("${app.lowercase()}::") }?.value
                ?: return false

            val remoteInput = action.remoteInputs?.firstOrNull() ?: return false
            val intent = Intent()
            val bundle = Bundle().apply {
                putCharSequence(remoteInput.resultKey, replyText)
            }
            RemoteInput.addResultsToIntent(arrayOf(remoteInput), intent, bundle)
            return try {
                action.actionIntent.send(svc, 0, intent)
                JarvisLogStore.append("Auto-replied via RemoteInput to $app ($sender)")
                true
            } catch (e: Exception) {
                JarvisLogStore.append("RemoteInput reply failed: ${e.message}")
                false
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        JarvisLogStore.append("Notification Listener connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (instance === this) instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName == packageName) return
        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        if (title.isBlank() && text.isBlank()) return

        val appLabel = friendlyAppName(sbn.packageName)

        // Cache RemoteInput quick-reply action if present
        sbn.notification?.actions?.firstOrNull { it.remoteInputs?.isNotEmpty() == true }?.let { act ->
            replyActions["${appLabel.lowercase()}::${title.lowercase()}"] = act
        }

        val config = JarvisConfig(applicationContext)
        if (config.pairingPaused) return
        val client = JarvisApiClient(config)
        scope.launch {
            try {
                client.postNotification(appLabel, title, text)
                JarvisLogStore.append("Forwarded notification [$appLabel] $title")
            } catch (_: com.jarvis.agent.data.PairingRequired) {
                // The shared pairing gate pauses forwarding until explicit re-registration.
            } catch (e: Exception) {
                JarvisLogStore.append("Notification forward error: ${e.message}")
            }
        }
    }

    private fun friendlyAppName(pkg: String): String = when {
        pkg.contains("whatsapp", ignoreCase = true) -> "WhatsApp"
        pkg.contains("gm", ignoreCase = true) || pkg.contains("mail", ignoreCase = true) -> "Gmail"
        pkg.contains("spotify", ignoreCase = true) -> "Spotify"
        pkg.contains("messaging", ignoreCase = true) || pkg.contains("mms", ignoreCase = true) -> "SMS"
        else -> pkg.substringAfterLast('.')
    }
}
