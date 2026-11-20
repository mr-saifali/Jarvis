package com.jarvis.agent.personal

internal data class Entry(val id: Int, val text: String, val minutes: Int = 0, val important: Boolean = false)
internal data class Desk(val nextId: Int = 1, val entries: List<Entry> = emptyList())
internal data class Answer(val desk: Desk, val text: String)

// Time-budget planner: prioritize important tasks, then task count, then time used.
// A reverse traversal means a task can appear at most once in a plan.
internal fun focusPlan(tasks: List<Entry>, budget: Int): List<Entry> {
    require(budget in 1..240)
    data class Slot(val score: Int, val item: Entry?, val previous: Slot?)
    val empty = Slot(0, null, null)
    val slots = Array(budget + 1) { empty }
    for (task in tasks.filter { it.minutes in 1..budget }) {
        for (limit in budget downTo task.minutes) {
            val previous = slots[limit - task.minutes]
            val score = previous.score + (if (task.important) 1000000 else 0) + 241 + task.minutes
            if (score > slots[limit].score) slots[limit] = Slot(score, task, previous)
        }
    }
    return generateSequence(slots[budget]) { it.previous }.mapNotNull { it.item }.toList()
        .sortedWith(compareByDescending<Entry> { it.important }.thenBy { it.id })
}

internal fun answer(desk: Desk, raw: String): Answer {
    val command = raw.trim()
    fun reply(text: String) = Answer(desk, text)
    fun line(e: Entry) = "#${e.id} ${if (e.important) "★ " else ""}${e.text}" + if (e.minutes > 0) " · ${e.minutes} min" else ""
    fun add(text: String, minutes: Int, important: Boolean): Answer {
        if (text.isBlank() || text.length > 500) return reply("Use 1–500 characters per item.")
        if (desk.entries.size >= 200) return reply("Desk is full. Remove an item first.")
        val e = Entry(desk.nextId, text.trim(), minutes, important)
        return Answer(Desk(e.id + 1, desk.entries + e), "Saved ${line(e)}")
    }
    fun match(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).matchEntire(command)?.groupValues
    match("(?:remember|yaad rakho)\\s*:\\s*(.+)")?.let { return add(it[1], 0, false) }
    match("task(!?)\\s+(\\d{1,3})\\s*(?:min)?\\s*:\\s*(.+)")?.let {
        val minutes = it[2].toInt()
        return if (minutes in 1..240) add(it[3], minutes, it[1] == "!") else reply("Task estimate must be 1–240 min.")
    }
    match("(?:find|dhundo)\\s+(.+)")?.let {
        val words = it[1].trim().split(Regex("\\s+"))
        val hits = desk.entries.asReversed().filter { e -> words.all { w -> e.text.contains(w, ignoreCase = true) } }
        return reply(hits.take(10).joinToString("\n", transform = ::line).ifEmpty { "No matching memory or task." })
    }
    match("(?:plan|mere paas)\\s+(\\d{1,3})(?:\\s*min(?:utes?)?)?(?:\\s+hain?)?")?.let {
        val budget = it[1].toInt()
        if (budget !in 1..240) return reply("Choose a budget of 1–240 min.")
        val picks = focusPlan(desk.entries, budget)
        return reply(if (picks.isEmpty()) "No pending task fits $budget min." else "Focus plan · ${picks.sumOf { e -> e.minutes }}/$budget min\n" + picks.joinToString("\n", transform = ::line))
    }
    match("(done|forget)\\s+#?(\\d+)")?.let {
        val id = it[2].toIntOrNull(); val item = desk.entries.find { e -> e.id == id } ?: return reply("ID not found.")
        if (it[1].equals("done", true) && item.minutes == 0) return reply("That is a memory. Use forget #$id to delete it.")
        return Answer(desk.copy(entries = desk.entries - item), "Removed #$id from your desk.")
    }
    if (command.equals("list", true)) return reply(desk.entries.asReversed().joinToString("\n", transform = ::line).ifEmpty { "Your desk is empty." })
    return reply("Try: yaad rakho: bike B2 · find bike · task! 15: pay bill · plan 30 · done #2 · forget #1 · list")
}
