package com.jarvis.agent.personal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class DeskStore(context: Context) {
    private val prefs = context.getSharedPreferences("personal_desk", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val alias = "jarvis.personal.desk.v1"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    companion object { private val lock = Any() }
    fun run(input: String): String = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val stored = prefs.getString("data", null)
        val desk = if (stored == null) Desk() else {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            val obj = JSONObject(String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8))
            val rows = obj.getJSONArray("items")
            Desk(obj.getInt("next"), (0 until rows.length()).map { i -> rows.getJSONArray(i).let { Entry(it.getInt(0), it.getString(1), it.getInt(2), it.getBoolean(3)) } })
        }
        val result = answer(desk, input)
        if (result.desk !== desk) {
            val rows = JSONArray()
            result.desk.entries.forEach { rows.put(JSONArray().put(it.id).put(it.text).put(it.minutes).put(it.important)) }
            val plain = JSONObject().put("next", result.desk.nextId).put("items", rows).toString()
            cipher.init(Cipher.ENCRYPT_MODE, key())
            check(cipher.iv.size == 12)
            val encrypted = Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
            check(prefs.edit().putString("data", encrypted).commit())
        }
        result.text
    }
}
