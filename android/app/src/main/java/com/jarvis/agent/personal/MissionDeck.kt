package com.jarvis.agent.personal

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.jarvis.agent.service.DeviceActionExecutor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MissionDeck() {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var selected by rememberSaveable { mutableStateOf(0) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val mission = phoneMissions[selected]
    val statuses = remember(mission) { mutableStateListOf<String>().apply { repeat(mission.steps.size) { add("Ready") } } }
    var message by remember(mission) { mutableStateOf("") }
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("MISSION DECK   /   ON DEVICE", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text("One tap, one routine", style = MaterialTheme.typography.titleLarge)
            Text("Preview the steps first. No pairing or AI key needed.")
            OutlinedButton(onClick={ expanded = !expanded }, enabled=!busy) { Text(if(expanded) "Hide missions" else "Choose a mission") }
            if (expanded) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    phoneMissions.forEachIndexed { i, preset -> FilterChip(selected=i==selected, onClick={ selected=i }, enabled=!busy, label={ Text(preset.title) }) }
                }
                Text(mission.hint)
                mission.steps.forEachIndexed { i, step -> Text("${i+1}. ${step.title}  ·  ${statuses[i]}") }
                Text("Settings stay changed until you change them back.", style=MaterialTheme.typography.bodySmall)
                Button(enabled=!busy, onClick={
                    busy=true; message=""; statuses.indices.forEach { statuses[it]="Ready" }
                    scope.launch {
                        try {
                            val executor=DeviceActionExecutor(context)
                            val ok=runMission(mission, {i,state -> statuses[i]=state}) { step ->
                                val action=JSONObject().put("type",step.type).put(step.key,step.value).put("label",step.title).put("requiresUnlock",step.unlock)
                                val (_,results)=executor.executeActions(JSONArray().put(action), silent=true)
                                results.optJSONObject(0)?.optString("status")=="done"
                            }
                            message=if(ok) "All steps dispatched to Android." else "Stopped at the failed step. Check permissions, screen lock or app availability."
                        } catch(e: CancellationException) { throw e }
                        finally { busy=false }
                    }
                }) { Text(if(busy) "Running…" else "Run ${mission.title}") }
                if(message.isNotBlank()) Text(message)
            }
        }
    }
}
