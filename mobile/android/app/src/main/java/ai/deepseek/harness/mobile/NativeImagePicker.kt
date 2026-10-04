package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.NativeImage
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.*
import java.io.File
import java.io.ByteArrayOutputStream
import java.util.Base64

class NativeCaptureProvider : FileProvider()

internal class NativeImagePicker(
    private val activity: ComponentActivity,
    private val currentOwner: () -> Pair<String, String>,
    private val onImage: (String, String, NativeImage) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var owner: Pair<String, String>? = null
    private var captureFile: File? = null
    private val gallery = activity.registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> consume(uri) }
    private val camera = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = captureFile?.let { FileProvider.getUriForFile(activity, "${activity.packageName}.native-capture", it) }
        consume(if (ok) uri else null)
    }
    private val permission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && owner == currentOwner()) launchCamera() else { owner = null; if (!granted) onError("相机权限未开启，可从相册添加图片") }
    }
    fun saveState(state: Bundle) {
        owner?.let { state.putString("mediaServer", it.first); state.putString("mediaSession", it.second) }
        captureFile?.let { state.putString("mediaCapture", it.absolutePath) }
    }
    fun restoreState(state: Bundle?) {
        val server = state?.getString("mediaServer") ?: return
        owner = server to state.getString("mediaSession").orEmpty()
        state.getString("mediaCapture")?.let { path ->
            val file = File(path).canonicalFile
            val directory = File(activity.cacheDir, "capture").canonicalFile
            if (file.parentFile == directory) captureFile = file
        }
    }
    fun selectGallery() { owner = currentOwner(); gallery.launch("image/*") }
    fun takePhoto() {
        owner = currentOwner()
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera()
        else permission.launch(Manifest.permission.CAMERA)
    }
    private fun launchCamera() {
        val directory = File(activity.cacheDir, "capture").apply { mkdirs() }
        val file = File.createTempFile("photo-", ".jpg", directory)
        captureFile = file
        camera.launch(FileProvider.getUriForFile(activity, "${activity.packageName}.native-capture", file))
    }
    private fun consume(uri: Uri?) {
        val requestOwner = owner
        val file = captureFile
        owner = null; captureFile = null
        if (uri == null || requestOwner == null) { file?.delete(); return }
        activity.lifecycleScope.launch {
            try {
                val image = withContext(Dispatchers.IO) {
                    val type = activity.contentResolver.getType(uri) ?: "image/jpeg"
                    require(type in setOf("image/png", "image/jpeg", "image/webp", "image/gif")) { "此图片格式不受支持" }
                    val bytes = activity.contentResolver.openInputStream(uri)?.use { stream ->
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = stream.read(buffer)
                            if (count < 0) break
                            require(output.size() + count <= 10 * 1024 * 1024) { "图片超过 10 MB" }
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    } ?: error("无法读取图片")
                    NativeImage(type, Base64.getEncoder().encodeToString(bytes))
                }
                if (requestOwner == currentOwner()) onImage(requestOwner.first, requestOwner.second, image)
            } catch (error: Exception) { if (requestOwner == currentOwner()) onError(error.message ?: "读取图片失败") }
            finally { file?.delete() }
        }
    }
}
