package com.jarvis.agent.personal

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun WriterCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var word by rememberSaveable { mutableStateOf(false) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == android.app.Activity.RESULT_OK && uri != null) {
            val heading = title.trim().ifEmpty { "Jarvis note" }; val text = body; val docx = word
            scope.launch {
                status = try {
                    withContext(Dispatchers.IO) {
                        requireNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { out ->
                            if (docx) writeDocument(out, heading, text) else out.write("$heading\n\n$text".toByteArray(Charsets.UTF_8))
                        }
                    }; "Saved."
                } catch (_: Exception) { "Save failed. Your draft is still here." }
            }
        }
    }
    fun export(docx: Boolean) {
        word = docx
        val name = title.trim().replace(Regex("[^\\p{L}\\p{N} _-]"), "_").ifEmpty { "Jarvis note" }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (docx) "application/vnd.openxmlformats-officedocument.wordprocessingml.document" else "text/plain")
            .putExtra(Intent.EXTRA_TITLE, name + if (docx) ".docx" else ".txt")
        try { save.launch(intent) } catch (_: android.content.ActivityNotFoundException) { status = "File picker unavailable." }
    }
    fun share(pkg: String) {
        val text = listOf(title.trim(), body.trim()).filter { it.isNotEmpty() }.joinToString("\n\n")
        try {
            context.startActivity(Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(pkg).putExtra(Intent.EXTRA_TEXT, text))
            status = "Choose the chat and confirm Send in the messaging app."
        } catch (_: android.content.ActivityNotFoundException) { status = "Messaging app unavailable. Draft kept." }
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Notes, docs & messages", style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = { open = !open }) { Text(if (open) "Hide editor" else "Write a draft") }
            if (open) {
                OutlinedTextField(title, { title = it.take(100) }, label = { Text("Title (optional)") }, singleLine = true)
                OutlinedTextField(body, { body = it.take(12000) }, label = { Text("Your note or message") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                if (body.isBlank()) TextButton(onClick = { body = "Summary:\n\nKey points:\n• \n\nNext steps:\n• " }) { Text("Start with meeting notes") }
                Row { TextButton(enabled = body.isNotBlank(), onClick = { export(false) }) { Text("Save .txt") }; TextButton(enabled = body.isNotBlank(), onClick = { export(true) }) { Text("Save .docx") } }
                Row { TextButton(enabled = body.isNotBlank(), onClick = { share("com.whatsapp") }) { Text("WhatsApp") }; TextButton(enabled = body.isNotBlank(), onClick = { share("org.telegram.messenger") }) { Text("Telegram") } }
                if (status.isNotEmpty()) Text(status)
            }
        }
    }
}
