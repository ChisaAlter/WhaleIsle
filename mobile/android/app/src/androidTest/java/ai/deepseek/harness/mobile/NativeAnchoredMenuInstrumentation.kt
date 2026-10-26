package ai.deepseek.harness.mobile

import android.app.Instrumentation
import android.os.Bundle

/** Explicit runner for the isolated Compose menu regression; never reads pairing or migration state. */
class NativeAnchoredMenuInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        val result = Bundle()
        try {
            result.putString("stream", NativeAnchoredMenuRegression(this).run())
            finish(-1, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.message}\n")
            finish(0, result)
        }
    }
}
