package com.jarvis.agent.quick

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
internal fun AssistantSetup() {
    val context = LocalContext.current
    val fallback = "Open Android Settings → Default apps → Digital assistant app. If Jarvis isn't listed, use the Ask Jarvis Quick Settings tile."
    fun selected(): Boolean = Build.VERSION.SDK_INT >= 29 &&
        context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
    var held by remember { mutableStateOf(selected()) }
    var hint by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        held = selected()
        hint = if (held) "Jarvis is your default assistant." else fallback
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Assistant shortcut", style = MaterialTheme.typography.titleMedium)
            Text("Use your phone’s assistant gesture to bring up Jarvis over the app you’re using. No floating-window or accessibility permission needed.")
            OutlinedButton(onClick = {
                try {
                    val manager = if (Build.VERSION.SDK_INT >= 29) context.getSystemService(RoleManager::class.java) else null
                    val intent = if (Build.VERSION.SDK_INT >= 29 && manager != null && manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && !manager.isRoleHeld(RoleManager.ROLE_ASSISTANT)) {
                        manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)
                    } else Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
                    picker.launch(intent)
                } catch (_: ActivityNotFoundException) { hint = fallback }
                  catch (_: SecurityException) { hint = fallback }
            }) { Text(if (held) "Manage default assistant" else "Choose Jarvis as assistant") }
            if (hint.isNotEmpty()) Text(hint)
        }
    }
}
