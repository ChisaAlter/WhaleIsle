package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import ai.deepseek.harness.mobile.remote.RelayClient
import ai.deepseek.harness.mobile.remote.SavedComputer
import ai.deepseek.harness.mobile.remote.TransportMode
import ai.deepseek.harness.mobile.remote.obj
import ai.deepseek.harness.mobile.store.DeviceStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
class DshViewModelTransportTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun transportModeTransitionsUpdateUiStateAndClearOnDisconnect() = runTest(dispatcher) {
        val key = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        val saved = SavedComputer("srv-1", "dev-1", "secret-1", key, "ayase.cn:443", true, "My Desktop")
        val store = MemoryDeviceStore(computersJson = Json.encodeToString(listOf(saved)), selectedComputer = "srv-1")
        lateinit var relay: FakeTransportRelay

        val vm = DshViewModel(store) { offer, cred, _, persist, mux, _ ->
            FakeTransportRelay(offer, cred, persist, mux).also { relay = it }
        }
        vm.start()
        runCurrent()

        assertEquals(Route.Chat, vm.route)
        assertEquals(TransportMode.RELAY, vm.transportMode)
        assertEquals("服务器中继", vm.chat.transportLabel)

        relay.transportMode.value = TransportMode.P2P
        runCurrent()
        assertEquals(TransportMode.P2P, vm.transportMode)
        assertEquals("P2P 直连", vm.chat.transportLabel)

        relay.transportMode.value = TransportMode.TURN
        runCurrent()
        assertEquals(TransportMode.TURN, vm.transportMode)
        assertEquals("TURN 中继", vm.chat.transportLabel)

        relay.transportMode.value = TransportMode.LAN
        runCurrent()
        assertEquals(TransportMode.LAN, vm.transportMode)
        assertEquals("局域网直连", vm.chat.transportLabel)

        vm.leaveComputer()
        advanceUntilIdle()
        assertNull(vm.transportMode)
        assertEquals("", vm.chat.transportLabel)
    }

    @Test
    fun saveIceConfigValidatesPersistsAndClearsEncryptedStore() = runTest(dispatcher) {
        val store = MemoryDeviceStore()
        val vm = DshViewModel(store)

        val err = vm.saveIceConfig("http://invalid-scheme.example")
        assertNotNull(err)
        assertEquals("", store.iceConfigJson)

        val ok1 = vm.saveIceConfig("""[{"urls":"turn:turn.example:3478?transport=tcp","username":"u","credential":"p"}]""")
        assertNull(ok1)
        assertEquals(store.iceConfigJson, vm.iceConfigJson)
        assert(store.iceConfigJson.contains("turn:turn.example:3478?transport=tcp"))

        val ok2 = vm.saveIceConfig("")
        assertNull(ok2)
        assertEquals("", store.iceConfigJson)
        assertEquals("", vm.iceConfigJson)
    }

    private class MemoryDeviceStore(
        override var webAppUrl: String = "",
        override var scheme: String = "system",
        override var computersJson: String = "[]",
        override var draftsJson: String = "{}",
        override var selectedComputer: String = "",
        override var nativeMigrationDone: Boolean = true,
        override var catalogCacheJson: String = "{}",
        override var iceConfigJson: String = "",
    ) : DeviceStore {
        override fun clearLegacyHttpCredentials() {}
    }

    private class FakeTransportRelay(
        offer: Offer,
        saved: SavedComputer?,
        persist: (SavedComputer) -> Unit,
        mux: (JsonObject) -> Unit,
    ) : RelayClient(offer, saved, "test phone", persist, mux, {}) {
        override val status = MutableStateFlow("已连接")
        override val transportMode = MutableStateFlow<TransportMode?>(TransportMode.RELAY)
        private val ended = CompletableDeferred<Throwable>()

        override suspend fun connect() {
            connected = true
            transportMode.value = TransportMode.RELAY
        }

        override suspend fun awaitDisconnect(): Throwable = ended.await()
        override fun subscribe() {}
        override fun close() {
            connected = false
            ended.complete(CancellationException("closed"))
            super.close()
        }

        override suspend fun host(method: String, payload: JsonObject): JsonElement = when (method) {
            "session.list" -> obj("items" to emptyList<JsonObject>())
            "workspace.list" -> obj("items" to emptyList<JsonObject>())
            else -> obj()
        }
    }
}
