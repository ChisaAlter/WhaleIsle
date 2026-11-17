package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.obj
import ai.deepseek.harness.mobile.ui.resolveWhaleUiResource
import org.junit.Assert.*
import org.junit.Test

class NativeWhaleUiResourceTest {
    @Test
    fun wikiRejectsInvalidTitle() {
        val (emptyStatus, _) = resolveWhaleUiResource("/api/wiki", obj("title" to ""))
        assertEquals(400, emptyStatus)
        val (longStatus, _) = resolveWhaleUiResource("/api/wiki", obj("title" to "x".repeat(201)))
        assertEquals(400, longStatus)
        val (missingStatus, _) = resolveWhaleUiResource("/api/wiki", null)
        assertEquals(400, missingStatus)
    }

    @Test
    fun imageSearchRejectsInvalidQuery() {
        val (shortStatus, _) = resolveWhaleUiResource("/api/image-search", obj("q" to "a"))
        assertEquals(400, shortStatus)
        val (longStatus, _) = resolveWhaleUiResource("/api/image-search", obj("q" to "x".repeat(201)))
        assertEquals(400, longStatus)
    }

    @Test
    fun streetRouteRejectsInvalidCoordinates() {
        val (onePoint, _) = resolveWhaleUiResource("/api/street-route", obj("coords" to "10.0,20.0"))
        assertEquals(400, onePoint)
        val (nonNumeric, _) = resolveWhaleUiResource("/api/street-route", obj("coords" to "a,b;c,d"))
        assertEquals(400, nonNumeric)
        val (triplet, _) = resolveWhaleUiResource("/api/street-route", obj("coords" to "1,2,3;4,5,6"))
        assertEquals(400, triplet)
        val tooMany = (1..26).joinToString(";") { "$it,$it" }
        val (tooManyStatus, _) = resolveWhaleUiResource("/api/street-route", obj("coords" to tooMany))
        assertEquals(400, tooManyStatus)
    }

    @Test
    fun unknownPathReturns404() {
        val (status, body) = resolveWhaleUiResource("/api/nope", null)
        assertEquals(404, status)
        assertTrue(body.toString().contains("Unknown resource path"))
    }
}
