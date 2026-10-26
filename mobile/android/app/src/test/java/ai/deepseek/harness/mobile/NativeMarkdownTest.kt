package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.NativeInlineMathProcessor
import ai.deepseek.harness.mobile.ui.NativeMarkdownPart
import ai.deepseek.harness.mobile.ui.NativeTablePlugin
import ai.deepseek.harness.mobile.ui.nativeMarkdownParts
import io.noties.markwon.ext.latex.JLatexMathNode
import io.noties.markwon.inlineparser.InlineProcessor
import io.noties.markwon.inlineparser.MarkwonInlineParser
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import io.noties.markwon.MarkwonVisitor
import org.commonmark.node.*
import org.commonmark.parser.Parser
import org.junit.Assert.*
import org.junit.Test

class NativeMarkdownTest {
    private fun parser(): Parser {
        // The pinned official plugin adds this package-private processor after our processor.
        // Exercise that real registration order without Android Context or drawable mocks.
        val official = Class.forName("io.noties.markwon.ext.latex.JLatexMathInlineProcessor")
            .getDeclaredConstructor().apply { isAccessible = true }.newInstance() as InlineProcessor
        val builder = Parser.builder()
        NativeTablePlugin().configureParser(builder)
        return builder.inlineParserFactory(MarkwonInlineParser.factoryBuilder()
            .addInlineProcessor(NativeInlineMathProcessor()).addInlineProcessor(official).build()).build()
    }

    private fun descendants(node: Node): List<Node> {
        val nodes = mutableListOf<Node>()
        var child = node.firstChild
        while (child != null) { nodes += child; nodes += descendants(child); child = child.next }
        return nodes
    }

    @Test fun actualDeviceResponseSeparatesTableCodeAndSingleDollarMathWithoutChangingSource() {
        val source = "# PORTRAIT_FINAL_OK\n\n| Item | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n- First bullet item\n- Second bullet item\n\n```\n" +
            "0123456789".repeat(10) + "\n```\n\n\u0024E = mc^2\u0024\n\n[example.com](https://example.com)"
        val root = parser().parse(source)
        assertEquals(listOf("E = mc^2"), descendants(root).filterIsInstance<JLatexMathNode>().map { it.latex() })
        val parts = nativeMarkdownParts(root)
        assertEquals(1, parts.filterIsInstance<NativeMarkdownPart.Grid>().size)
        assertEquals("0123456789".repeat(10) + "\n", parts.filterIsInstance<NativeMarkdownPart.Code>().single().text)
        assertEquals(2, parts.filterIsInstance<NativeMarkdownPart.Items>().single().items.size)
        assertEquals(listOf("https://example.com"), parts.filterIsInstance<NativeMarkdownPart.Prose>()
            .flatMap { descendants(it.document) }.filterIsInstance<Link>().map { it.destination })
        assertEquals(1, parts.filterIsInstance<NativeMarkdownPart.Prose>().flatMap { descendants(it.document) }.filterIsInstance<Heading>().size)
    }

    @Test fun singleAndOfficialDoubleDollarMathBothParseWithoutSwallowingCurrencyEscapesOrCode() {
        val root = parser().parse("Inline \u0024x+1\u0024 and \u0024\u0024y^2\u0024\u0024. Price \u002412.50 and \u002420.00; escaped \\\u0024x\\\u0024 and `\u0024literal\u0024`.\n\n```sh\nprintf '\u0024HOME'\n```\n\nUnclosed \u0024formula")
        assertEquals(listOf("x+1", "y^2"), descendants(root).filterIsInstance<JLatexMathNode>().map { it.latex() })
        assertEquals(listOf("\u0024literal\u0024"), descendants(root).filterIsInstance<Code>().map { it.literal })
        assertEquals("printf '\u0024HOME'\n", descendants(root).filterIsInstance<FencedCodeBlock>().single().literal)
        val plain = descendants(root).filterIsInstance<Text>().joinToString("") { it.literal }
        assertTrue(plain.contains("\u002412.50 and \u002420.00"))
        assertTrue(plain.contains("\u0024x\u0024"))
        assertTrue(plain.contains("Unclosed \u0024formula"))
    }

    @Test fun nestedCodeAndTablesKeepQuoteAndListContextAndResolvedReferenceLinks() {
        val root = parser().parse("> - note [ref][r]\n>\n>   ```\n>   \u0024unaltered\n>   ```\n\n[r]: https://example.com/ref\n\n| Key | Value |\n| --- | --- |\n| A | [ref][r] |")
        val parts = nativeMarkdownParts(root)
        val quote = parts.filterIsInstance<NativeMarkdownPart.Quote>().single()
        val list = quote.parts.filterIsInstance<NativeMarkdownPart.Items>().single()
        assertEquals("\u0024unaltered\n", list.items.flatten().filterIsInstance<NativeMarkdownPart.Code>().single().text)
        assertEquals("https://example.com/ref", list.items.flatten().filterIsInstance<NativeMarkdownPart.Prose>()
            .flatMap { descendants(it.document) }.filterIsInstance<Link>().single().destination)
        val table = parts.filterIsInstance<NativeMarkdownPart.Grid>().single()
        assertEquals("https://example.com/ref", descendants(table.node).filterIsInstance<Link>().single().destination)
    }

    @Test fun tableCellsRetainTextAndParserPluginDoesNotInstallConsumingTextViewVisitors() {
        val root = parser().parse("| Item | Value | Link |\n| :--- | ---: | :---: |\n| A | 1 | [ref](https://example.com) |\n| B | 2 | `literal` |")
        val cells = descendants(root).filterIsInstance<TableCell>()
        assertEquals(listOf("Item", "Value", "Link", "A", "1", "ref", "B", "2", "literal"), cells.map { cell ->
            descendants(cell).joinToString("") { when (it) { is Text -> it.literal; is Code -> it.literal; else -> "" } }
        })
        assertEquals(TableCell.Alignment.RIGHT, cells[1].alignment)
        assertEquals(TableCell.Alignment.CENTER, cells[2].alignment)
        val consumingVisitors = mutableListOf<Class<*>>()
        val builder = java.lang.reflect.Proxy.newProxyInstance(MarkwonVisitor.Builder::class.java.classLoader,
            arrayOf(MarkwonVisitor.Builder::class.java)) { proxy, method, arguments ->
            if (method.name == "on") consumingVisitors += arguments[0] as Class<*>
            proxy
        } as MarkwonVisitor.Builder
        NativeTablePlugin().configureVisitor(builder)
        assertTrue("Native cells use core inline visitors; TablePlugin's TableCell visitor would consume their text",
            consumingVisitors.none { it in setOf(TableCell::class.java, TableBlock::class.java, TableRow::class.java, TableHead::class.java) })
    }

    @Test fun incompleteFencePreservesLiteralTextAndInlineBackticksDoNotCreateScrollableBlocks() {
        assertTrue(nativeMarkdownParts(parser().parse("")).isEmpty())
        val parts = nativeMarkdownParts(parser().parse("Paragraph with `inline` code.\n\n~~~kotlin\nval price = \u002412.50"))
        assertEquals("val price = \u002412.50\n", parts.filterIsInstance<NativeMarkdownPart.Code>().single().text)
        assertEquals("inline", parts.filterIsInstance<NativeMarkdownPart.Prose>().flatMap { descendants(it.document) }.filterIsInstance<Code>().single().literal)
    }
}
