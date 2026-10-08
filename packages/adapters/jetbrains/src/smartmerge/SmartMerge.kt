package smartmerge

import java.io.File

/**
 * Forward daemon requests. This client does not merge text and does not write hunks.
 */
object SmartMerge {
    fun resolve() {
        val root = repoRoot()
        val rpc = Rpc.connect(root)
        try {
            open(rpc, root)
            val session = rpc.request("conflicts/list", jObj("repoRoot" to jStr(root)))
            val sessionId = session.field("sessionId")?.text() ?: return
            for (row in session.field("files")?.items() ?: emptyList()) {
                val path = row.field("file")?.field("path")?.text() ?: continue
                val proposals = rpc.request(
                    "resolution/propose",
                    jObj("sessionId" to jStr(sessionId), "path" to jStr(path)),
                )
                for (proposal in proposals.items()) {
                    val action = safeAccept(proposal) ?: continue
                    rpc.request(
                        "resolution/act",
                        jObj("sessionId" to jStr(sessionId), "action" to action),
                    )
                }
            }
        } finally {
            rpc.close()
        }
    }

    fun acceptAll() {
        val root = repoRoot()
        val rpc = Rpc.connect(root)
        try {
            open(rpc, root)
            val session = rpc.request("conflicts/list", jObj("repoRoot" to jStr(root)))
            val sessionId = session.field("sessionId")?.text() ?: return
            rpc.request(
                "resolution/act",
                jObj(
                    "sessionId" to jStr(sessionId),
                    "action" to jObj("type" to jStr("applyAllSafe"), "minBand" to jStr("certain")),
                ),
            )
        } finally {
            rpc.close()
        }
    }
}

private fun open(rpc: Rpc, root: String) {
    rpc.request(
        "initialize",
        jObj(
            "clientName" to jStr("smartmerge"),
            "clientVersion" to jStr("0.0.0"),
            "protocolRange" to jStr("1.0.0"),
            "repoRoot" to jStr(root),
            "workspaceTrusted" to Json.Bool(true),
            "capabilities" to jObj(
                "supportsWebview" to Json.Bool(false),
                "supportsDiagnostics" to Json.Bool(false),
            ),
        ),
    )
}

private fun safeAccept(proposal: Json): Json? {
    val recommended = proposal.field("recommended")?.text() ?: return null
    val candidate = proposal.field("candidates")?.items()?.firstOrNull { item ->
        item.field("id")?.text() == recommended
    } ?: return null
    val hazardous = candidate.field("hazardous")
    if (hazardous is Json.Bool && hazardous.value) return null
    val hunkId = proposal.field("hunkId")?.text() ?: return null
    return jObj(
        "type" to jStr("accept"),
        "hunkId" to jStr(hunkId),
        "candidateId" to jStr(candidate.field("id")?.text() ?: recommended),
    )
}

private fun repoRoot(): String {
    val process = ProcessBuilder("git", "rev-parse", "--show-toplevel")
        .redirectError(ProcessBuilder.Redirect.DISCARD)
        .start()
    val text = process.inputStream.bufferedReader().readText().trim()
    val code = process.waitFor()
    if (code != 0 || text.isEmpty()) return File(".").canonicalPath
    return text
}
