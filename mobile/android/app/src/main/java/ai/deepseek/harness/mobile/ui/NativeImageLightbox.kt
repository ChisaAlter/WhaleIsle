package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.dsh
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Base64

/** In-process attachment gallery; no remote origin or executable content enters the viewer. */
@Composable
internal fun NativeImageLightbox(images: List<NativeImage>, initial: Int, close: () -> Unit) {
    if (images.isEmpty()) return
    var index by remember(images, initial) { mutableIntStateOf(initial.coerceIn(images.indices)) }
    var scale by remember(index) { mutableFloatStateOf(1f) }
    var offset by remember(index) { mutableStateOf(Offset.Zero) }
    val image = images[index]
    val bitmap = remember(image.data) { runCatching {
        val data = Base64.getDecoder().decode(image.data)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        val sample = (maxOf(bounds.outWidth, bounds.outHeight) / 2048).coerceAtLeast(1)
        BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }.getOrNull() }
    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 6f)
        offset = if (scale <= 1f) Offset.Zero else (offset + pan).let { Offset(it.x.coerceIn(-3000f, 3000f), it.y.coerceIn(-3000f, 3000f)) }
    }
    Dialog(close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(dsh().bgBase).windowInsetsPadding(WindowInsets.safeDrawing)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("图片 ${index + 1} / ${images.size}", Modifier.weight(1f).padding(start = 16.dp), color = dsh().labelPrimary, fontSize = 16.sp)
                NativeIconButton(NativeGlyph.Close, "关闭图片", close)
            }
            Box(Modifier.weight(1f).fillMaxWidth().transformable(transform).pointerInput(index) {
                detectTapGestures(onDoubleTap = { scale = if (scale > 1f) 1f else 2f; offset = Offset.Zero })
            }, contentAlignment = Alignment.Center) {
                if (bitmap != null) Image(bitmap, "图片 ${index + 1}，双击或双指缩放", Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y), contentScale = ContentScale.Fit)
                else Text(image.error.ifBlank { "图片无法预览" }, color = dsh().labelSecondary)
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = index > 0, onClick = { index-- }) { Text("上一张") }
                TextButton(onClick = { scale = 1f; offset = Offset.Zero }) { Text("重置缩放") }
                TextButton(enabled = index < images.lastIndex, onClick = { index++ }) { Text("下一张") }
            }
        }
    }
}
