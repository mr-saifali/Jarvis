package com.jarvis.agent.personal

import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Minimal WordprocessingML package; user text is never interpreted as markup. */
internal fun writeDocument(output: OutputStream, title: String, body: String) {
    fun xml(text: String) = text.filter { it == '\t' || it >= ' ' }.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    ZipOutputStream(output).use { zip ->
        fun part(name: String, content: String) {
            zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray(Charsets.UTF_8)); zip.closeEntry()
        }
        part("[Content_Types].xml", """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>""")
        part("_rels/.rels", """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>""")
        val paragraphs = (listOf(title) + body.lines()).joinToString("") { "<w:p><w:r><w:t xml:space=\"preserve\">${xml(it)}</w:t></w:r></w:p>" }
        part("word/document.xml", """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$paragraphs<w:sectPr/></w:body></w:document>""")
    }
}
