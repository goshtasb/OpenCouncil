package com.opencouncil.charm

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.DisposableEffect
import kotlinx.coroutines.launch

const val EXTRA_LISTEN = "com.opencouncil.charm.LISTEN"

private val Bg = Color(0xFF0E0F13)
private val Card = Color(0xFF1A1C22)
private val Muted = Color(0xFF9A9CA6)
private val TextC = Color(0xFFE6E6EA)

class MainActivity : ComponentActivity() {
    private val vm: CharmViewModel by viewModels()
    private var listenRequested by mutableStateOf(false)

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.startListening()
    }
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        CouncilWatchWorker.schedule(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(background = Bg, surface = Card)) {
                CharmScreen(vm, onMic = ::listen, listenRequested = listenRequested, consumeListen = { listenRequested = false })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        // Opened from the Quick Settings tile or the assistant gesture: start listening straight away.
        if (intent?.getBooleanExtra(EXTRA_LISTEN, false) == true || intent?.action == Intent.ACTION_ASSIST) {
            listenRequested = true
        }
    }

    private fun listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) vm.startListening()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }
}

@Composable
fun CharmScreen(vm: CharmViewModel, onMic: () -> Unit, listenRequested: Boolean, consumeListen: () -> Unit) {
    var showSettings by remember { mutableStateOf(!vm.prefs.configured) }
    var typed by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_START) vm.startPolling()
            if (e == Lifecycle.Event.ON_STOP) vm.stopPolling()
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(listenRequested) {
        if (listenRequested && vm.prefs.configured) { consumeListen(); onMic() }
    }
    LaunchedEffect(vm.exchanges.size) {
        if (vm.exchanges.isNotEmpty()) listState.animateScrollToItem(vm.exchanges.size - 1)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .safeDrawingPadding()
            .imePadding()
            .padding(horizontal = 16.dp)
    ) {
        // Header
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Charm", color = TextC, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.newConversation() }) { Text("New", color = Muted) }
            TextButton(onClick = { showSettings = true }) { Text("Settings", color = Muted) }
        }

        // The three minds
        val faces = vm.status?.faces
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            for (b in Brain.entries) {
                CharmFace(
                    brain = b,
                    state = faces?.get(b)?.state ?: "idle",
                    speaking = vm.speakingBrain == b,
                    selected = vm.forcedBrain == b,
                    size = 92.dp,
                    onTap = { if (vm.speakingBrain != null) vm.stopSpeaking() },
                    onLongPress = { vm.forcedBrain = if (vm.forcedBrain == b) null else b }
                )
            }
        }
        val hint = when {
            vm.connectionError != null -> vm.connectionError!!
            vm.forcedBrain != null -> "Next question goes to ${vm.forcedBrain!!.label} only. Long-press again to cancel."
            else -> vm.status?.ticker ?: "Long-press a face to ask only that mind."
        }
        Text(hint, color = if (vm.connectionError != null) Color(0xFFFF8A80) else Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth())

        vm.pendingApproval?.let { ApprovalCard(it, vm) }

        // Conversation
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp), state = listState) {
            itemsIndexed(vm.exchanges) { _, ex -> ExchangeView(ex, vm) }
        }

        if (vm.listening == Listening.LISTENING && vm.partial.isNotBlank()) {
            Text(vm.partial, color = Muted, fontSize = 15.sp, modifier = Modifier.padding(vertical = 6.dp))
        }

        // Input row: type, or tap the mic
        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                placeholder = { Text("Ask the charm…") },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(10.dp))
            if (typed.isNotBlank()) {
                Button(onClick = { vm.send(typed.trim()); typed = "" }) { Text("Send") }
            } else {
                MicButton(vm.listening) { if (vm.listening == Listening.LISTENING) vm.stopListening() else onMic() }
            }
        }
    }

    if (showSettings) SettingsDialog(vm) { showSettings = false; scope.launch { vm.startPolling() } }
}

@Composable
private fun MicButton(state: Listening, onClick: () -> Unit) {
    val color = when (state) {
        Listening.LISTENING -> Color(0xFFFF5A5F)
        Listening.SENDING -> Color(0xFF555866)
        Listening.IDLE -> Color(0xFFD97757)
    }
    Box(
        Modifier.size(58.dp).clip(CircleShape).background(color).clickable(enabled = state != Listening.SENDING, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            when (state) { Listening.LISTENING -> "■"; Listening.SENDING -> "…"; Listening.IDLE -> "🎙" },
            fontSize = 22.sp, color = Color.White
        )
    }
}

@Composable
private fun ExchangeView(ex: Exchange, vm: CharmViewModel) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        if (ex.you.isNotBlank()) {
            Text(ex.you, color = TextC, fontSize = 15.sp, modifier = Modifier.align(Alignment.End)
                .clip(RoundedCornerShape(14.dp)).background(Color(0xFF2A2D36)).padding(10.dp))
        }
        Spacer(Modifier.height(4.dp))
        when {
            ex.error != null -> Text(ex.error, color = Color(0xFFFF8A80), fontSize = 14.sp)
            ex.reply == null -> Text("Thinking…", color = Muted, fontSize = 14.sp)
            else -> {
                val r = ex.reply
                val tag = when (r.mode) {
                    "panel" -> "Panel · ${r.speaker.label} rules"
                    "council" -> "Council convened"
                    else -> r.speaker.label
                }
                Text("$tag · ${r.via}${if (r.reason.isNotBlank()) " · ${r.reason}" else ""} · ${"%.1f".format(r.seconds)}s",
                    color = styleOf(r.speaker).glow, fontSize = 11.sp)
                Text(r.answer, color = TextC, fontSize = 15.sp, modifier = Modifier
                    .clip(RoundedCornerShape(14.dp)).background(Card).padding(10.dp))
                if (r.panel.isNotEmpty()) PanelDetails(r.panel)
                if (r.suggestCouncil) {
                    TextButton(onClick = { vm.convene(ex.you) }) { Text("This sounds like council work — convene the council?") }
                }
            }
        }
    }
}

@Composable
private fun PanelDetails(panel: List<PanelView>) {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = !open }) { Text(if (open) "Hide what each said" else "What each said", color = Muted, fontSize = 12.sp) }
    if (open) for (p in panel) {
        Text("${p.brain.label} (${"%.1f".format(p.seconds)}s): ${p.answer ?: "— ${p.error}"}",
            color = Muted, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp, bottom = 6.dp))
    }
}

@Composable
private fun ApprovalCard(s: SessionView, vm: CharmViewModel) {
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFF22261F)).padding(12.dp)) {
        Text("The council signed off a PRD", color = Color(0xFFB9F6A8), fontWeight = FontWeight.Bold)
        Text("${s.id} · ${s.rounds} round(s)", color = Muted, fontSize = 11.sp)
        Text(s.summary ?: "", color = TextC, fontSize = 13.sp, maxLines = 8, modifier = Modifier.padding(vertical = 6.dp))
        Row {
            Button(onClick = { confirm = true }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3C7A35))) { Text("Approve & build") }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = { confirm = false }) { Text("Approve only") }
        }
    }
    confirm?.let { execute ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (execute) "Approve and build?" else "Approve?") },
            text = {
                Text("You are signing:\n${s.approvalToken}\n\n" + if (execute)
                    "The Chief Engineer will implement it in an isolated clone, run your gates, and open a pull request."
                else "Nothing is built until you run `council run` on your Mac.", fontFamily = FontFamily.Default)
            },
            confirmButton = { Button(onClick = { vm.approve(s, execute); confirm = null }) { Text("Approve") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun SettingsDialog(vm: CharmViewModel, onDone: () -> Unit) {
    var url by remember { mutableStateOf(vm.prefs.baseUrl) }
    var token by remember { mutableStateOf(vm.prefs.token) }
    var speak by remember { mutableStateOf(vm.prefs.speak) }
    var result by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text("Connect to your Mac") },
        text = {
            Column {
                Text("On the Mac: `council charm`, then `tailscale serve --bg 4322`. Paste the https://….ts.net address and `council charm token`.", fontSize = 12.sp, color = Muted)
                OutlinedTextField(url, { url = it }, label = { Text("Bridge URL") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                OutlinedTextField(token, { token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Text("Speak answers", modifier = Modifier.weight(1f))
                    Switch(speak, { speak = it })
                }
                result?.let { Text(it, fontSize = 12.sp, color = if (it.startsWith("Connected")) Color(0xFFB9F6A8) else Color(0xFFFF8A80)) }
            }
        },
        confirmButton = {
            Button(onClick = {
                vm.prefs.baseUrl = url; vm.prefs.token = token; vm.prefs.speak = speak
                scope.launch {
                    result = try {
                        val api = CharmApi(vm.prefs.baseUrl, vm.prefs.token)
                        api.health(); api.status()
                        "Connected."
                    } catch (e: Exception) { e.message }
                    if (result == "Connected.") onDone()
                }
            }) { Text("Save & test") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Close") } }
    )
}
