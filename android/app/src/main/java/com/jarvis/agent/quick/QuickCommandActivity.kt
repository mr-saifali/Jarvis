package com.jarvis.agent.quick

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.jarvis.agent.data.JarvisApiClient
import com.jarvis.agent.data.JarvisConfig
import kotlinx.coroutines.launch

class QuickCommandActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = JarvisConfig(applicationContext)
        setContent {
            var text by rememberSaveable { mutableStateOf("") }
            var result by rememberSaveable { mutableStateOf("") }
            var busy by remember { mutableStateOf(false) }
            val dictate = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { reply ->
                if (reply.resultCode == Activity.RESULT_OK) reply.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text = it.take(1000) }
            }
            MaterialTheme { Surface {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Ask Jarvis", style = MaterialTheme.typography.titleLarge)
                    OutlinedTextField(value=text, onValueChange={ text=it.take(1000) }, enabled=!busy, label={ Text("Command for this phone") })
                    Row {
                        TextButton(enabled=!busy, onClick={
                            try { dictate.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)) }
                            catch (_: ActivityNotFoundException) { result="Voice input unavailable. Type your command instead." }
                        }) { Text("Dictate") }
                        Button(enabled=!busy && text.isNotBlank(), onClick={
                            if (config.brainUrl.isBlank() || config.pairingToken.isBlank()) {
                                result="Pair this phone in the Jarvis app first."
                            } else {
                                val prompt=text.trim(); busy=true; result="Submitting…"
                                lifecycleScope.launch {
                                    try {
                                        val reply=JarvisApiClient(config).sendCommand(prompt)
                                        result=when(reply.optJSONObject("command")?.optString("status")) {
                                            "awaiting_approval" -> "Waiting for dashboard approval."
                                            "queued" -> "Queued for this phone. Check history for completion."
                                            else -> reply.optString("summary", "Submitted.")
                                        }; text=""
                                    } catch (_: Exception) { result="Submission not confirmed. Check command history before retrying." }
                                    finally { busy=false }
                                }
                            }
                        }) { Text("Send") }
                        TextButton(onClick={ finish() }) { Text("Close") }
                    }
                    if (result.isNotEmpty()) Text(result)
                }
            } }
        }
    }
}
