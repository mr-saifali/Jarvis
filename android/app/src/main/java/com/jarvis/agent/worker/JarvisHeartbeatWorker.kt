package com.jarvis.agent.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.service.DeviceActionExecutor
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class JarvisHeartbeatWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val config = JarvisConfig(applicationContext)
            if (config.pairingPaused) return Result.success()
            val client = JarvisApiClient(config)
            val executor = DeviceActionExecutor(applicationContext)
            val commands = client.sendHeartbeat(JSONObject(), JSONObject())
            for (cmd in commands) {
                val (status, resultActions) = executor.executeActions(cmd.actions)
                client.ackCommand(cmd.id, status, "Executed via WorkManager", resultActions)
            }
            Result.success()
        } catch (_: com.jarvis.agent.data.PairingRequired) {
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<JarvisHeartbeatWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "jarvis_periodic_heartbeat",
                ExistingPeriodicWorkPolicy.KEEP,
                req
            )
        }
    }
}
