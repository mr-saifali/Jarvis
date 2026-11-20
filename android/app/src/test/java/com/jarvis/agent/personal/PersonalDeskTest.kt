package com.jarvis.agent.personal

import org.junit.Assert.*
import org.junit.Test

class PersonalDeskTest {
    @Test fun budgetPrioritizesImportantTasksAndNeverDuplicates() {
        val tasks = listOf(Entry(1,"Long",18), Entry(2,"Urgent",12,true), Entry(3,"Short",7), Entry(4,"Note"))
        assertEquals(listOf(2,3), focusPlan(tasks,20).map { it.id })
        assertTrue(focusPlan(tasks,5).isEmpty())
    }
    @Test fun planningDoesNotCompleteTasksAndRecallIsCaseInsensitive() {
        val desk = answer(answer(Desk(),"yaad rakho: Bike in B2").desk,"task! 15: pay bill").desk
        assertTrue(answer(desk,"find b2 bike").text.contains("Bike in B2"))
        val plan = answer(desk,"mere paas 25 min hain")
        assertSame(desk,plan.desk)
        assertTrue(plan.text.contains("pay bill"))
        assertSame(desk,answer(desk,"done #1").desk)
        assertEquals(listOf(1),answer(desk,"done #2").desk.entries.map { it.id })
        assertSame(desk,answer(desk,"task 0: invalid").desk)
    }
}
