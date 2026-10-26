package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.obj
import ai.deepseek.harness.mobile.ui.NativeSessionUsage
import ai.deepseek.harness.mobile.ui.nativeQueuedMessages
import ai.deepseek.harness.mobile.ui.nativeSessionUsage
import org.junit.Assert.*
import org.junit.Test

class NativeSessionDataTest {
    @Test fun identifiedUserMessagesKeepTargetOrderAndExactTextWhileOtherSourcesHaveNoControls() {
        val values = obj("inbox" to obj(
            "next-turn" to listOf(
                obj("id" to "turn", "source" to obj("kind" to "user"), "content" to listOf(
                    obj("type" to "text", "text" to "first line"), obj("type" to "text", "text" to "第二行"))),
                obj("id" to "system", "source" to obj("kind" to "system-prompt"), "content" to listOf(obj("type" to "text", "text" to "system notice"))),
                obj("source" to obj("kind" to "user"), "content" to listOf(obj("type" to "text", "text" to "no identity"))),
                obj("id" to "", "source" to obj("kind" to "user"), "content" to emptyList<Any>()),
            ),
            "next-step" to listOf(obj("id" to "step", "source" to obj("kind" to "user", "rpcId" to "rpc"), "content" to listOf(obj("type" to "text", "text" to "steering text")))),
        ))
        val queue = nativeQueuedMessages(values)
        assertEquals(listOf("turn", "step"), queue.map { it.id })
        assertEquals(listOf("next-turn", "next-step"), queue.map { it.target })
        assertEquals("first line\n第二行", queue[0].text)
        assertTrue(queue.all { it.editable && !it.hasAttachments })
    }

    @Test fun imageAndOtherNonTextContentRemainIdentifiedButCannotBeReplacedByTextEdits() {
        val values = obj("inbox" to obj("next-turn" to listOf(
            obj("id" to "image", "source" to obj("kind" to "user"), "content" to listOf(
                obj("type" to "text", "text" to "caption"), obj("type" to "image", "attachment" to obj("attachmentId" to "test-image")))),
            obj("id" to "file", "source" to obj("kind" to "user"), "content" to listOf(obj("type" to "file", "name" to "qa.txt"))),
            obj("id" to "empty", "source" to obj("kind" to "user"), "content" to emptyList<Any>()),
        )))
        val queue = nativeQueuedMessages(values)
        assertEquals(listOf("image", "file", "empty"), queue.map { it.id })
        assertEquals("caption", queue[0].text)
        assertTrue(queue.take(2).all { it.hasAttachments && !it.editable })
        assertFalse(queue[2].editable)
        assertFalse(queue[2].hasAttachments)
        assertTrue(nativeQueuedMessages(obj()).isEmpty())
    }

    @Test fun missingIncompleteAndInvalidUsageRemainAbsentInsteadOfZeroTotals() {
        assertNull(nativeSessionUsage(obj()))
        assertNull(nativeSessionUsage(obj("usagePanel" to obj())))
        assertNull(nativeSessionUsage(obj("usagePanel" to obj("totals" to obj("input" to 5L, "output" to 2L)))))
        assertNull(nativeSessionUsage(obj("usagePanel" to obj("totals" to obj("input" to -1L, "output" to 2L, "cacheRead" to 0L, "cacheWrite" to 0L)))))
        assertNull(nativeSessionUsage(obj("usagePanel" to obj("totals" to obj("input" to 1.5, "output" to 2L, "cacheRead" to 0L, "cacheWrite" to 0L)))))
    }

    @Test fun reportedUsageKeepsLongPrecisionAndRealZeroTotals() {
        assertEquals(NativeSessionUsage(3_000_000_000L, 41L, 9L, 0L), nativeSessionUsage(obj("usagePanel" to obj(
            "totals" to obj("input" to 3_000_000_000L, "output" to 41L, "cacheRead" to 9L, "cacheWrite" to 0L),
        ))))
        assertEquals(NativeSessionUsage(0L, 0L, 0L, 0L), nativeSessionUsage(obj("usagePanel" to obj(
            "totals" to obj("input" to 0L, "output" to 0L, "cacheRead" to 0L, "cacheWrite" to 0L),
        ))))
    }
}
