package com.jarvis.agent.inbox

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal data class Follow(val id: String, val group: String, val kind: String, val text: String, val state: String)
internal class FollowStore(context: Context): SQLiteOpenHelper(context,"followups.db",null,1) {
    override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE follow(id TEXT PRIMARY KEY, topic TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL)") }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun insert(items: List<Follow>) {
        val db=writableDatabase; db.beginTransaction()
        try { for (e in items) db.insertOrThrow("follow",null, ContentValues().apply {
            put("id",e.id);put("topic",e.group);put("kind",e.kind);put("body",e.text);put("state",e.state)
        }); db.setTransactionSuccessful() } finally { db.endTransaction() }
    }
    fun status(id: String,state: String) { writableDatabase.update("follow", ContentValues().apply { put("state",state) },"id=? AND state!='done'",arrayOf(id)) }
    fun pending(): List<Follow> = readableDatabase.rawQuery("SELECT id,topic,kind,body,state FROM follow WHERE state!='done' ORDER BY rowid DESC",null).use { c ->
        buildList { while(c.moveToNext()) add(Follow(c.getString(0),c.getString(1),c.getString(2),c.getString(3),c.getString(4))) }
    }
}
