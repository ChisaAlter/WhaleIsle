package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.DshPalette
import ai.deepseek.harness.mobile.ui.theme.dsh
import android.content.Context
import android.graphics.Typeface
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.TableLayout
import android.widget.TableRow
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.latex.JLatexMathNode
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.ext.tables.Table
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.parser.Parser
import io.noties.markwon.inlineparser.InlineProcessor
import io.noties.markwon.inlineparser.MarkwonInlineParserPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.node.*
import java.util.concurrent.Executors

internal sealed interface NativeMarkdownPart {
    data class Prose(val document: Document) : NativeMarkdownPart
    data class Code(val text: String) : NativeMarkdownPart
    data class Ui(
        val title: String?,
        val language: String = "whale-ui",
        val program: String = "",
        val streaming: Boolean = false,
        val instanceKey: String = "",
    ) : NativeMarkdownPart
    data class Grid(val node: TableBlock) : NativeMarkdownPart
    data class Quote(val parts: List<NativeMarkdownPart>) : NativeMarkdownPart
    data class Items(val start: Int?, val delimiter: Char, val items: List<List<NativeMarkdownPart>>) : NativeMarkdownPart
}

private val UI_FENCE_LANG = Regex("^(openui|openui-lang|whale-ui|dsh-ui)$", RegexOption.IGNORE_CASE)
private val UI_FENCE_TRAILING = Regex("[>`\"'.,;:)\\]】」』]+$")
private val UI_FENCE_TITLE = Regex("Title\\(\\s*\"([^\"]+)\"")
private val FENCE_LINE_REGEX = Regex("^\\s{0,3}(`{3,}|~{3,})(.*)$")

internal fun uiFenceLanguage(info: String?): String? {
    val raw = info?.substringBefore(' ')?.trim()?.lowercase() ?: return null
    if (UI_FENCE_LANG.matches(raw)) return raw
    val stripped = raw.replace(UI_FENCE_TRAILING, "")
    return if (UI_FENCE_LANG.matches(stripped)) stripped else null
}

internal fun isWhaleUiFenceLang(lang: String?): Boolean = uiFenceLanguage(lang) != null

/**
 * Interactive UI programs render as live components via NativeWhaleUiCard.
 * @param info the fenced code block's info string (language plus optional attrs)
 */
internal fun isUiFenceInfo(info: String?): Boolean = uiFenceLanguage(info) != null

internal fun hasUnclosedUiFence(source: String): Boolean {
    var openChar: Char? = null
    var openLen = 0
    var openIsUi = false
    for (line in source.lineSequence()) {
        val match = FENCE_LINE_REGEX.matchEntire(line) ?: continue
        val ticks = match.groupValues[1]
        val rest = match.groupValues[2]
        val ch = ticks[0]
        val len = ticks.length
        if (openChar == null) {
            if (ch == '`' && rest.contains('`')) continue
            openChar = ch
            openLen = len
            openIsUi = isUiFenceInfo(rest)
        } else if (ch == openChar && len >= openLen && rest.isBlank()) {
            openChar = null
            openLen = 0
            openIsUi = false
        }
    }
    return openChar != null && openIsUi
}

/** Split the parsed AST, retaining resolved links and nested lists/quotes around scrollable blocks. */
internal fun nativeMarkdownParts(
    parent: Node,
    source: String = "",
    streaming: Boolean = false,
    instancePrefix: String = "md-ui",
): List<NativeMarkdownPart> {
    val result = mutableListOf<NativeMarkdownPart>()
    var prose = Document()
    var uiCounter = 0
    val unclosedTail = (streaming || (source.isNotEmpty() && hasUnclosedUiFence(source)))
    fun flush() {
        if (prose.firstChild != null) { result += NativeMarkdownPart.Prose(prose); prose = Document() }
    }
    var node = parent.firstChild
    while (node != null) {
        val next = node.next
        when (node) {
            is FencedCodeBlock -> {
                flush()
                val uiLang = uiFenceLanguage(node.info)
                if (uiLang != null) {
                    val idx = uiCounter++
                    val isTrailingStreaming = next == null && unclosedTail
                    val program = node.literal.trimEnd('\r', '\n')
                    val title = UI_FENCE_TITLE.find(node.literal)?.groupValues?.get(1)
                    result += NativeMarkdownPart.Ui(
                        title = title,
                        language = uiLang,
                        program = program,
                        streaming = isTrailingStreaming,
                        instanceKey = "$instancePrefix-$idx",
                    )
                } else {
                    result += NativeMarkdownPart.Code(node.literal)
                }
            }
            is IndentedCodeBlock -> { flush(); result += NativeMarkdownPart.Code(node.literal) }
            is TableBlock -> { flush(); result += NativeMarkdownPart.Grid(node) }
            is BlockQuote -> { flush(); result += NativeMarkdownPart.Quote(nativeMarkdownParts(node, instancePrefix = "$instancePrefix-q")) }
            is ListBlock -> {
                flush()
                val items = mutableListOf<List<NativeMarkdownPart>>()
                var item = node.firstChild
                var itemIdx = 0
                while (item != null) {
                    val following = item.next
                    items += nativeMarkdownParts(item, instancePrefix = "$instancePrefix-i${itemIdx++}")
                    item = following
                }
                result += NativeMarkdownPart.Items((node as? OrderedList)?.startNumber, (node as? OrderedList)?.delimiter ?: '.', items)
            }
            else -> prose.appendChild(node)
        }
        node = next
    }
    flush()
    return result
}

/** Like Markwon's official TableEntryPlugin: parse tables, without the single-TextView cell visitor.
 * TablePlugin consumes cell text into row spans, so Table.parse(render(cell)) would return empty cells.
 */
internal class NativeTablePlugin : AbstractMarkwonPlugin() {
    override fun configureParser(builder: Parser.Builder) {
        builder.extensions(listOf(TablesExtension.create()))
    }
}

/** Markwon's official math inline processor handles $$; add single-dollar math without rewriting code. */
internal class NativeInlineMathProcessor : InlineProcessor() {
    override fun specialCharacter() = '$'
    override fun parse(): Node? {
        val start = index
        if (start + 1 >= input.length || input[start + 1] == '$' || input[start + 1].isWhitespace()) return null
        if (input[start + 1].isDigit()) {
            var numberEnd = start + 1
            while (numberEnd < input.length && (input[numberEnd].isDigit() || input[numberEnd] == '.' || input[numberEnd] == ',')) numberEnd++
            if (numberEnd == input.length || input[numberEnd].isWhitespace()) return null
        }
        var end = start + 1
        while (end < input.length && input[end] != '\n') {
            if (input[end] == '`') return null
            if (input[end] == '\\') { end += 2; continue }
            if (input[end] == '$') {
                if (input[end - 1].isWhitespace() || end + 1 < input.length && (input[end + 1].isDigit() || input[end + 1] == '$')) return null
                index = end + 1
                return JLatexMathNode().apply { latex(input.substring(start + 1, end)) }
            }
            end++
        }
        return null
    }
}

/** Invalid TeX remains readable as source instead of disappearing inside an async image span. */
private class NativeMathErrorDrawable(source: String, size: Float, color: Int, width: Int) : Drawable() {
    private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; this.color = color }
    private val layout = StaticLayout.Builder.obtain(source, 0, source.length, paint, width.coerceAtLeast(1))
        .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).build()
    override fun getIntrinsicWidth() = layout.width
    override fun getIntrinsicHeight() = layout.height
    override fun draw(canvas: Canvas) { canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); layout.draw(canvas); canvas.restore() }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter }
    @Deprecated("Required by Drawable") override fun getOpacity() = PixelFormat.TRANSLUCENT
}

@Composable
internal fun NativeMarkdown(
    text: String,
    instanceKey: String = "md-ui",
    streaming: Boolean = false,
    onActionPrompt: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val colors = dsh()
    val density = LocalDensity.current
    val scale = LocalMobilePreferences.current?.messageScale ?: 1f
    val textSize = with(density) { (14 * scale).sp.toPx() }
    val lineHeight = with(density) { (22 * scale).sp.toPx() }
    val source by rememberUpdatedState(text)
    val mathExecutor = remember(context) { Executors.newSingleThreadExecutor() }
    DisposableEffect(mathExecutor) { onDispose { mathExecutor.shutdownNow() } }
    val markdown = remember(context, colors, textSize, mathExecutor) {
        val inlines = MarkwonInlineParserPlugin.create()
        inlines.factoryBuilder().addInlineProcessor(NativeInlineMathProcessor())
        Markwon.builder(context)
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(NativeTablePlugin())
            .usePlugin(inlines)
            .usePlugin(JLatexMathPlugin.create(textSize) { builder ->
                builder.inlinesEnabled(true).executorService(mathExecutor)
                    .errorHandler { latex, _ ->
                        val double = source.contains("$$" + latex.trim() + "$$") || source.contains("$$\n" + latex.trim())
                        val delimiter = if (double) "$$" else "$"
                        NativeMathErrorDrawable(delimiter + latex.trimEnd() + delimiter, textSize,
                            colors.labelPrimary.toArgb(), context.resources.displayMetrics.widthPixels.coerceAtLeast(1))
                    }
                builder.theme().textColor(colors.labelPrimary.toArgb())
            })
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder.linkColor(colors.buttonInfoFill.toArgb())
                        .codeTextColor(colors.labelPrimary.toArgb())
                        .codeBlockTextColor(colors.labelPrimary.toArgb())
                        .codeBackgroundColor(colors.bgModule.toArgb())
                        .codeBlockBackgroundColor(colors.bgModule.toArgb())
                        .codeTypeface(Typeface.MONOSPACE).codeBlockTypeface(Typeface.MONOSPACE)
                        .blockQuoteColor(colors.labelTertiary.toArgb())
                        .headingBreakColor(colors.borderL2.toArgb())
                        .thematicBreakColor(colors.borderL2.toArgb())
                }
            }).build()
    }
    val parts = remember(markdown, text, streaming, instanceKey) {
        nativeMarkdownParts(markdown.parse(text), source = text, streaming = streaming, instancePrefix = instanceKey)
    }
    NativeMarkdownParts(parts, markdown, colors, lineHeight, scale, instanceKey, onActionPrompt)
}

@Composable
private fun NativeMarkdownParts(
    parts: List<NativeMarkdownPart>,
    markdown: Markwon,
    colors: DshPalette,
    lineHeight: Float,
    scale: Float,
    instanceKey: String = "md-ui",
    onActionPrompt: ((String) -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        parts.forEachIndexed { idx, part -> when (part) {
            is NativeMarkdownPart.Prose -> {
                val rendered = remember(markdown, part) { markdown.render(part.document) }
                AndroidView(modifier = Modifier.fillMaxWidth(), factory = { nativeText(it, colors, lineHeight, scale) }, update = { view ->
                    styleText(view, colors, lineHeight, scale)
                    if (view.tag !== rendered) { markdown.setParsedMarkdown(view, rendered); view.tag = rendered }
                })
            }
            is NativeMarkdownPart.Code -> AndroidView(modifier = Modifier.fillMaxWidth(), factory = { context ->
                HorizontalScrollView(context).apply {
                    isFillViewport = true
                    isHorizontalScrollBarEnabled = true
                    addView(nativeText(context, colors, lineHeight, scale).apply {
                        typeface = Typeface.MONOSPACE
                        setHorizontallyScrolling(true)
                        val pad = dp(context, 12)
                        setPadding(pad, pad, pad, pad)
                    }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                }
            }, update = { scroll ->
                scroll.setBackgroundColor(colors.bgModule.toArgb())
                val view = scroll.getChildAt(0) as TextView
                styleText(view, colors, lineHeight, scale)
                if (view.text.toString() != part.text) view.text = part.text
            })
            is NativeMarkdownPart.Ui -> {
                if (part.program.isNotBlank() || part.streaming) {
                    NativeWhaleUiCard(
                        payload = NativeWhaleUiPayload(
                            instanceKey = part.instanceKey.ifBlank { "$instanceKey-$idx" },
                            language = part.language,
                            program = part.program,
                            title = part.title.orEmpty(),
                            streaming = part.streaming,
                        ),
                        onSendAssistantMessage = onActionPrompt,
                    )
                } else {
                    Row(Modifier.fillMaxWidth().background(colors.bgModule).padding(horizontal = 12.dp, vertical = 10.dp)) {
                        Text(
                            if (part.title != null) "交互卡片「${part.title}」需要在电脑端查看" else "交互卡片需要在电脑端查看",
                            color = colors.labelTertiary, fontSize = (13 * scale).sp, lineHeight = (20 * scale).sp,
                        )
                    }
                }
            }
            is NativeMarkdownPart.Grid -> {
                val table = remember(markdown, part) { Table.parse(markdown, part.node) }
                if (table != null) AndroidView(modifier = Modifier.fillMaxWidth(), factory = { context ->
                    HorizontalScrollView(context).apply {
                        isFillViewport = true
                        isHorizontalScrollBarEnabled = true
                        addView(TableLayout(context).apply { isShrinkAllColumns = false; isStretchAllColumns = false },
                            ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                    }
                }, update = { scroll ->
                    if (scroll.tag !== table) {
                        val layout = scroll.getChildAt(0) as TableLayout
                        layout.removeAllViews()
                        table.rows().forEach { row ->
                            val tableRow = TableRow(layout.context).apply { isBaselineAligned = false }
                            tableRow.setBackgroundColor((if (row.header()) colors.bgModule else colors.bgBase).toArgb())
                            row.columns().forEach { column ->
                                val cell = nativeText(layout.context, colors, lineHeight, scale).apply {
                                    minWidth = dp(layout.context, 80)
                                    maxWidth = dp(layout.context, 240)
                                    gravity = Gravity.TOP or when (column.alignment()) {
                                        Table.Alignment.CENTER -> Gravity.CENTER_HORIZONTAL
                                        Table.Alignment.RIGHT -> Gravity.RIGHT
                                        else -> Gravity.LEFT
                                    }
                                    if (row.header()) typeface = Typeface.DEFAULT_BOLD
                                    val pad = dp(layout.context, 8)
                                    setPadding(pad, pad, pad, pad)
                                    background = GradientDrawable().apply {
                                        setColor(android.graphics.Color.TRANSPARENT)
                                        setStroke(dp(layout.context, 1), colors.borderL2.toArgb())
                                    }
                                }
                                markdown.setParsedMarkdown(cell, column.content())
                                tableRow.addView(cell, TableRow.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
                            }
                            layout.addView(tableRow)
                        }
                        scroll.tag = table
                    }
                })
            }
            is NativeMarkdownPart.Quote -> Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(colors.borderL2))
                Box(Modifier.weight(1f).padding(start = 10.dp)) { NativeMarkdownParts(part.parts, markdown, colors, lineHeight, scale, "$instanceKey-q$idx", onActionPrompt) }
            }
            is NativeMarkdownPart.Items -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                part.items.forEachIndexed { index, item -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Text(part.start?.let { "${it + index}${part.delimiter}" } ?: "•", Modifier.widthIn(min = 24.dp).padding(end = 6.dp),
                        color = colors.labelPrimary, fontSize = (14 * scale).sp, lineHeight = (22 * scale).sp)
                    Box(Modifier.weight(1f)) { NativeMarkdownParts(item, markdown, colors, lineHeight, scale, "$instanceKey-i$idx-$index", onActionPrompt) }
                } }
            }
        } }
    }
}

private fun nativeText(context: Context, colors: DshPalette, lineHeight: Float, scale: Float) = TextView(context).apply {
    includeFontPadding = false
    setTextIsSelectable(true)
    styleText(this, colors, lineHeight, scale)
}

private fun styleText(view: TextView, colors: DshPalette, lineHeight: Float, scale: Float) {
    view.textSize = 14f * scale
    view.setTextColor(colors.labelPrimary.toArgb())
    view.setLinkTextColor(colors.buttonInfoFill.toArgb())
    view.setLineSpacing((lineHeight - view.paint.fontSpacing).coerceAtLeast(0f), 1f)
}

private fun dp(context: Context, value: Int) = (context.resources.displayMetrics.density * value + 0.5f).toInt()
