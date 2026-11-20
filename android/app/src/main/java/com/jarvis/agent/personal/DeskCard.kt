package com.jarvis.agent.personal

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun DeskCard() {
    val context = LocalContext.current.applicationContext
    val store = remember(context) { DeskStore(context) }
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    var output by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Personal Desk", style = MaterialTheme.typography.titleMedium)
            Text("Private memory & focus planner · runs on this phone")
            OutlinedButton(enabled = !busy, onClick = { open = !open; input = ""; output = "" }) { Text(if (open) "Hide desk" else "Open desk") }
            if (open) {
                Text("Save: yaad rakho: bike B2\nRecall: find bike\nPriority task: task! 15: pay bill\nNormal task: task 10: revise notes\nPlan: mere paas 25 min hain\nManage: list · done #2 · forget #1")
                OutlinedTextField(value = input, onValueChange = { input = it.take(550) }, singleLine = true, enabled = !busy,
                    label = { Text("Private command") }, modifier = Modifier.fillMaxWidth())
                Button(enabled = input.isNotBlank() && !busy, onClick = {
                    val command = input; busy = true
                    scope.launch {
                        try { output = withContext(Dispatchers.IO) { store.run(command) }; input = "" }
                        catch (_: Exception) { output = "Cannot open or save this desk. Existing data was not reset." }
                        finally { busy = false }
                    }
                }) { Text("Run locally") }
                if (output.isNotEmpty()) Text(output)
            }
        }
    }
}
