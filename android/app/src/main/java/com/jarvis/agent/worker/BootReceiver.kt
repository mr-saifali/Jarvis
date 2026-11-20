package com.jarvis.agent.worker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.jarvis.agent.service.JarvisForegroundService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            JarvisForegroundService.start(context)
            JarvisHeartbeatWorker.schedule(context)
        }
    }
}
