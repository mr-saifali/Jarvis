package com.jarvis.agent.quick

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService

class CommandTile : TileService() {
    @Suppress("DEPRECATION")
    override fun onClick() {
        super.onClick()
        val open = Runnable {
            val intent = Intent(this, QuickCommandActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
            } else startActivityAndCollapse(intent)
        }
        if (isLocked) unlockAndRun(open) else open.run()
    }
}
