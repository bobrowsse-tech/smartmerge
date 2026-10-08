package smartmerge

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Speak Content-Length JSON-RPC to `smartmerged --stdio`.
 * The body is one JSON-RPC object. This client does not merge text.
 */
class Rpc private constructor(private val process: Process) {
    private var nextId = 1
    private val stdin = process.outputStream
    private val lock = Object()
    private val buffer = ByteArrayOutputStream()
    private var closed = false

    init {
        val stdout = process.inputStream
        Thread {
            val chunk = ByteArray(4096)
            while (true) {
                val count = stdout.read(chunk)
                if (count < 0) {
                    synchronized(lock) {
                        closed = true
                        lock.notifyAll()
                    }
                    return@Thread
                }
                synchronized(lock) {
                    buffer.write(chunk, 0, count)
                    lock.notifyAll()
                }
            }
        }.apply {
            isDaemon = true
            name = "smartmerge-stdio"
            start()
        }
    }

    fun request(method: String, params: Json): Json {
        val id = nextId
        nextId += 1
        val body = encode(jObj(
            "jsonrpc" to jStr("2.0"),
            "id" to jNum(id.toString()),
            "method" to jStr(method),
            "params" to params,
        ))
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val header = "Content-Length: ${bytes.size}\r\n\r\n".toByteArray(StandardCharsets.US_ASCII)
        stdin.write(header)
        stdin.write(bytes)
        stdin.flush()
        val deadline = System.nanoTime() + 10_000_000_000L
        synchronized(lock) {
            while (System.nanoTime() < deadline) {
                val message = takeMessage()
                if (message != null) {
                    if (message.idText() == id.toString()) {
                        val error = message.field("error")
                        if (error != null && error !is Json.Null) {
                            val text = error.field("message")
                            if (text is Json.Str) throw IllegalStateException(text.value)
                            throw IllegalStateException("$method failed")
                        }
                        return message.field("result") ?: Json.Null
                    }
                    continue
                }
                if (closed) break
                val remaining = (deadline - System.nanoTime()) / 1_000_000
                if (remaining <= 0) break
                lock.wait(minOf(remaining, 20))
            }
        }
        throw IllegalStateException("daemon request timed out: $method")
    }

    fun close() {
        process.destroy()
    }

    private fun takeMessage(): Json? {
        val bytes = buffer.toByteArray()
        val headerEnd = indexOfHeaderEnd(bytes)
        if (headerEnd < 0) return null
        val header = String(bytes, 0, headerEnd, StandardCharsets.US_ASCII)
        val length = contentLength(header) ?: return null
        val bodyStart = headerEnd + 4
        if (bytes.size < bodyStart + length) return null
        val body = String(bytes, bodyStart, length, StandardCharsets.UTF_8)
        val rest = bytes.copyOfRange(bodyStart + length, bytes.size)
        buffer.reset()
        buffer.write(rest)
        return decode(body)
    }

    companion object {
        fun connect(repoRoot: String): Rpc {
            val process = ProcessBuilder("smartmerged", "--stdio")
                .directory(File(repoRoot))
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start()
            return Rpc(process)
        }
    }
}

private fun indexOfHeaderEnd(bytes: ByteArray): Int {
    for (index in 0 until bytes.size - 3) {
        if (bytes[index] == 13.toByte() &&
            bytes[index + 1] == 10.toByte() &&
            bytes[index + 2] == 13.toByte() &&
            bytes[index + 3] == 10.toByte()
        ) {
            return index
        }
    }
    return -1
}

private fun contentLength(header: String): Int? {
    val match = Regex("(?i)content-length:\\s*(\\d+)").find(header) ?: return null
    return match.groupValues[1].toIntOrNull()
}

sealed class Json {
    data class Obj(val fields: Map<String, Json>) : Json()
    data class Arr(val items: List<Json>) : Json()
    data class Str(val value: String) : Json()
    data class Num(val value: String) : Json()
    data class Bool(val value: Boolean) : Json()
    data object Null : Json()
}

fun jObj(vararg pairs: Pair<String, Json>): Json = Json.Obj(linkedMapOf(*pairs))

fun jStr(value: String): Json = Json.Str(value)

fun jNum(value: String): Json = Json.Num(value)

fun Json.field(name: String): Json? = (this as? Json.Obj)?.fields?.get(name)

fun Json.items(): List<Json> = (this as? Json.Arr)?.items ?: emptyList()

fun Json.text(): String? = (this as? Json.Str)?.value

fun Json.idText(): String? = when (this) {
    is Json.Num -> value.substringBefore('.')
    is Json.Str -> value
    else -> field("id")?.idText()
}

fun encode(value: Json): String = when (value) {
    is Json.Obj -> value.fields.entries.joinToString(prefix = "{", postfix = "}") { (key, item) ->
        encode(jStr(key)) + ":" + encode(item)
    }
    is Json.Arr -> value.items.joinToString(prefix = "[", postfix = "]") { encode(it) }
    is Json.Str -> buildString {
        append('"')
        for (char in value.value) {
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (char.code < 0x20) append("\\u%04x".format(char.code)) else append(char)
            }
        }
        append('"')
    }
    is Json.Num -> value.value
    is Json.Bool -> if (value.value) "true" else "false"
    Json.Null -> "null"
}

fun decode(body: String): Json = JsonParser(body).parse()

private class JsonParser(private val text: String) {
    private var index = 0

    fun parse(): Json {
        val value = parseValue()
        skip()
        return value
    }

    private fun parseValue(): Json {
        skip()
        return when (text.getOrNull(index)) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> Json.Str(parseString())
            't' -> { expect("true"); Json.Bool(true) }
            'f' -> { expect("false"); Json.Bool(false) }
            'n' -> { expect("null"); Json.Null }
            else -> parseNumber()
        }
    }

    private fun parseObject(): Json {
        expect("{")
        val fields = linkedMapOf<String, Json>()
        skip()
        if (text.getOrNull(index) == '}') {
            index += 1
            return Json.Obj(fields)
        }
        while (index < text.length) {
            skip()
            val key = parseString()
            skip()
            expect(":")
            fields[key] = parseValue()
            skip()
            when (text.getOrNull(index)) {
                ',' -> index += 1
                '}' -> {
                    index += 1
                    return Json.Obj(fields)
                }
                else -> throw IllegalStateException("expected object entry")
            }
        }
        throw IllegalStateException("unterminated object")
    }

    private fun parseArray(): Json {
        expect("[")
        val items = mutableListOf<Json>()
        skip()
        if (text.getOrNull(index) == ']') {
            index += 1
            return Json.Arr(items)
        }
        while (index < text.length) {
            items.add(parseValue())
            skip()
            when (text.getOrNull(index)) {
                ',' -> index += 1
                ']' -> {
                    index += 1
                    return Json.Arr(items)
                }
                else -> throw IllegalStateException("expected array entry")
            }
        }
        throw IllegalStateException("unterminated array")
    }

    private fun parseString(): String {
        expect("\"")
        val out = StringBuilder()
        while (index < text.length) {
            val char = text[index]
            index += 1
            when (char) {
                '"' -> return out.toString()
                '\\' -> {
                    val escaped = text[index]
                    index += 1
                    when (escaped) {
                        '"', '\\', '/' -> out.append(escaped)
                        'b' -> out.append('\b')
                        'f' -> out.append('\u000C')
                        'n' -> out.append('\n')
                        'r' -> out.append('\r')
                        't' -> out.append('\t')
                        'u' -> {
                            val hex = text.substring(index, index + 4)
                            index += 4
                            out.append(hex.toInt(16).toChar())
                        }
                        else -> out.append(escaped)
                    }
                }
                else -> out.append(char)
            }
        }
        throw IllegalStateException("unterminated string")
    }

    private fun parseNumber(): Json.Num {
        val start = index
        if (text.getOrNull(index) == '-') index += 1
        while (index < text.length && text[index].isDigit()) index += 1
        if (text.getOrNull(index) == '.') {
            index += 1
            while (index < text.length && text[index].isDigit()) index += 1
        }
        if (text.getOrNull(index) == 'e' || text.getOrNull(index) == 'E') {
            index += 1
            if (text.getOrNull(index) == '+' || text.getOrNull(index) == '-') index += 1
            while (index < text.length && text[index].isDigit()) index += 1
        }
        if (start == index) throw IllegalStateException("expected value")
        return Json.Num(text.substring(start, index))
    }

    private fun skip() {
        while (index < text.length && text[index].isWhitespace()) index += 1
    }

    private fun expect(token: String) {
        skip()
        if (!text.startsWith(token, index)) throw IllegalStateException("expected $token")
        index += token.length
    }
}
