package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import org.junit.Assert.*
import org.junit.Test

class NativeChatStateTest {
    @Test fun sidebarGroupsPreserveWorkspaceOrderEmptyDirectoriesAndUnregisteredSessions() {
        val workspaces = listOf(NativeWorkspace("w2", "Second", "C:/two"), NativeWorkspace("w1", "", "C:\\first"), NativeWorkspace("empty", "Empty", "/empty"))
        val sessions = listOf(
            NativeSession("s1", "One", "", false, false, cwd = "C:\\first", workspaceId = "w1"),
            NativeSession("s2", "Two", "Second", true, false, cwd = "C:/two", workspaceId = "w2"),
            NativeSession("loose", "Loose", "", false, false, cwd = "/old/directory", workspaceId = "old"),
            NativeSession("scratch", "Scratch", "", false, false),
            NativeSession("archived", "Archived", "", false, true, workspaceId = "w1", archived = true),
        )
        val groups = nativeSessionGroups(workspaces, sessions)
        assertEquals(listOf("Second", "first", "Empty", "directory", "无工作目录"), groups.map { it.title })
        assertEquals(listOf("s2", "s1", "loose", "scratch"), groups.flatMap { it.sessions }.map { it.id })
        assertTrue(groups[2].sessions.isEmpty())
        assertTrue(nativeSessionGroups(emptyList(), emptyList()).isEmpty())
    }
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
    @Test fun rawToolTextAndUserStoppedTurnsRemainDistinctFromFailures() {
        val events = listOf(event(1, "turn/start"),
            event(2, "tool/call", obj("callId" to "actual-tool", "name" to "pwsh", "arguments" to "Start-Sleep -Seconds 50")),
            event(3, "tool/result", obj("message" to obj("source" to obj("callId" to "actual-tool"), "content" to listOf(obj("type" to "text", "text" to "Error: tool call aborted"))))),
            event(4, "turn/end", obj("reason" to obj("kind" to "aborted", "reason" to obj("kind" to "user")))))
        val rows = foldNativeHistory(events)
        assertTrue(rows.first().detail.contains("Error: tool call aborted"))
        assertEquals("meta", rows.last().role)
        assertEquals("已停止", rows.last().text)
        assertTrue(rows.none { it.running || it.role == "error" })
        val failed = foldNativeHistory(listOf(event(5, "turn/end", obj("reason" to obj("kind" to "error", "error" to obj("message" to "Provider disconnected"))))))
        assertEquals("error", failed.single().role)
        assertEquals("Provider disconnected", failed.single().text)
    }
    @Test fun durableImagesInRawAndProjectedHistoryResolveOncePerAttachment() = kotlinx.coroutines.runBlocking {
        val image = obj("type" to "image", "attachment" to obj("attachmentId" to "sha256:test-image", "mediaType" to "image/png"))
        val rows = foldNativeHistory(listOf(event(1, "user/message", obj("id" to "raw", "source" to obj("kind" to "user"), "content" to listOf(image))),
            obj("seqStart" to 2, "item" to obj("type" to "assistant_message", "messageId" to "projected", "content" to listOf(image)))))
        assertEquals(listOf("sha256:test-image", "sha256:test-image"), rows.flatMap { it.images }.map { it.attachmentId })
        val reads = mutableListOf<String>()
        val loaded = resolveHistoryImages(rows) { id ->
            reads += id
            obj("attachment" to obj("attachmentId" to id, "mediaType" to "image/png"), "data" to "image-bytes")
        }
        assertEquals(listOf("sha256:test-image"), reads)
        assertTrue(loaded.flatMap { it.images }.all { it.data == "image-bytes" && it.mediaType == "image/png" })
    }
    @Test fun failedImageDoesNotDiscardAnotherImageAndResolutionPublishesEachResult() = kotlinx.coroutines.runBlocking {
        val rows = listOf(NativeRow("images", "user", "", false, listOf(NativeImage("image/png", "", "bad"), NativeImage("image/png", "", "good"))))
        val published = mutableListOf<NativeImage>()
        val loaded = resolveHistoryImages(rows, { published += it }) { id ->
            if (id == "bad") error("Image bytes missing")
            obj("attachment" to obj("attachmentId" to id, "mediaType" to "image/png"), "data" to "image-bytes")
        }
        assertEquals(listOf("bad", "good"), published.map { it.attachmentId })
        assertEquals("Image bytes missing", loaded.single().images[0].error)
        assertEquals("image-bytes", loaded.single().images[1].data)
        val readAgain = resolveHistoryImages(loaded) { error("completed images must not be fetched again") }
        assertEquals(loaded, readAgain)
    }
    @Test fun historyImageCancellationStopsBeforeTheNextImageAndIsNotRenderedAsFailure() = kotlinx.coroutines.runBlocking {
        val rows = listOf(NativeRow("images", "user", "", false, listOf(NativeImage("image/png", "", "first"), NativeImage("image/png", "", "second"))))
        val reads = mutableListOf<String>()
        val published = mutableListOf<NativeImage>()
        val canceled = kotlinx.coroutines.CancellationException("session switched")
        try {
            resolveHistoryImages(rows, { published += it }) { id -> reads += id; throw canceled }
            fail("image cancellation was swallowed")
        } catch (failure: kotlinx.coroutines.CancellationException) { assertSame(canceled, failure) }
        assertEquals(listOf("first"), reads)
        assertTrue(published.isEmpty())
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
