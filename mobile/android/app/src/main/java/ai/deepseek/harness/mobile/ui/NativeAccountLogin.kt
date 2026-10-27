package ai.deepseek.harness.mobile.ui

import kotlinx.coroutines.*
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** Browser OAuth callbacks bind only to this device's loopback; codes go directly over authenticated E2EE. */
internal class NativeAccountLogin : AutoCloseable {
    private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 1000 }
    val origin = "http://127.0.0.1:${server.localPort}"
    @Volatile private var closed = false

    suspend fun awaitCallback(complete: suspend (String, String) -> String): Unit = withContext(Dispatchers.IO) {
        withTimeout(10 * 60 * 1000L) {
            while (isActive && !closed) {
                val socket = try { server.accept() } catch (_: SocketTimeoutException) { continue }
                socket.use {
                    it.soTimeout = 10_000
                    val reader = it.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
                    val line = readBoundedLine(reader, 8192) ?: return@use
                    val parts = line.split(' ')
                    var headerBytes = line.length
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val header = readBoundedLine(reader, 8192) ?: break
                        headerBytes += header.length
                        require(headerBytes <= 16384) { "登录回调请求过大" }
                        if (header.isBlank()) break
                        val split = header.indexOf(':')
                        require(split > 0) { "登录回调请求无效" }
                        val key = header.substring(0, split).lowercase()
                        require(key !in headers) { "登录回调请求包含重复标头" }
                        headers[key] = header.substring(split + 1).trim()
                    }
                    val validHost = headers["host"] == origin.removePrefix("http://")
                    if (parts.size != 3 || parts[0] != "GET" || !parts[1].startsWith('/') || !validHost) {
                        respond(it, 400, "Invalid callback"); return@use
                    }
                    val uri = URI(parts[1])
                    if (uri.path != "/oauth/callback") { respond(it, 404, "Not found"); return@use }
                    val values = mutableMapOf<String, String>()
                    for (pair in uri.rawQuery.orEmpty().split('&').filter { p -> p.isNotBlank() }) {
                        val key = URLDecoder.decode(pair.substringBefore('='), "UTF-8")
                        val value = URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8")
                        require(key !in values) { "登录回调包含重复参数" }
                        values[key] = value
                    }
                    val code = values["code"].orEmpty()
                    val state = values["state"].orEmpty()
                    if (code.isBlank() || state.isBlank() || code.length > 4096 || state.length > 1024) {
                        respond(it, 400, "Invalid authorization response"); return@use
                    }
                    try {
                        val destination = complete(code, state)
                        val target = URI(destination)
                        require(target.scheme == "https" && target.host != null && target.userInfo == null && '\r' !in destination && '\n' !in destination) { "登录服务未返回有效的完成地址" }
                        it.getOutputStream().write(("HTTP/1.1 302 Found\r\nLocation: $destination\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII))
                    } catch (failure: Throwable) {
                        respond(it, 400, "Sign-in failed. Return to the app to retry.")
                        throw failure
                    }
                    close()
                }
            }
        }
    }
    private fun readBoundedLine(reader: java.io.Reader, max: Int): String? {
        val result = StringBuilder()
        while (true) {
            val next = reader.read()
            if (next == -1) return if (result.isEmpty()) null else result.toString().trimEnd('\r')
            if (next == '\n'.code) return result.toString().trimEnd('\r')
            require(result.length < max) { "登录回调请求过大" }
            result.append(next.toChar())
        }
    }
    private fun respond(socket: java.net.Socket, status: Int, message: String) {
        val body = message.toByteArray(StandardCharsets.UTF_8)
        socket.getOutputStream().write(("HTTP/1.1 $status\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII) + body)
    }
    override fun close() { closed = true; server.close() }
}
