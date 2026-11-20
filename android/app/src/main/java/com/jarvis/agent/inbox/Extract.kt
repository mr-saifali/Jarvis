package com.jarvis.agent.inbox

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

internal data class Idea(val kind: String, val text: String, val date: String = "", val time: String = "")
private val clock = Regex("""\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)""", RegexOption.IGNORE_CASE)
internal fun ideas(source: String, now: Calendar = Calendar.getInstance()): List<Idea> {
    fun has(text: String, pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(text)
    val clauses = source.take(4000).split(Regex("""[,;।\n]|\s+(?:aur|and|और)\s+""", RegexOption.IGNORE_CASE)).map { it.trim() }.filter { it.isNotBlank() }.take(12)
    val result = mutableListOf<Idea>()
    for (part in clauses) {
        val tomorrow = has(part,"\\b(kal|tomorrow)\\b|कल")
        val today = has(part,"\\b(aaj|today)\\b|आज")
        val match = clock.find(part)
        if (tomorrow || today || match != null || has(part,"shaam|evening|शाम|deadline|remind")) {
            val day = now.clone() as Calendar
            if (tomorrow) day.add(Calendar.DAY_OF_YEAR,1)
            val date = if (today || tomorrow) SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = day.timeZone }.format(day.time) else ""
            val h = match?.groupValues?.get(1)?.toIntOrNull()
            val unit = match?.groupValues?.get(3)?.lowercase(Locale.ROOT)
            val hour = when {
                h == null -> null
                h in 1..12 && (unit == "pm" || has(part,"shaam|evening|raat|शाम|रात")) -> h%12+12
                h in 1..12 && (unit == "am" || has(part,"subah|morning|सुबह")) -> h%12
                h in 13..23 -> h
                else -> null // 11 baje is ambiguous; do not silently assume AM.
            }
            val minute = match?.groupValues?.get(2)?.ifEmpty { "0" }?.toIntOrNull()
            val time = if(hour != null && minute != null && minute in 0..59) String.format(Locale.US,"%02d:%02d",hour,minute) else ""
            result.add(Idea("reminder",part.take(300),date,time))
        }
        if (has(part,"confirm|reply|respond|जवाब|पुष्टि")) {
            val reply = if (has(source,"interview|इंटरव्यू")) "Thank you for the interview invitation. I confirm my availability." else "Thanks for letting me know. I confirm."
            if (result.none { it.kind == "draft" }) result.add(Idea("draft",reply))
        } else if (has(part,"bring|prepare|update|submit|attach|ले आना|लाना|le aana|lana|bhej|जमा|लेकर")) result.add(Idea("task",part.take(300)))
    }
    if (result.none { it.kind == "task" }) result.add(Idea("task",clauses.firstOrNull()?.take(300) ?: "Follow up"))
    return result.distinct().take(12)
}
