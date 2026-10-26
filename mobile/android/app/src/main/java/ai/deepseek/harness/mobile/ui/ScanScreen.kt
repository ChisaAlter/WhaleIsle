package ai.deepseek.harness.mobile.ui

import android.annotation.SuppressLint
import android.util.Size
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import ai.deepseek.harness.mobile.ui.theme.dsh
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

@SuppressLint("UnsafeOptInUsageError")
@Composable
fun ScanScreen(onFound: (String) -> Unit, onClose: () -> Unit, onPaste: () -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    val done = remember { AtomicBoolean(false) }
    val control = remember { AtomicReference<CameraControl?>(null) }
    var torch by remember { mutableStateOf(false) }
    DisposableEffect(owner) {
        val executor = Executors.newSingleThreadExecutor()
        val scanner = BarcodeScanning.getClient()
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val cameraProvider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(1280, 720))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(executor) { proxy ->
                val media = proxy.image
                if (media != null && !done.get()) {
                    val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
                    scanner.process(image)
                        .addOnSuccessListener { codes ->
                            val raw = codes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }?.rawValue
                            if (!raw.isNullOrEmpty() && done.compareAndSet(false, true)) onFound(raw)
                        }
                        .addOnCompleteListener { proxy.close() }
                } else {
                    proxy.close()
                }
            }
            cameraProvider.unbindAll()
            val camera = cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            control.set(camera.cameraControl)
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            executor.shutdown()
            scanner.close()
            control.set(null)
            try {
                ProcessCameraProvider.getInstance(context).get().unbindAll()
            } catch (_: Exception) {
                // Camera provider may not be ready yet.
            }
        }
    }
    androidx.activity.compose.BackHandler(onBack = onClose)
    val palette = dsh()
    val connection = palette.connection
    val ink = connection.cameraInk
    val inkMuted = connection.cameraMuted
    Box(Modifier.fillMaxSize()) {
        ConnectionScene(Modifier.fillMaxSize())
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(bottom = 12.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.width(48.dp).height(48.dp).then(dshClickable(onClick = onClose)),
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(Modifier.width(16.dp).height(16.dp)) {
                        val stroke = Stroke(width = 1.4.dp.toPx(), cap = StrokeCap.Round)
                        drawLine(connection.ink, Offset(size.width * 0.62f, 0f), Offset(size.width * 0.22f, size.height * 0.5f), stroke.width, StrokeCap.Round)
                        drawLine(connection.ink, Offset(size.width * 0.22f, size.height * 0.5f), Offset(size.width * 0.62f, size.height), stroke.width, StrokeCap.Round)
                    }
                }
                Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                    Text(
                        "扫描配对二维码",
                        color = connection.ink,
                        fontSize = 16.sp,
                        lineHeight = 24.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "Whale Isle · 鲸屿 MOBILE",
                        color = connection.muted,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Box(Modifier.width(48.dp).height(48.dp))
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(connection.hairline))
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .widthIn(max = 520.dp)
                        .fillMaxSize()
                        .clip(RoundedCornerShape(20.dp))
                        .background(connection.cameraSurface)
                        .border(1.dp, connection.panelBorder, RoundedCornerShape(20.dp)),
                ) {
                    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                    if (torch) {
                        Box(Modifier.fillMaxSize().background(connection.torchTint))
                    }
                    Canvas(Modifier.fillMaxSize()) {
                        val frame = size.minDimension * 0.62f
                        val left = (size.width - frame) * 0.5f
                        val top = (size.height - frame) * 0.5f
                        val right = left + frame
                        val bottom = top + frame
                        val scrim = connection.cameraScrim
                        drawRect(scrim, size = ComposeSize(size.width, top))
                        drawRect(scrim, topLeft = Offset(0f, bottom), size = ComposeSize(size.width, size.height - bottom))
                        drawRect(scrim, topLeft = Offset(0f, top), size = ComposeSize(left, frame))
                        drawRect(scrim, topLeft = Offset(right, top), size = ComposeSize(size.width - right, frame))

                        val arm = (frame * 0.16f).coerceAtMost(28.dp.toPx())
                        val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Square)
                        drawLine(ink, Offset(left, top), Offset(left + arm, top), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(left, top), Offset(left, top + arm), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(right, top), Offset(right - arm, top), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(right, top), Offset(right, top + arm), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(left, bottom), Offset(left + arm, bottom), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(left, bottom), Offset(left, bottom - arm), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(right, bottom), Offset(right - arm, bottom), stroke.width, StrokeCap.Square)
                        drawLine(ink, Offset(right, bottom), Offset(right, bottom - arm), stroke.width, StrokeCap.Square)
                    }
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .padding(8.dp)
                            .height(48.dp)
                            .then(
                                dshClickable {
                                    torch = !torch
                                    control.get()?.enableTorch(torch)
                                },
                            )
                            .padding(horizontal = 4.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier
                                .height(32.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(connection.torchSurface)
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(if (torch) "关闭手电" else "手电筒", color = ink, fontSize = 12.sp, lineHeight = 18.sp)
                        }
                    }
                    Text(
                        "将二维码完整放入取景框",
                        color = inkMuted,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                    )
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(connection.panel)
                    .border(1.dp, connection.panelBorder, RoundedCornerShape(20.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .then(dshClickable(onClick = onPaste)),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(40.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .border(1.dp, connection.panelBorder, RoundedCornerShape(20.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("粘贴配对链接", color = connection.ink, fontSize = 14.sp, lineHeight = 22.sp)
                    }
                }
                Text(
                    "端到端加密，只连接你的电脑",
                    color = connection.muted,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
