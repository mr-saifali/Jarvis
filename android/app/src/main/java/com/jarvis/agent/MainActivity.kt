package com.jarvis.agent

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.data.JarvisLogStore
import com.jarvis.agent.service.DeviceActionExecutor
import com.jarvis.agent.service.JarvisAccessibilityService
import com.jarvis.agent.service.JarvisForegroundService
import com.jarvis.agent.service.JarvisNotificationService
import com.jarvis.agent.service.JarvisVoiceEngine
import com.jarvis.agent.worker.JarvisHeartbeatWorker
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = JarvisConfig(applicationContext)
        JarvisVoiceEngine.init(applicationContext)
        JarvisHeartbeatWorker.schedule(applicationContext)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF38BDF8),
                    background = Color(0xFF070B12),
                    surface = Color(0xFF0E1522)
                )
            ) {
                JarvisScreen(config = config)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JarvisScreen(config: JarvisConfig) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val logs by JarvisLogStore.logs.collectAsState()

    var brainUrl by remember { mutableStateOf(config.brainUrl) }
    var pairingToken by remember { mutableStateOf(config.pairingToken) }
    var voiceFeedback by remember { mutableStateOf(config.voiceFeedback) }
    var commandText by remember { mutableStateOf("") }
    var statusText by remember { mutableStateOf("Ready to connect") }
    var permTick by remember { mutableStateOf(0) }

    val runtimePermsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        permTick++
        JarvisLogStore.append("Updated runtime permissions")
    }

    val voiceLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val spoken = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (spoken.isNotEmpty()) {
                commandText = spoken
                JarvisLogStore.append("Voice heard: \"$spoken\"")
                scope.launch {
                    try {
                        JarvisApiClient(config).sendCommand(spoken)
                        statusText = "Sent voice command: $spoken"
                    } catch (e: Exception) {
                        statusText = "Voice send error: ${e.message}"
                    }
                }
            }
        }
    }

    // Re-read permission state when permTick changes
    permTick.let { }
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val batteryUnrestricted = pm.isIgnoringBatteryOptimizations(context.packageName)
    val smsGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
    val callGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
    val micGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    val notifPermGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    } else true

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF070B12))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                text = "J.A.R.V.I.S. Stark Core",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF38BDF8)
            )
            Text(
                text = "ID: ${config.deviceId} • $statusText",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF8EA3C2)
            )
        }

        // Voice & Command Card
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1522))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Voice & Command HUD", fontWeight = FontWeight.SemiBold, color = Color.White)

                    Button(
                        onClick = {
                            try {
                                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                                    putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to Jarvis...")
                                }
                                voiceLauncher.launch(intent)
                            } catch (e: Exception) {
                                JarvisLogStore.append("Voice input unavailable: ${e.message}")
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7))
                    ) {
                        Text("Speak to J.A.R.V.I.S. (Voice Command)", color = Color.White)
                    }

                    OutlinedTextField(
                        value = commandText,
                        onValueChange = { commandText = it },
                        label = { Text("Type command (e.g. Flashlight on, Open WhatsApp...)") },
                        modifier = Modifier.fillMaxWidth()
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            val prompt = commandText.trim()
                            if (prompt.isNotEmpty()) {
                                scope.launch {
                                    try {
                                        JarvisApiClient(config).sendCommand(prompt)
                                        JarvisLogStore.append("Dispatched: $prompt")
                                        commandText = ""
                                    } catch (e: Exception) {
                                        JarvisLogStore.append("Command error: ${e.message}")
                                    }
                                }
                            }
                        }) {
                            Text("Execute")
                        }
                        OutlinedButton(onClick = {
                            JarvisVoiceEngine.speak(context, "At your service, sir. All systems are online.")
                        }) {
                            Text("Test Voice")
                        }
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        QuickChip("Flashlight On") {
                            scope.launch {
                                val arr = JSONArray().put(JSONObject().put("type", "set_flashlight").put("enabled", true).put("label", "Flashlight on"))
                                DeviceActionExecutor(context).executeActions(arr, voiceFeedback)
                            }
                        }
                        QuickChip("Flashlight Off") {
                            scope.launch {
                                val arr = JSONArray().put(JSONObject().put("type", "set_flashlight").put("enabled", false).put("label", "Flashlight off"))
                                DeviceActionExecutor(context).executeActions(arr, voiceFeedback)
                            }
                        }
                        QuickChip("Screenshot") {
                            scope.launch {
                                val arr = JSONArray().put(JSONObject().put("type", "take_screenshot").put("label", "Took screenshot"))
                                DeviceActionExecutor(context).executeActions(arr, voiceFeedback)
                            }
                        }
                        QuickChip("Mute") {
                            scope.launch {
                                val arr = JSONArray().put(JSONObject().put("type", "set_volume").put("mode", "mute").put("label", "Muted audio"))
                                DeviceActionExecutor(context).executeActions(arr, voiceFeedback)
                            }
                        }
                    }
                }
            }
        }

        // Cloud Brain Pairing Card
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1522))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Cloud Brain Connection", fontWeight = FontWeight.SemiBold, color = Color.White)
                    OutlinedTextField(
                        value = brainUrl,
                        onValueChange = { brainUrl = it },
                        label = { Text("Brain URL") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = pairingToken,
                        onValueChange = { pairingToken = it },
                        label = { Text("Pairing Token") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Jarvis Voice Replies (TTS)", color = Color.White)
                        Switch(
                            checked = voiceFeedback,
                            onCheckedChange = {
                                voiceFeedback = it
                                config.voiceFeedback = it
                            }
                        )
                    }
                    Button(onClick = {
                        config.brainUrl = brainUrl
                        config.pairingToken = pairingToken
                        JarvisForegroundService.start(context)
                        scope.launch {
                            try {
                                JarvisApiClient(config).registerDevice(JSONObject(), JSONObject())
                                statusText = "Connected & Heartbeat Active (3s)"
                                JarvisLogStore.append("Paired with $brainUrl")
                                if (voiceFeedback) {
                                    JarvisVoiceEngine.speak(context, "Jarvis online and connected to cloud brain.")
                                }
                            } catch (e: Exception) {
                                statusText = "Connection failed: ${e.message}"
                                JarvisLogStore.append("Pair error: ${e.message}")
                            }
                        }
                    }, modifier = Modifier.fillMaxWidth()) {
                        Text("Save & Connect")
                    }
                }
            }
        }

        // Permissions Card
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1522))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("All Android Permissions", fontWeight = FontWeight.SemiBold, color = Color.White)

                    Button(
                        onClick = {
                            val list = mutableListOf(
                                Manifest.permission.SEND_SMS,
                                Manifest.permission.CALL_PHONE,
                                Manifest.permission.RECORD_AUDIO
                            )
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                list.add(Manifest.permission.POST_NOTIFICATIONS)
                            }
                            runtimePermsLauncher.launch(list.toTypedArray())
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Grant SMS, Call, Mic & Notifications")
                    }

                    PermissionRow("SMS & Phone Call", smsGranted && callGranted) {
                        runtimePermsLauncher.launch(arrayOf(Manifest.permission.SEND_SMS, Manifest.permission.CALL_PHONE))
                    }
                    PermissionRow("Mic & Notifications", micGranted && notifPermGranted) {
                        val list = mutableListOf(Manifest.permission.RECORD_AUDIO)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) list.add(Manifest.permission.POST_NOTIFICATIONS)
                        runtimePermsLauncher.launch(list.toTypedArray())
                    }
                    PermissionRow("Accessibility Service", JarvisAccessibilityService.isReady()) {
                        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                    PermissionRow("Notification Access", JarvisNotificationService.isReady()) {
                        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    }
                    PermissionRow("Unrestricted Battery", batteryUnrestricted) {
                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:${context.packageName}")
                        }
                        context.startActivity(intent)
                    }
                    PermissionRow("Do Not Disturb Access", nm.isNotificationPolicyAccessGranted) {
                        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
                    }
                    PermissionRow("Modify System Settings", Settings.System.canWrite(context)) {
                        val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS).apply {
                            data = Uri.parse("package:${context.packageName}")
                        }
                        context.startActivity(intent)
                    }
                }
            }
        }

        item {
            Text("Live Agent Telemetry", fontWeight = FontWeight.SemiBold, color = Color.White)
            Spacer(modifier = Modifier.height(4.dp))
        }

        items(logs) { line ->
            Text(
                text = line,
                color = Color(0xFF34D399),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun QuickChip(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) {
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
fun PermissionRow(label: String, granted: Boolean, onGrant: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, color = Color.White)
            Text(
                text = if (granted) "Granted" else "Tap Grant to enable",
                color = if (granted) Color(0xFF34D399) else Color(0xFFFBBF24),
                style = MaterialTheme.typography.bodySmall
            )
        }
        OutlinedButton(onClick = onGrant) {
            Text(if (granted) "Settings" else "Grant")
        }
    }
}
