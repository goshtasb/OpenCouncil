package com.opencouncil.charm.assist

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import com.opencouncil.charm.EXTRA_LISTEN
import com.opencouncil.charm.MainActivity

/**
 * Makes the charm selectable under Settings → Apps → Default apps → Digital assistant app.
 * The assist gesture (long-press power or home) opens the charm listening.
 */
class CharmVoiceService : VoiceInteractionService()

class CharmSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = CharmSession(this)
}

class CharmSession(context: Context) : VoiceInteractionSession(context) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        startAssistantActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_LISTEN, true)
        )
        hide()
    }
}

/** Android requires an assistant to declare a recogniser; the charm uses the system's own, so this one declines. */
class CharmRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        listener?.error(SpeechRecognizer.ERROR_CLIENT)
    }
    override fun onCancel(listener: Callback?) {}
    override fun onStopListening(listener: Callback?) {}
}
