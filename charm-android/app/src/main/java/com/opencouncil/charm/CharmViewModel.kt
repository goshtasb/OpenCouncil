package com.opencouncil.charm

import android.app.Application
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

enum class Listening { IDLE, LISTENING, SENDING }

data class Exchange(
    val you: String,
    val reply: CharmReply? = null,
    val error: String? = null
)

class CharmViewModel(app: Application) : AndroidViewModel(app) {
    val prefs = Prefs(app)

    var status by mutableStateOf<CharmStatus?>(null); private set
    var listening by mutableStateOf(Listening.IDLE); private set
    var partial by mutableStateOf(""); private set
    var speakingBrain by mutableStateOf<Brain?>(null); private set
    var pendingApproval by mutableStateOf<SessionView?>(null); private set
    var connectionError by mutableStateOf<String?>(null); private set
    val exchanges = mutableStateListOf<Exchange>()

    /** Long-press a face to make the next question go to that brain only. */
    var forcedBrain by mutableStateOf<Brain?>(null)

    private var conversationId = UUID.randomUUID().toString()
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pollJob: Job? = null

    init {
        tts = TextToSpeech(app) { ok ->
            ttsReady = ok == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.getDefault()
        }
    }

    private fun api(): CharmApi? = if (prefs.configured) CharmApi(prefs.baseUrl, prefs.token) else null

    /** Poll faces while the screen is visible; the faces mirror what each brain (and the council) is doing. */
    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            var tick = 0
            while (isActive) {
                val api = api()
                if (api != null) {
                    try {
                        status = api.status()
                        connectionError = null
                        if (tick % 5 == 0) refreshApproval(api)
                    } catch (e: Exception) {
                        connectionError = e.message
                    }
                }
                tick++
                delay(if (listening == Listening.SENDING) 700 else 2500)
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
    }

    private suspend fun refreshApproval(api: CharmApi) {
        val waiting = api.sessions().firstOrNull { it.second == "AWAITING_APPROVAL" }
        pendingApproval = waiting?.let { api.session(it.first) }
    }

    fun startListening() {
        val app = getApplication<Application>()
        if (listening != Listening.IDLE) return
        stopSpeaking()
        if (!SpeechRecognizer.isRecognitionAvailable(app)) {
            exchanges.add(Exchange(you = "", error = "No speech recognizer on this phone. Type instead."))
            return
        }
        recognizer?.destroy()
        // Prefer the on-device recognizer (free, private) when the phone has one.
        recognizer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(app)) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(app)
        } else {
            SpeechRecognizer.createSpeechRecognizer(app)
        }
        recognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { partial = "" }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: partial
            }
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                listening = Listening.IDLE
                partial = ""
                if (text.isNotBlank()) send(text)
            }
            override fun onError(error: Int) {
                listening = Listening.IDLE
                partial = ""
                if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    exchanges.add(Exchange(you = "", error = "Didn't catch that (speech error $error)."))
                }
            }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        }
        listening = Listening.LISTENING
        recognizer?.startListening(intent)
    }

    fun stopListening() {
        recognizer?.stopListening()
    }

    fun send(text: String, panel: Boolean = false) {
        val api = api() ?: run {
            exchanges.add(Exchange(you = text, error = "Set your bridge URL and token in Settings first."))
            return
        }
        val index = exchanges.size
        exchanges.add(Exchange(you = text))
        listening = Listening.SENDING
        val brain = forcedBrain
        forcedBrain = null
        viewModelScope.launch {
            try {
                val reply = api.ask(text, conversationId, brain, panel)
                exchanges[index] = Exchange(you = text, reply = reply)
                if (reply.sessionId != null) refreshApproval(api)
                speak(reply.answer, reply.speaker)
            } catch (e: Exception) {
                exchanges[index] = Exchange(you = text, error = e.message ?: "Something went wrong.")
            } finally {
                listening = Listening.IDLE
            }
        }
    }

    fun convene(text: String) {
        val api = api() ?: return
        viewModelScope.launch {
            try {
                val id = api.convene(text)
                exchanges.add(Exchange(you = "Convene the council: $text", reply = CharmReply(
                    "The council is on it. I'll ping you when there's a document to approve.", Brain.GROK, "council", "override", "", false, emptyList(), 0.0, id
                )))
            } catch (e: Exception) {
                exchanges.add(Exchange(you = "Convene the council: $text", error = e.message))
            }
        }
    }

    fun approve(session: SessionView, execute: Boolean) {
        val api = api() ?: return
        val token = session.approvalToken ?: return
        viewModelScope.launch {
            try {
                api.approve(session.id, token, execute)
                pendingApproval = null
                speak(if (execute) "Approved. The Chief Engineer is building it now." else "Approved.", Brain.GROK)
            } catch (e: Exception) {
                connectionError = e.message
            }
        }
    }

    fun newConversation() {
        val api = api()
        val old = conversationId
        conversationId = UUID.randomUUID().toString()
        exchanges.clear()
        if (api != null) viewModelScope.launch { runCatching { api.forget(old) } }
    }

    private fun speak(text: String, brain: Brain) {
        if (!prefs.speak || !ttsReady || text.isBlank()) return
        speakingBrain = brain
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "charm-${System.nanoTime()}")
        viewModelScope.launch {
            delay(300)
            while (tts?.isSpeaking == true) delay(200)
            if (speakingBrain == brain) speakingBrain = null
        }
    }

    fun stopSpeaking() {
        tts?.stop()
        speakingBrain = null
    }

    override fun onCleared() {
        recognizer?.destroy()
        tts?.shutdown()
        super.onCleared()
    }
}
