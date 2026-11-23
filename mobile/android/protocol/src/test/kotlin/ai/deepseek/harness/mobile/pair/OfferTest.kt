package ai.deepseek.harness.mobile.pair

import ai.deepseek.harness.mobile.remote.SavedComputer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class OfferTest {
    private fun b64url(json: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))

    @Test
    fun decodeOfferReadsV2RelayAndBootstrap() {
        val offer = OfferCodec.decode(
            b64url(
                """{"v":2,"serverId":"server-1","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false},"authBootstrap":{"version":1,"pairingToken":"one-time-token-123","expiresAtMs":1787817600000}}""",
            ),
        )
        assertEquals(2, offer?.v)
        assertEquals("server-1", offer?.serverId)
        assertEquals("daemon-key", offer?.daemonPublicKeyB64)
        assertEquals("125.124.85.212:8411", offer?.relay?.endpoint)
        assertEquals(false, offer?.relay?.useTls)
        assertEquals("one-time-token-123", offer?.authBootstrap?.pairingToken)
    }

    @Test
    fun fromHashReadsV2OfferAndRejectsV1() {
        val raw = b64url(
            """{"v":2,"serverId":"server-1","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"relay.example:443","useTls":true}}""",
        )
        assertEquals("server-1", OfferCodec.fromHash("#offer=$raw")?.serverId)
        assertEquals("server-1", OfferCodec.fromHash("?token=leaked#offer=$raw")?.serverId)
        assertNull(OfferCodec.fromHash("#nope=1"))
        assertNull(OfferCodec.decode("%%%"))
        assertNull(OfferCodec.decode(b64url("""{"v":1,"token":"x","mode":"lan"}""")))
    }

    @Test
    fun fromPasteReadsUrlHashOrBareV2Offer() {
        val raw = b64url(
            """{"v":2,"serverId":"server-2","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"relay.example:443"}}""",
        )
        assertEquals("server-2", OfferCodec.fromPaste("http://192.168.1.8:3180/#offer=$raw")?.serverId)
        assertEquals("server-2", OfferCodec.fromPaste("#offer=$raw")?.serverId)
        assertEquals("server-2", OfferCodec.fromPaste("offer=$raw")?.serverId)
        assertNull(OfferCodec.fromPaste("https://relay.example/"))
    }

    @Test
    fun pairingLinkRequiresFullHttpUrlAndPreservesOfferFragment() {
        val raw = b64url(
            """{"v":2,"serverId":"server-3","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false}}""",
        )
        val url = "http://192.168.1.8:3180/#offer=$raw"
        val link = OfferCodec.parsePairingLink(url)
        assertEquals(url, link?.url)
        assertEquals("http://192.168.1.8:3180/", link?.landingUrl)
        assertEquals("server-3", link?.offer?.serverId)
        assertNull(OfferCodec.parsePairingLink("#offer=$raw"))
        assertNull(OfferCodec.parsePairingLink("javascript:alert(1)#offer=$raw"))
        assertNull(OfferCodec.parsePairingLink("http://user@192.168.1.8:3180/#offer=$raw"))
        assertNull(OfferCodec.parsePairingLink("$url&unexpected=1"))
    }

    @Test
    fun parsePairingLinkReadsAwayPublicSpaQrWithDshdPath() {
        val raw = b64url(
            """{"v":2,"serverId":"server-away","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false}}""",
        )
        val url = "http://125.124.85.212:3389/dshd/#offer=$raw"
        val link = OfferCodec.parsePairingLink(url)
        assertEquals("server-away", link?.offer?.serverId)
    }

    @Test
    fun persistentLinkExtensionKeepsV2HandshakeAndSavedCredentialOfferCompatible() {
        val raw = b64url(
            """{"v":2,"serverId":"server-persistent","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"ayase.cn:443","useTls":true},"authBootstrap":{"version":1,"kind":"persistent","pairingToken":"persistent-test-link-token","expiresAtMs":253402300799999}}""",
        )
        val offer = OfferCodec.parsePairingLink("https://ayase.cn/dshd/#offer=$raw")?.offer
        assertEquals("server-persistent", offer?.serverId)
        assertEquals("persistent-test-link-token", offer?.authBootstrap?.pairingToken)
        assertEquals(253402300799999L, offer?.authBootstrap?.expiresAtMs)
        val saved = ai.deepseek.harness.mobile.remote.SavedComputer("server-persistent", "device", "device-secret", "daemon-key", "ayase.cn:443", true)
        assertNull(saved.offer().authBootstrap)
        assertEquals(offer?.relay, saved.offer().relay)
    }

    @Test
    fun decodeRejectsMalformedV2SchemaFields() {
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"","daemonPublicKeyB64":"key","relay":{"endpoint":"relay:443"}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","relay":{"endpoint":"","useTls":false}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","relay":{"endpoint":"relay:443","useTls":"yes"}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","relay":{"endpoint":"relay:443"},"authBootstrap":{"version":1,"pairingToken":"short","expiresAtMs":1}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key"}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","lan":{"endpoints":[]}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","lan":{"endpoints":["192.168.1.10:3180"],"useTls":"no"}}"""),
            ),
        )
        assertNull(
            OfferCodec.decode(
                b64url("""{"v":2,"serverId":"s","daemonPublicKeyB64":"key","relay":{"endpoint":"relay:443"},"iceServers":[{"urls":123}]}"""),
            ),
        )
    }

    @Test
    fun decodeSupportsLanOnlyAndIceServersStringOrArrayUrls() {
        val lanOnly = OfferCodec.decode(
            b64url(
                """{"v":2,"serverId":"lan-srv","daemonPublicKeyB64":"daemon-key","lan":{"endpoints":["192.168.1.10:3180","10.0.0.5:3180"],"useTls":false}}""",
            ),
        )
        assertNotNull(lanOnly)
        assertNull(lanOnly?.relay)
        assertEquals(listOf("192.168.1.10:3180", "10.0.0.5:3180"), lanOnly?.lan?.endpoints)
        assertEquals(false, lanOnly?.lan?.useTls)

        val full = OfferCodec.decode(
            b64url(
                """{"v":2,"serverId":"hybrid-srv","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"ayase.cn:443","useTls":true},"lan":{"endpoints":["192.168.1.10:3180"],"useTls":true},"iceServers":[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:turn.example:3478?transport=tcp","turns:turn.example:5349"],"username":"u1","credential":"p1"}]}""",
            ),
        )
        assertNotNull(full)
        assertEquals("ayase.cn:443", full?.relay?.endpoint)
        assertEquals(listOf("192.168.1.10:3180"), full?.lan?.endpoints)
        assertEquals(true, full?.lan?.useTls)
        assertEquals(2, full?.iceServers?.size)
        assertEquals(listOf("stun:stun.cloudflare.com:3478"), full?.iceServers?.get(0)?.urls)
        assertEquals(listOf("turn:turn.example:3478?transport=tcp", "turns:turn.example:5349"), full?.iceServers?.get(1)?.urls)
        assertEquals("u1", full?.iceServers?.get(1)?.username)
        assertEquals("p1", full?.iceServers?.get(1)?.credential)
    }

    @Test
    fun savedComputerDeserializesLegacyJsonAndPreservesLanOnlyOffer() {
        val legacyJson = """{"serverId":"s1","deviceId":"d1","deviceSecret":"sec","daemonPublicKeyB64":"key","relayEndpoint":"ayase.cn:443","relayUseTls":true,"computerName":"Desktop","savedAt":100}"""
        val legacy = Json.decodeFromString(SavedComputer.serializer(), legacyJson)
        assertEquals("ayase.cn:443", legacy.relayEndpoint)
        assertEquals(emptyList<String>(), legacy.lanEndpoints)
        assertEquals(emptyList<IceServerConfig>(), legacy.iceServers)
        assertNull(legacy.offer().lan)
        assertEquals("ayase.cn:443", legacy.offer().relay?.endpoint)

        val lanSaved = SavedComputer(
            serverId = "s-lan",
            deviceId = "d2",
            deviceSecret = "sec2",
            daemonPublicKeyB64 = "key2",
            relayEndpoint = "",
            relayUseTls = false,
            lanEndpoints = listOf("192.168.1.20:3180"),
            lanUseTls = false,
            iceServers = listOf(IceServerConfig(listOf("stun:stun.l.google.com:19302"))),
        )
        val lanOffer = lanSaved.offer()
        assertNull(lanOffer.relay)
        assertEquals(listOf("192.168.1.20:3180"), lanOffer.lan?.endpoints)
        assertEquals(1, lanOffer.iceServers.size)
    }

    @Test
    fun iceServerConfigCodecParsesJsonAndPlainUrlsAndRejectsInvalidSchemes() {
        val fromJson = IceServerConfigCodec.parseUserInput(
            """[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:t.example:3478"],"username":"u","credential":"c"}]""",
        )
        assertEquals(2, fromJson.size)
        assertEquals(listOf("stun:stun.cloudflare.com:3478"), fromJson[0].urls)
        assertEquals("u", fromJson[1].username)

        val fromLines = IceServerConfigCodec.parseUserInput("stun:stun.cloudflare.com:3478\nturn:t.example:3478")
        assertEquals(1, fromLines.size)
        assertEquals(listOf("stun:stun.cloudflare.com:3478", "turn:t.example:3478"), fromLines[0].urls)

        assertEquals(emptyList<IceServerConfig>(), IceServerConfigCodec.parseUserInput("   "))
        assertThrows(IllegalArgumentException::class.java) {
            IceServerConfigCodec.parseUserInput("http://not-stun.example")
        }
    }
}
