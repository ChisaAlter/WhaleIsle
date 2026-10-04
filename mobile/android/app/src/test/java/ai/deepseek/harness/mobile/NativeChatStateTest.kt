package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import org.junit.Assert.*
import org.junit.Test

class NativeChatStateTest {
    private fun event(seq:Long,type:String,data:kotlinx.serialization.json.JsonObject=obj())=obj("event" to obj("seq" to seq,"type" to type,"data" to data))
    private fun user(seq:Long)=event(seq,"user/message",obj("id" to "user-$seq","source" to obj("kind" to "user"),"content" to listOf(obj("type" to "text","text" to "message-$seq"))))
    @Test fun olderPagesRemainVisibleBeyondTwoHundredRowsAndRefreshDeduplicatesOverlap() {
        val current=(21L..220L).map(::user)
        val loaded=mergeHistory((1L..25L).map(::user),current)
        val refreshed=mergeHistory(loaded,(180L..230L).map(::user)).sortedBy(::historySeq)
        val rows=foldNativeHistory(refreshed)
        assertEquals(230,rows.size); assertEquals("message-1",rows.first().text); assertEquals("message-230",rows.last().text)
    }
    @Test fun streamedReasoningAndTextAreReplacedByFinalMessageAndToolOutputRemainsVisible() {
        val events=listOf(event(1,"turn/start"),event(2,"assistant/chunk",obj("chunk" to obj("type" to "reasoning-delta","index" to 0,"text" to "thinking"))),
            event(3,"assistant/chunk",obj("chunk" to obj("type" to "text-delta","index" to 1,"text" to "partial"))))
        assertEquals(listOf("thinking","partial"),foldNativeHistory(events).map {it.text})
        assertTrue(foldNativeHistory(events).last().running)
        val completed=events+listOf(event(4,"assistant/message",obj("id" to "answer","message" to obj("content" to listOf(obj("type" to "text","text" to "final answer"))))),
            event(5,"tool/call",obj("callId" to "call","name" to "shell","arguments" to "pwd")),
            event(6,"tool/result",obj("message" to obj("source" to obj("callId" to "call"),"content" to listOf(obj("type" to "tool-result","content" to listOf(obj("type" to "text","text" to "C:/repo"))))))),
            event(7,"turn/end",obj("reason" to obj("kind" to "error","error" to obj("message" to "Provider disconnected")))))
        val rows=foldNativeHistory(completed)
        assertEquals(listOf("final answer","shell","Provider disconnected"),rows.map {it.text})
        assertTrue(rows[1].detail.contains("C:/repo")); assertTrue(rows.none {it.running})
    }
    @Test fun historyApprovalsResolveIndividuallyAndProjectedItemsHaveStableIds() {
        val pending=listOf(event(1,"approval/asked",obj("id" to "a","toolName" to "shell","reason" to "rm file")),
            event(2,"approval/asked",obj("id" to "b","toolName" to "write")),event(3,"approval/decided",obj("id" to "a")))
        assertEquals(listOf("b"),historyApprovals(pending).map {it.id})
        val rows=foldNativeHistory(listOf(obj("seqStart" to 0,"item" to obj("type" to "user_message","messageId" to "u","text" to "native")),
            obj("seqStart" to 2,"item" to obj("type" to "todo","items" to listOf(obj("text" to "Ship","completed" to true))))))
        assertEquals("u",rows.first().id); assertEquals("✓ Ship",rows.last().text)
    }
}
