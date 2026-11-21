package com.jarvis.agent.personal

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MissionTest {
    @Test fun failureStopsLaterSteps() = runBlocking {
        val events=mutableListOf<Pair<Int,String>>()
        var calls=0
        assertFalse(runMission(phoneMissions.first(), { i,s -> events.add(i to s) }) { ++calls < 2 })
        assertEquals(2,calls)
        assertEquals(listOf(0 to "Running",0 to "Dispatched",1 to "Running",1 to "Failed",2 to "Skipped"),events)
    }
    @Test fun eachMissionUsesItsPreviewOrder() = runBlocking {
        for(m in phoneMissions) {
            val ran=mutableListOf<MissionStep>()
            assertTrue(runMission(m,{_,_->}) { ran.add(it); true }); assertEquals(m.steps,ran)
        }
    }
}
