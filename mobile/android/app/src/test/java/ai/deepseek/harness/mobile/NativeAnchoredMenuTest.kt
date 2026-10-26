package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.nativeAnchoredMenuBounds
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.*
import org.junit.Test

class NativeAnchoredMenuTest {
    @Test fun normalMenuAlignsRightAndKeepsEightPixelTriggerGap() {
        val anchor = IntRect(120, 600, 360, 648)
        val menu = nativeAnchoredMenuBounds(anchor, IntRect(0, 24, 390, 820), IntSize(280, 300), 8, 12)
        assertEquals(IntRect(80, 292, 360, 592), menu)
    }

    @Test fun narrowScreenAndCutoutClampWidthWithoutLosingTriggerRelationship() {
        val anchor = IntRect(16, 510, 118, 558)
        val menu = nativeAnchoredMenuBounds(anchor, IntRect(0, 32, 320, 700), IntSize(320, 300), 8, 12)
        assertEquals(IntRect(12, 202, 308, 502), menu)
        val rotated = nativeAnchoredMenuBounds(IntRect(700, 300, 748, 348), IntRect(40, 0, 740, 400), IntSize(320, 200), 8, 12)
        assertEquals(728, rotated.right)
        assertEquals(292, rotated.bottom)
    }

    @Test fun imeAndShortViewportReduceHeightAndClampLikeDesktop() {
        val anchor = IntRect(190, 250, 238, 298)
        val menu = nativeAnchoredMenuBounds(anchor, IntRect(0, 24, 320, 320), IntSize(320, 420), 8, 12)
        assertEquals(IntRect(12, 36, 308, 308), menu)
        assertTrue(menu.height >= 48)
        assertEquals(12, 320 - menu.bottom)
    }

    @Test fun effortDrillResizesInPlaceAndViewportChangeReclamps() {
        val anchor = IntRect(100, 600, 360, 648)
        val model = nativeAnchoredMenuBounds(anchor, IntRect(0, 24, 390, 820), IntSize(320, 420), 8, 12)
        val effort = nativeAnchoredMenuBounds(anchor, IntRect(0, 24, 390, 820), IntSize(320, 180), 8, 12)
        assertEquals(model.right, effort.right)
        assertEquals(model.bottom, effort.bottom)
        val changed = nativeAnchoredMenuBounds(anchor, IntRect(0, 24, 320, 450), IntSize(320, 180), 8, 12)
        assertEquals(308, changed.right)
        assertEquals(438, changed.bottom)
    }

    @Test fun transientOffscreenAnchorAndTinyViewportStillProduceValidBounds() {
        val viewport = IntRect(0, 0, 4, 4)
        val menu = nativeAnchoredMenuBounds(IntRect(-20, -10, 2, 0), viewport, IntSize(320, 420), 8, 12)
        assertTrue(menu.width > 0 && menu.height > 0)
        assertTrue(menu.left >= viewport.left && menu.top >= viewport.top)
        assertTrue(menu.right <= viewport.right && menu.bottom <= viewport.bottom)
        val topTrigger = nativeAnchoredMenuBounds(IntRect(16, 40, 64, 88), IntRect(0, 24, 320, 320), IntSize(280, 180), 8, 12)
        assertEquals(IntRect(12, 36, 292, 216), topTrigger)
    }
}
