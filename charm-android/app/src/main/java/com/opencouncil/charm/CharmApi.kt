package com.opencouncil.charm

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

enum class Brain(val id: String, val label: String) {
    CLAUDE("claude", "Claude"), GEMINI("gemini", "Gemini"), GROK("grok", "Grok");

    companion object {
        fun of(id: String?): Brain? = entries.firstOrNull { it.id == id }
    }
}

data class Face(val state: String, val detail: String)

data class CharmStatus(val faces: Map<Brain, Face>, val ticker: String)

data class PanelView(val brain: Brain, val answer: String?, val error: String?, val seconds: Double)

data class CharmReply(
    val answer: String,
    val speaker: Brain,
    val mode: String,
    val via: String,
    val reason: String,
    val suggestCouncil: Boolean,
    val panel: List<PanelView>,
    val seconds: Double,
    val sessionId: String?
)

data class SessionView(
    val id: String,
    val status: String,
    val rounds: Int,
    val summary: String?,
    val approvalToken: String?,
    val jobDetail: String?
)

class CharmException(message: String) : IOException(message)

/** Plain HttpURLConnection + org.json: no networking dependencies to keep current. */
class CharmApi(private val baseUrl: String, private val token: String) {

    suspend fun health(): Boolean = request("GET", "/charm/health", auth = false).optBoolean("ok")

    suspend fun status(): CharmStatus {
        val json = request("GET", "/charm/status")
        val faces = json.optJSONObject("faces") ?: JSONObject()
        return CharmStatus(
            faces = Brain.entries.associateWith { b ->
                val f = faces.optJSONObject(b.id)
                Face(f?.optString("state") ?: "idle", f?.optString("detail") ?: "")
            },
            ticker = json.optString("ticker")
        )
    }

    suspend fun ask(text: String, conversationId: String, brain: Brain? = null, panel: Boolean = false): CharmReply {
        val body = JSONObject().put("text", text).put("conversationId", conversationId)
        if (brain != null) body.put("brain", brain.id)
        if (panel) body.put("mode", "panel")
        val json = request("POST", "/charm/ask", body, readTimeoutMs = 6 * 60_000)
        val route = json.optJSONObject("route") ?: JSONObject()
        val panelJson = json.optJSONObject("panel")
        val panelViews = if (panelJson == null) emptyList() else Brain.entries.mapNotNull { b ->
            panelJson.optJSONObject(b.id)?.let {
                PanelView(b, it.optString("answer").ifBlank { null }, it.optString("error").ifBlank { null }, it.optDouble("ms", 0.0) / 1000)
            }
        }
        return CharmReply(
            answer = json.optString("answer"),
            speaker = Brain.of(json.optString("speaker")) ?: Brain.CLAUDE,
            mode = route.optString("mode", "solo"),
            via = route.optString("via"),
            reason = route.optString("reason"),
            suggestCouncil = route.optBoolean("suggestCouncil"),
            panel = panelViews,
            seconds = json.optDouble("ms", 0.0) / 1000,
            sessionId = json.optJSONObject("session")?.optString("sessionId")
        )
    }

    suspend fun convene(text: String): String =
        request("POST", "/charm/convene", JSONObject().put("text", text)).optString("sessionId")

    suspend fun forget(conversationId: String) {
        request("POST", "/charm/forget", JSONObject().put("conversationId", conversationId))
    }

    suspend fun sessions(): List<Pair<String, String>> {
        val arr = request("GET", "/charm/sessions").optJSONArray("sessions") ?: return emptyList()
        return (0 until arr.length()).map { i -> arr.getJSONObject(i).let { it.optString("id") to it.optString("status") } }
    }

    suspend fun session(id: String): SessionView = parseSession(request("GET", "/charm/sessions/$id"))

    suspend fun approve(id: String, approvalToken: String, execute: Boolean): SessionView =
        parseSession(request("POST", "/charm/sessions/$id/approve", JSONObject().put("token", approvalToken).put("execute", execute)))

    private fun parseSession(j: JSONObject) = SessionView(
        id = j.optString("id"),
        status = j.optString("status"),
        rounds = j.optInt("rounds"),
        summary = j.optString("summary").ifBlank { null },
        approvalToken = j.optString("approvalToken").ifBlank { null },
        jobDetail = j.optJSONObject("job")?.optString("detail")?.ifBlank { null }
    )

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        auth: Boolean = true,
        readTimeoutMs: Int = 20_000
    ): JSONObject = withContext(Dispatchers.IO) {
        if (!baseUrl.startsWith("https://")) throw CharmException("Bridge URL must start with https:// (use tailscale serve).")
        val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = readTimeoutMs
            setRequestProperty("Accept", "application/json")
            if (auth) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        try {
            if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (code !in 200..299) {
                throw CharmException(
                    when (code) {
                        401 -> "The bridge rejected the token. Run `council charm token` on your Mac and paste it in Settings."
                        else -> json.optString("error").ifBlank { "Bridge error $code" }
                    }
                )
            }
            json
        } catch (e: CharmException) {
            throw e
        } catch (e: IOException) {
            throw CharmException("Can't reach your Mac (${e.javaClass.simpleName}). Is it awake, on Tailscale, and running `council charm`?")
        } finally {
            conn.disconnect()
        }
    }
}
