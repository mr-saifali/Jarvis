package com.jarvis.agent.inbox

import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class ExtractTest {
    private val now = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata")).apply { set(2026,11,31,12,0) }
    @Test fun interviewMessageSeparatesCommitments() {
        val cards=ideas("Kal 11 baje interview hai, updated CV le aana aur aaj shaam tak confirm kar dena",now)
        assertEquals(listOf("2027-01-01","2026-12-31"),cards.filter { it.kind=="reminder" }.map { it.date })
        assertTrue(cards.filter { it.kind=="reminder" }.all { it.time=="" })
        assertTrue(cards.any { it.kind=="task" && "CV" in it.text }); assertEquals(1,cards.count { it.kind=="draft" })
    }
    @Test fun explicitPmAndFallback() {
        assertEquals("16:30",ideas("tomorrow 4:30 pm interview",now).first().time)
        assertEquals("task",ideas("Quarterly notes",now).single().kind)
    }
}
