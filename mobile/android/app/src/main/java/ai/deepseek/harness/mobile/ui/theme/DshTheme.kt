package ai.deepseek.harness.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

val LocalDshPalette = staticCompositionLocalOf { DshTokens.Light }

@Composable
fun DshTheme(dark: Boolean, content: @Composable () -> Unit) {
    val palette = if (dark) DshTokens.Dark else DshTokens.Light
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = palette.buttonPrimaryFill,
        onPrimary = palette.labelPrimaryForeground,
        primaryContainer = palette.navActive,
        onPrimaryContainer = palette.labelPrimary,
        secondary = palette.buttonInfoFill,
        onSecondary = palette.labelPrimaryForeground,
        secondaryContainer = palette.navActive,
        onSecondaryContainer = palette.labelPrimary,
        tertiary = palette.buttonInfoFill,
        onTertiary = palette.labelPrimaryForeground,
        tertiaryContainer = palette.navHover,
        onTertiaryContainer = palette.labelPrimary,
        background = palette.bgBase,
        onBackground = palette.labelPrimary,
        surface = palette.bgLayer1,
        onSurface = palette.labelPrimary,
        surfaceVariant = palette.bgModule,
        onSurfaceVariant = palette.labelSecondary,
        surfaceTint = androidx.compose.ui.graphics.Color.Transparent,
        surfaceBright = palette.bgLayer2,
        surfaceDim = palette.bgBase,
        surfaceContainer = palette.bgLayer1,
        surfaceContainerLow = palette.bgLayer1,
        surfaceContainerLowest = palette.bgBase,
        surfaceContainerHigh = palette.bgLayer2,
        surfaceContainerHighest = palette.bgModule,
        inverseSurface = palette.buttonPrimaryFill,
        inverseOnSurface = palette.labelPrimaryForeground,
        inversePrimary = palette.buttonInfoFill,
        error = palette.error,
        onError = palette.labelPrimaryForeground,
        errorContainer = palette.hoverDanger,
        onErrorContainer = palette.error,
        outline = palette.borderL2,
        outlineVariant = palette.borderL1,
        scrim = palette.mask,
    )
    CompositionLocalProvider(LocalDshPalette provides palette) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

@Composable
fun dsh(): DshPalette = LocalDshPalette.current
