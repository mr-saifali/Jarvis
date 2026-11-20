package com.jarvis.agent.service

import android.content.Context
import android.speech.tts.TextToSpeech
import com.jarvis.agent.data.JarvisLogStore
import java.util.Locale

object JarvisVoiceEngine {
    @Volatile
    private var tts: TextToSpeech? = null
    @Volatile
    private var ready = false

    fun init(context: Context) {
        if (tts != null) return
        val appCtx = context.applicationContext
        tts = TextToSpeech(appCtx) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val engine = tts ?: return@TextToSpeech
                val ukResult = engine.setLanguage(Locale.UK)
                if (ukResult == TextToSpeech.LANG_MISSING_DATA || ukResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                    engine.setLanguage(Locale.US)
                }
                engine.setPitch(0.95f)
                engine.setSpeechRate(1.03f)
                ready = true
            }
        }
    }

    fun speak(context: Context, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        init(context)
        if (ready) {
            tts?.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "jarvis_${System.currentTimeMillis()}")
            JarvisLogStore.append("Jarvis spoke: \"$clean\"")
        } else {
            JarvisLogStore.append("TTS initializing for: \"$clean\"")
        }
    }
}
