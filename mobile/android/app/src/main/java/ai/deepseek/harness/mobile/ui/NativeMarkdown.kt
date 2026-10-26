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
    data class Grid(val node: TableBlock) : NativeMarkdownPart
    data class Quote(val parts: List<NativeMarkdownPart>) : NativeMarkdownPart
    data class Items(val start: Int?, val delimiter: Char, val items: List<List<NativeMarkdownPart>>) : NativeMarkdownPart
}

/** Split the parsed AST, retaining resolved links and nested lists/quotes around scrollable blocks. */
internal fun nativeMarkdownParts(parent: Node): List<NativeMarkdownPart> {
    val result = mutableListOf<NativeMarkdownPart>()
    var prose = Document()
    fun flush() {
        if (prose.firstChild != null) { result += NativeMarkdownPart.Prose(prose); prose = Document() }
    }
    var node = parent.firstChild
    while (node != null) {
        val next = node.next
        when (node) {
            is FencedCodeBlock -> { flush(); result += NativeMarkdownPart.Code(node.literal) }
            is IndentedCodeBlock -> { flush(); result += NativeMarkdownPart.Code(node.literal) }
            is TableBlock -> { flush(); result += NativeMarkdownPart.Grid(node) }
            is BlockQuote -> { flush(); result += NativeMarkdownPart.Quote(nativeMarkdownParts(node)) }
            is ListBlock -> {
                flush()
                val items = mutableListOf<List<NativeMarkdownPart>>()
                var item = node.firstChild
                while (item != null) { val following = item.next; items += nativeMarkdownParts(item); item = following }
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
internal fun NativeMarkdown(text: String) {
    val context = LocalContext.current
    val colors = dsh()
    val density = LocalDensity.current
    val textSize = with(density) { 14.sp.toPx() }
    val lineHeight = with(density) { 22.sp.toPx() }
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
                        val double = source.contains("\u0024\u0024" + latex.trim() + "\u0024\u0024") || source.contains("\u0024\u0024\n" + latex.trim())
                        val delimiter = if (double) "\u0024\u0024" else "\u0024"
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
    val parts = remember(markdown, text) { nativeMarkdownParts(markdown.parse(text)) }
    NativeMarkdownParts(parts, markdown, colors, lineHeight)
}

@Composable
private fun NativeMarkdownParts(parts: List<NativeMarkdownPart>, markdown: Markwon, colors: DshPalette, lineHeight: Float) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        parts.forEach { part -> when (part) {
            is NativeMarkdownPart.Prose -> {
                val rendered = remember(markdown, part) { markdown.render(part.document) }
                AndroidView(modifier = Modifier.fillMaxWidth(), factory = { nativeText(it, colors, lineHeight) }, update = { view ->
                    styleText(view, colors, lineHeight)
                    if (view.tag !== rendered) { markdown.setParsedMarkdown(view, rendered); view.tag = rendered }
                })
            }
            is NativeMarkdownPart.Code -> AndroidView(modifier = Modifier.fillMaxWidth(), factory = { context ->
                HorizontalScrollView(context).apply {
                    isFillViewport = true
                    isHorizontalScrollBarEnabled = true
                    addView(nativeText(context, colors, lineHeight).apply {
                        typeface = Typeface.MONOSPACE
                        setHorizontallyScrolling(true)
                        val pad = dp(context, 12)
                        setPadding(pad, pad, pad, pad)
                    }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                }
            }, update = { scroll ->
                scroll.setBackgroundColor(colors.bgModule.toArgb())
                val view = scroll.getChildAt(0) as TextView
                styleText(view, colors, lineHeight)
                if (view.text.toString() != part.text) view.text = part.text
            })
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
                                val cell = nativeText(layout.context, colors, lineHeight).apply {
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
                Box(Modifier.weight(1f).padding(start = 10.dp)) { NativeMarkdownParts(part.parts, markdown, colors, lineHeight) }
            }
            is NativeMarkdownPart.Items -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                part.items.forEachIndexed { index, item -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Text(part.start?.let { "${it + index}${part.delimiter}" } ?: "•", Modifier.widthIn(min = 24.dp).padding(end = 6.dp),
                        color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
                    Box(Modifier.weight(1f)) { NativeMarkdownParts(item, markdown, colors, lineHeight) }
                } }
            }
        } }
    }
}

private fun nativeText(context: Context, colors: DshPalette, lineHeight: Float) = TextView(context).apply {
    includeFontPadding = false
    setTextIsSelectable(true)
    styleText(this, colors, lineHeight)
}

private fun styleText(view: TextView, colors: DshPalette, lineHeight: Float) {
    view.textSize = 14f
    view.setTextColor(colors.labelPrimary.toArgb())
    view.setLinkTextColor(colors.buttonInfoFill.toArgb())
    view.setLineSpacing((lineHeight - view.paint.fontSpacing).coerceAtLeast(0f), 1f)
}

private fun dp(context: Context, value: Int) = (context.resources.displayMetrics.density * value + 0.5f).toInt()
