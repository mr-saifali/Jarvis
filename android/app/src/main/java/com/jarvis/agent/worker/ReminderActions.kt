package com.jarvis.agent.worker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val CHANNEL = "jarvis_reminders"

fun showReminder(context: Context, message: String, id: String = UUID.randomUUID().toString()): Boolean {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= 26) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        if (manager.getNotificationChannel(CHANNEL).importance == NotificationManager.IMPORTANCE_NONE) return false
    }
    fun button(action: String): PendingIntent {
        val intent = Intent(context, ReminderActions::class.java).setAction(action)
            .setData(Uri.fromParts("jarvis-reminder", id, null)).putExtra("message", message)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Jarvis reminder")
        .setContentText(message).setStyle(NotificationCompat.BigTextStyle().bigText(message))
        .setPriority(NotificationCompat.PRIORITY_HIGH).setOnlyAlertOnce(true)
        .addAction(android.R.drawable.ic_popup_reminder, "Snooze 10 min", button("snooze"))
        .addAction(android.R.drawable.checkbox_on_background, "Complete", button("complete")).build()
    manager.notify(id, 1, notification)
    return true
}

class ReminderActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.schemeSpecificPart ?: return
        if (intent.action == "snooze") {
            val data = Data.Builder().putString("id", id).putString("message", intent.getStringExtra("message")).build()
            val work = OneTimeWorkRequestBuilder<SnoozedReminder>().setInputData(data)
                .setInitialDelay(10, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniqueWork("reminder:$id", androidx.work.ExistingWorkPolicy.REPLACE, work)
        } else if (intent.action != "complete") return
        if (id.startsWith("follow-")) com.jarvis.agent.inbox.FollowStore(context).use {
            it.status(id, if (intent.action == "complete") "done" else "snoozed · 10 min")
        }
        context.getSystemService(NotificationManager::class.java).cancel(id, 1)
    }
}

class SnoozedReminder(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.failure()
        val message = inputData.getString("message") ?: return Result.failure()
        val shown = showReminder(applicationContext, message, id)
        if (id.startsWith("follow-")) com.jarvis.agent.inbox.FollowStore(applicationContext).use {
            it.status(id, if (shown) "notified — awaiting completion" else "notification unavailable")
        }
        return if (shown) Result.success() else Result.failure()
    }
}
