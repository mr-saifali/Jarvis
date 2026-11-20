package com.jarvis.agent

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import com.jarvis.agent.data.JarvisLogStore
import com.jarvis.agent.service.JarvisAccessibilityService
import com.jarvis.agent.service.JarvisForegroundService
import com.jarvis.agent.service.JarvisNotificationService
import com.jarvis.agent.worker.JarvisHeartbeatWorker
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = JarvisConfig(applicationContext)
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

@Composable
fun JarvisScreen(config: JarvisConfig) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val logs by JarvisLogStore.logs.collectAsState()

    var brainUrl by remember { mutableStateOf(config.brainUrl) }
    var pairingToken by remember { mutableStateOf(config.pairingToken) }
    var commandText by remember { mutableStateOf("") }
    var statusText by remember { mutableStateOf("Ready to connect") }

    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val batteryUnrestricted = pm.isIgnoringBatteryOptimizations(context.packageName)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF070B12))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                text = "J.A.R.V.I.S. Android Core",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF38BDF8)
            )
            Text(
                text = "Device ID: ${config.deviceId} • $statusText",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF8EA3C2)
            )
        }

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
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            config.brainUrl = brainUrl
                            config.pairingToken = pairingToken
                            JarvisForegroundService.start(context)
                            scope.launch {
                                try {
                                    JarvisApiClient(config).registerDevice(JSONObject(), JSONObject())
                                    statusText = "Connected & Heartbeat Active"
                                    JarvisLogStore.append("Paired with $brainUrl")
                                } catch (e: Exception) {
                                    statusText = "Connection failed: ${e.message}"
                                    JarvisLogStore.append("Pair error: ${e.message}")
                                }
                            }
                        }) {
                            Text("Save & Connect")
                        }
                    }
                }
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1522))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Send Command", fontWeight = FontWeight.SemiBold, color = Color.White)
                    OutlinedTextField(
                        value = commandText,
                        onValueChange = { commandText = it },
                        label = { Text("e.g. Turn on DND and set brightness to 30%") },
                        modifier = Modifier.fillMaxWidth()
                    )
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
                        Text("Execute via Jarvis Brain")
                    }
                }
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1522))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Required Android Permissions", fontWeight = FontWeight.SemiBold, color = Color.White)
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
fun PermissionRow(label: String, granted: Boolean, onGrant: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
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
