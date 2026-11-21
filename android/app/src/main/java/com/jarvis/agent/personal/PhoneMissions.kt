package com.jarvis.agent.personal

internal data class MissionStep(val title: String, val type: String, val key: String, val value: Any, val unlock: Boolean = false)
internal data class PhoneMission(val title: String, val hint: String, val steps: List<MissionStep>)
internal val phoneMissions = listOf(
    PhoneMission("Focus sprint", "Quiet the music and start a study block. Needs a Clock app.", listOf(
        MissionStep("Pause media", "media_control", "command", "pause"),
        MissionStep("Media volume → 15%", "set_volume", "level", 15),
        MissionStep("Start a 25-minute timer", "set_timer", "seconds", 1500, true))),
    PhoneMission("Reading light", "Set up the screen for reading. Requires Modify system settings.", listOf(
        MissionStep("Pause media", "media_control", "command", "pause"),
        MissionStep("Brightness → 35%", "set_brightness", "level", 35))),
    PhoneMission("Music break", "Set a comfortable starting level and resume the active player.", listOf(
        MissionStep("Media volume → 35%", "set_volume", "level", 35),
        MissionStep("Resume media", "media_control", "command", "play")))
)

internal suspend fun runMission(mission: PhoneMission, progress: (Int, String) -> Unit, execute: suspend (MissionStep) -> Boolean): Boolean {
    for ((i, step) in mission.steps.withIndex()) {
        progress(i, "Running")
        if (!execute(step)) {
            progress(i, "Failed")
            for (later in i + 1 until mission.steps.size) progress(later, "Skipped")
            return false
        }
        progress(i, "Dispatched")
    }
    return true
}
