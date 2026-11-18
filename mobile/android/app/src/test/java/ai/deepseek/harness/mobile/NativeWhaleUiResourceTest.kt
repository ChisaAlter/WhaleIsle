package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.obj
import ai.deepseek.harness.mobile.ui.resolveWhaleUiResource
import ai.deepseek.harness.mobile.ui.whaleUiHttpGetJson
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
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

    @Test
    fun failedResourcesAreReportedAndNotCached() {
        for ((path, query) in listOf(
            "/api/wiki" to obj("title" to "Whale failure regression"),
            "/api/image-search" to obj("q" to "Whale failure regression"),
        )) {
            var calls = 0
            val (failedStatus, failedBody) = resolveWhaleUiResource(path, query) {
                calls += 1
                throw java.io.IOException("Resource service returned HTTP 503")
            }
            assertEquals(502, failedStatus)
            assertTrue(failedBody.toString().contains("HTTP 503"))
            val (retryStatus, _) = resolveWhaleUiResource(path, query) {
                calls += 1
                obj()
            }
            assertEquals(200, retryStatus)
            assertTrue(calls >= 2)
            val callsAfterSuccess = calls
            val (cachedStatus, _) = resolveWhaleUiResource(path, query) {
                calls += 1
                throw java.io.IOException("cached success must not refetch")
            }
            assertEquals(200, cachedStatus)
            assertEquals(callsAfterSuccess, calls)
        }
    }

    @Test
    fun httpFailuresAndMalformedResponsesDoNotBecomeEmptySuccesses() {
        for ((code, body) in listOf(503 to "{}", 200 to "invalid JSON", 200 to "[]", 200 to "")) {
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(code).message("fixture").body(body.toResponseBody()).build()
            }.build()
            assertThrows(Exception::class.java) {
                whaleUiHttpGetJson("https://resource.invalid/", client)
            }
        }
        val client = OkHttpClient.Builder().addInterceptor {
            throw java.io.IOException("fixture disconnected")
        }.build()
        assertThrows(java.io.IOException::class.java) {
            whaleUiHttpGetJson("https://resource.invalid/", client)
        }
    }
}
