package com.jarvis.agent.inbox

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import com.jarvis.agent.worker.SnoozedReminder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class FollowActivity : ComponentActivity() {
    private var refreshVersion by mutableIntStateOf(0)
    override fun onResume() { super.onResume(); refreshVersion++ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = if(intent.action == Intent.ACTION_SEND && intent.type == "text/plain") intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.take(4000)?.toString().orEmpty() else ""
        setContent { MaterialTheme { Surface { FollowScreen(incoming) } } }
    }
    @Composable private fun FollowScreen(incoming: String) {
        val store = remember { FollowStore(applicationContext) }
        val scope = rememberCoroutineScope()
        var source by remember { mutableStateOf(incoming) }
        var review by remember { mutableStateOf(if(incoming.isBlank()) emptyList() else ideas(incoming)) }
        val choices = remember(review) { mutableStateListOf<Boolean>().apply { repeat(review.size) { add(true) } } }
        val edits = remember(review) { mutableStateListOf<Idea>().apply { addAll(review) } }
        var rows by remember { mutableStateOf(emptyList<Follow>()) }
        var info by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
        suspend fun refresh() { rows = withContext(Dispatchers.IO) { store.pending() } }
        LaunchedEffect(refreshVersion) { refresh() }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("Iska kaam bana",style=MaterialTheme.typography.headlineSmall)
            Text("Share or paste text. Nothing runs until you review and save.")
            OutlinedTextField(source,{source=it.take(4000);review=emptyList()},label={Text("Source text")},enabled=!busy)
            Button(onClick={review=ideas(source);info=""}, enabled=source.isNotBlank() && !busy) { Text("Suggest actions") }
            edits.forEachIndexed { i,e ->
                Row { Checkbox(choices[i],{choices[i]=it},enabled=!busy); Text(e.kind.uppercase()) }
                OutlinedTextField(e.text,{edits[i]=e.copy(text=it.take(500))},enabled=choices[i] && !busy,label={Text("Review wording")})
                if(e.kind=="reminder" && choices[i]) {
                    Text("Phone local time. If unclear, choose the date and time yourself.")
                    OutlinedTextField(e.date,{edits[i]=e.copy(date=it.take(10))},label={Text("Date YYYY-MM-DD")},enabled=!busy)
                    OutlinedTextField(e.time,{edits[i]=e.copy(time=it.take(5))},label={Text("Time HH:mm (24h)")},enabled=!busy)
                }
            }
            if (edits.isNotEmpty()) Button(enabled=!busy && choices.any { it }, onClick={
                val selected=edits.filterIndexed { i,_ -> choices[i] }; val topic=source.lineSequence().firstOrNull()?.take(60).orEmpty()
                busy=true
                scope.launch { try {
                    withContext(Dispatchers.IO) {
                        val fmt=SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.US).apply { isLenient=false }
                        val items=selected.map { e ->
                            require(e.text.isNotBlank()) { "Fill in each selected action." }
                            val whenMs=if(e.kind=="reminder") {
                                require(NotificationManagerCompat.from(this@FollowActivity).areNotificationsEnabled()) { "Enable Jarvis notifications or deselect reminders." }
                                val raw="${e.date} ${e.time}"; val parsed=runCatching { fmt.parse(raw) }.getOrNull()
                                require(parsed!=null && fmt.format(parsed)==raw && parsed.time>System.currentTimeMillis()) { "Choose a valid future date and time for each reminder." }; parsed.time
                            } else 0L
                            Follow("follow-" + UUID.randomUUID().toString(),topic,e.kind,e.text,when(e.kind){"draft"->"draft — not sent";"reminder"->"not scheduled";else->"to do"}) to whenMs
                        }
                        store.insert(items.map { it.first })
                        items.filter { it.second>0 }.forEach { (row,at) ->
                            val data=workDataOf("id" to row.id,"message" to row.text)
                            val work=OneTimeWorkRequestBuilder<SnoozedReminder>().setInputData(data).setInitialDelay((at-System.currentTimeMillis()).coerceAtLeast(0),TimeUnit.MILLISECONDS).build()
                            runCatching { WorkManager.getInstance(applicationContext).enqueueUniqueWork("follow:${row.id}",ExistingWorkPolicy.KEEP,work).result.get() }
                                .onSuccess { store.status(row.id,"scheduled · ${fmt.format(java.util.Date(at))}") }
                        }
                    }; review=emptyList();source="";info="Saved. Check each status below."
                } catch(e:Exception){info=e.message ?: "Could not save."} finally { busy=false;refresh() } }
            }) { Text("Approve selected actions") }
            Text(info); Text("Kya baaki hai?",style=MaterialTheme.typography.titleLarge)
            if(rows.isEmpty()) Text("No open follow-ups.")
            rows.forEach { row ->
                Text("${row.group}\n${row.text}\n${row.state}")
                if(row.kind=="draft") TextButton(onClick={
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,row.text),"Share reply draft"))
                }) { Text("Share draft (delivery not verified)") }
                TextButton(onClick={scope.launch { withContext(Dispatchers.IO) {
                    if(row.kind=="reminder") {
                        val wm=WorkManager.getInstance(applicationContext)
                        wm.cancelUniqueWork("follow:${row.id}").result.get(); wm.cancelUniqueWork("reminder:${row.id}").result.get()
                        getSystemService(android.app.NotificationManager::class.java).cancel(row.id,1)
                    }
                    store.status(row.id,"done") };refresh() }}) { Text(if(row.kind=="reminder") "Close / cancel reminder" else "Mark handled") }
            }
        }
    }
}
