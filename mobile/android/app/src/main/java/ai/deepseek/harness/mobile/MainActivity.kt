package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.store.EncryptedDeviceStore
import ai.deepseek.harness.mobile.ui.DshRoot
import ai.deepseek.harness.mobile.ui.NativeRemoteScreen
import ai.deepseek.harness.mobile.ui.NativeDialog
import ai.deepseek.harness.mobile.ui.NativeChoiceRow
import ai.deepseek.harness.mobile.ui.MobilePreferences
import ai.deepseek.harness.mobile.ui.LocalMobilePreferences
import ai.deepseek.harness.mobile.ui.ScanScreen
import ai.deepseek.harness.mobile.ui.theme.DshTheme
import ai.deepseek.harness.mobile.ui.theme.dsh
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

class MainActivity : ComponentActivity() {
    private val store by lazy { EncryptedDeviceStore(applicationContext) }
    private val vm: DshViewModel by viewModels { DshVmFactory(store) }
    private val interfacePreferences by lazy { MobilePreferences(applicationContext) }
    private lateinit var images: NativeImagePicker
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { runOnUiThread { vm.onNetworkAvailable() } }
    }
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        vm.route = if (granted) Route.Scan else Route.Permission
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        vm.desktop.setAppVersion(packageManager.getPackageInfo(packageName, 0).versionName.orEmpty())
        images = NativeImagePicker(this, vm::attachmentOwner, vm::addImage, vm::report)
        images.restoreState(savedInstanceState)
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
        if (savedInstanceState == null) vm.openPairingLink(intent?.action, intent?.dataString)
        if (intent?.action == Intent.ACTION_VIEW) intent.data = null
        if (vm.needsLegacyMigration) lifecycleScope.launch {
            try { vm.importLegacy(withTimeout(10_000) { readLegacyStorage(this@MainActivity) }) }
            catch (error: Exception) { vm.error = "旧配对数据迁移失败，原数据仍保留：${error.message}" }
        } else vm.start()
        setContent {
            val dark = when (vm.scheme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            var attachmentSource by remember { mutableStateOf(false) }
            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
                @Suppress("DEPRECATION")
                window.statusBarColor = android.graphics.Color.TRANSPARENT
                @Suppress("DEPRECATION")
                window.navigationBarColor = android.graphics.Color.TRANSPARENT
                // The root paints both transparent system bars, including Android 15+ edge-to-edge.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.isStatusBarContrastEnforced = false
                    window.isNavigationBarContrastEnforced = false
                }
            }
            LaunchedEffect(vm.externalUrl) {
                if (vm.externalUrl.isNotBlank()) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.externalUrl))) }
                    catch (_: android.content.ActivityNotFoundException) { vm.report("未找到可打开链接的应用") }
                    finally { vm.externalUrl = "" }
                }
            }
            DshTheme(dark) {
                CompositionLocalProvider(LocalMobilePreferences provides interfacePreferences) {
                    Box(Modifier.fillMaxSize().background(dsh().bgBase).windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime))) {
                        when (vm.route) {
                            Route.Scan -> ScanScreen(vm::onScanned, { vm.route = Route.Connect }, vm::openPasteEntry)
                            Route.Chat -> NativeRemoteScreen(vm) { attachmentSource = true }
                            else -> DshRoot(vm, ::requestScan, {
                                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
                            })
                        }
                    }
                    if (attachmentSource) NativeDialog("添加图片", onDismiss = { attachmentSource = false }) {
                        NativeChoiceRow("从相册选择", onClick = { attachmentSource = false; images.selectGallery() })
                        NativeChoiceRow("拍照", onClick = { attachmentSource = false; images.takePhoto() })
                    }
                }
            }
        }
    }
    override fun onStart() { super.onStart(); vm.onForeground() }
    override fun onStop() { vm.onBackground(); super.onStop() }
    override fun onDestroy() {
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback)
        super.onDestroy()
    }
    override fun onSaveInstanceState(outState: Bundle) { images.saveState(outState); super.onSaveInstanceState(outState) }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        vm.openPairingLink(intent.action, intent.dataString)
        if (intent.action == Intent.ACTION_VIEW) intent.data = null
    }
    private fun requestScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) vm.route = Route.Scan
        else cameraPermission.launch(Manifest.permission.CAMERA)
    }
}
class DshVmFactory(private val store: EncryptedDeviceStore) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = DshViewModel(store) as T
}
