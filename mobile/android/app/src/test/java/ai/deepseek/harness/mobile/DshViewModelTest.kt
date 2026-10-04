package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.store.DeviceStore
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DshViewModelTest {
    @Before fun mainDispatcher() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun resetDispatcher() { Dispatchers.resetMain() }
    @Test fun oldLandingTriggersMigrationAndBareLandingNeverChangesRoute() {
        val store = FakeStore(webAppUrl="https://appassets.androidplatform.net/assets/web/index.html")
        val vm = DshViewModel(store)
        assertTrue(vm.needsLegacyMigration)
        assertEquals(Route.Connect,vm.route)
        assertEquals(1,store.legacyClearCalls)
        vm.openPairingLink("android.intent.action.VIEW","http://192.168.1.8:3180/")
        assertEquals(Route.Connect,vm.route)
        assertTrue(vm.error.contains("配对密钥"))
        assertEquals("[]",store.computersJson)
        vm.route=Route.Chat
        vm.openPairingLink("android.intent.action.VIEW","http://192.168.1.8:3180/")
        assertEquals(Route.Chat,vm.route)
    }
    @Test fun migrationPreservesExistingNativeSecretsAndDraftsAndImportsEveryLegacyComputer() {
        val existing=SavedComputer("computer1","native-device","native-secret","key","relay:443",true,"Native computer")
        val store=FakeStore(computersJson=Json.encodeToString(listOf(existing)),draftsJson="""{"computer1/s1":"new draft"}""")
        val vm=DshViewModel(store)
        vm.route=Route.Scan // Import data without opening a network connection in this store test.
        val legacy=obj("computer1" to obj("deviceId" to "old-device","deviceSecret" to "old-secret","daemonPublicKeyB64" to "key","relayEndpoint" to "relay:443","useTls" to true),
            "computer2" to obj("deviceId" to "other-device","deviceSecret" to "other-secret","daemonPublicKeyB64" to "key","relayEndpoint" to "relay:80","useTls" to false,"computerName" to "Second"))
        vm.importLegacy(obj("computers" to legacy.toString(),"drafts" to obj("computer1" to obj("s1" to "old draft","s2" to "older draft").toString(),
            "computer2" to obj("s1" to "other computer draft").toString())).toString())
        val computers=Json.decodeFromString<List<SavedComputer>>(store.computersJson)
        assertEquals(2,computers.size)
        assertEquals("native-secret",computers.find {it.serverId=="computer1"}!!.deviceSecret)
        assertFalse(computers.find {it.serverId=="computer2"}!!.relayUseTls)
        val drafts=Json.parseToJsonElement(store.draftsJson).objectValue()
        assertEquals("new draft",drafts.string("computer1/s1"))
        assertEquals("older draft",drafts.string("computer1/s2"))
        assertEquals("other computer draft",drafts.string("computer2/s1"))
        assertTrue(store.nativeMigrationDone)
    }
    @Test fun sessionDraftsAndLateImagesKeepTheirOwnerEvenWhileOffline() {
        val store=FakeStore(selectedComputer="computer")
        val vm=DshViewModel(store)
        vm.openSession("s1")
        vm.onChatAction(NativeChatAction("draft","s1",text="first draft"))
        vm.addImage("computer","s1",NativeImage("image/png","first-image"))
        vm.openSession("s2")
        vm.onChatAction(NativeChatAction("draft","s1",text="late overwrite"))
        vm.addImage("computer","s1",NativeImage("image/png","late-image"))
        vm.addImage("other-computer","s2",NativeImage("image/png","wrong-computer"))
        assertTrue(vm.chat.attachments.isEmpty())
        vm.onChatAction(NativeChatAction("draft","s2",text="second draft"))
        vm.openSession("s1")
        assertEquals("first draft",vm.chat.draft)
        assertEquals(listOf("first-image"),vm.chat.attachments.map {it.data})
        vm.openSession("s2")
        assertEquals("second draft",vm.chat.draft)
        assertEquals("first draft",Json.parseToJsonElement(store.draftsJson).objectValue().string("computer/s1"))
    }
    @Test fun scanPasteActionFocusesNativePasteEntry() {
        val vm=DshViewModel(FakeStore()); vm.route=Route.Scan; vm.openPasteEntry()
        assertEquals(Route.Connect,vm.route); assertTrue(vm.pasteExpanded); assertEquals(1L,vm.pasteFocusRequestId)
    }
    private class FakeStore(
        override var webAppUrl:String="",override var scheme:String="system",override var computersJson:String="[]",
        override var draftsJson:String="{}",override var selectedComputer:String="",override var nativeMigrationDone:Boolean=false
    ):DeviceStore { var legacyClearCalls=0; override fun clearLegacyHttpCredentials() {legacyClearCalls++} }
}
