package com.jarvis.agent.service

import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.jarvis.agent.data.JarvisLogStore
import kotlinx.coroutines.delay

class JarvisAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: JarvisAccessibilityService? = null
            private set

        @Volatile
        var lastForegroundPackage: String = ""
            private set

        fun isReady(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        JarvisLogStore.append("Accessibility Service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString()
        if (!pkg.isNullOrBlank()) {
            lastForegroundPackage = pkg
        }
    }

    override fun onInterrupt() {
        JarvisLogStore.append("Accessibility Service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance === this) instance = null
    }

    fun goHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    fun goBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)

    fun openRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)

    fun openNotificationsShade(): Boolean = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)

    fun openQuickSettings(): Boolean = performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)

    fun lockScreen(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
        } else {
            false
        }
    }

    fun takeScreenshotAction(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
        } else {
            false
        }
    }

    fun scroll(down: Boolean): Boolean {
        val root = rootInActiveWindow ?: return false
        val scrollable = findScrollableNode(root) ?: return false
        val action = if (down) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        }
        return scrollable.performAction(action)
    }

    fun clickNodeByText(targetText: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val matches = root.findAccessibilityNodeInfosByText(targetText)
        for (node in matches) {
            if (clickSelfOrParent(node)) return true
        }
        val byDesc = findNodeByDescription(root, targetText)
        if (byDesc != null && clickSelfOrParent(byDesc)) return true
        return false
    }

    fun typeTextIntoFocusedOrEditable(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val target = findEditableNode(root) ?: return false
        target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    suspend fun sendWhatsAppMessage(recipient: String, message: String): Boolean {
        delay(900)
        var openedChat = false
        if (recipient.isNotBlank()) {
            // Try clicking visible contact first
            openedChat = clickNodeByText(recipient)
            if (!openedChat) {
                // Tap WhatsApp Search icon / bar and search for recipient
                val tappedSearch = clickNodeByText("Search") ||
                    clickNodeByText("Ask Meta AI or Search") ||
                    typeTextIntoFocusedOrEditable(recipient)
                if (tappedSearch) {
                    delay(500)
                    typeTextIntoFocusedOrEditable(recipient)
                    delay(900)
                    // Click the matching contact row (skip the first match if it's the search box itself)
                    openedChat = clickNonEditableNodeByText(recipient) || clickNodeByText(recipient)
                }
            }
            if (openedChat) delay(700)
        }

        val typed = typeTextIntoFocusedOrEditable(message)
        if (!typed) return false
        delay(450)
        return clickNodeByText("Send")
    }

    private fun clickNonEditableNodeByText(targetText: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val matches = root.findAccessibilityNodeInfosByText(targetText)
        for (node in matches) {
            if (!node.isEditable && clickSelfOrParent(node)) return true
        }
        return false
    }

    private fun clickSelfOrParent(node: AccessibilityNodeInfo?): Boolean {
        var current = node
        while (current != null) {
            if (current.isClickable) {
                return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            current = current.parent
        }
        return false
    }

    private fun findEditableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable) return node
        for (i in 0 until node.childCount) {
            val found = findEditableNode(node.getChild(i))
            if (found != null) return found
        }
        return null
    }

    private fun findScrollableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val found = findScrollableNode(node.getChild(i))
            if (found != null) return found
        }
        return null
    }

    private fun findNodeByDescription(node: AccessibilityNodeInfo?, query: String): AccessibilityNodeInfo? {
        if (node == null) return null
        val desc = node.contentDescription?.toString().orEmpty()
        if (desc.contains(query, ignoreCase = true)) return node
        for (i in 0 until node.childCount) {
            val found = findNodeByDescription(node.getChild(i), query)
            if (found != null) return found
        }
        return null
    }
}
