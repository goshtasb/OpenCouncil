package com.opencouncil.charm

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.sin
import kotlin.random.Random

/** Each mind keeps its council colours: Claude coral, Gemini blue-violet, Grok monochrome. */
data class FaceStyle(val body: Brush, val ink: Color, val glow: Color)

fun styleOf(brain: Brain): FaceStyle = when (brain) {
    Brain.CLAUDE -> FaceStyle(Brush.verticalGradient(listOf(Color(0xFFE58A6C), Color(0xFFC9623F))), Color(0xFF2A1208), Color(0xFFD97757))
    Brain.GEMINI -> FaceStyle(Brush.linearGradient(listOf(Color(0xFF4F8BFF), Color(0xFF9C6BFF))), Color(0xFF0B1030), Color(0xFF7B8CFF))
    Brain.GROK -> FaceStyle(Brush.verticalGradient(listOf(Color(0xFF2B2B2E), Color(0xFF111113))), Color(0xFFF2F2F2), Color(0xFFBFBFBF))
}

/**
 * One animated face. state: idle | thinking | council | error; speaking/selected come from the app.
 * idle blinks, thinking looks around, speaking moves the mouth, council wears a steady busy glow, error shows X eyes.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CharmFace(
    brain: Brain,
    state: String,
    speaking: Boolean,
    selected: Boolean,
    size: Dp,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
    modifier: Modifier = Modifier
) {
    val style = styleOf(brain)
    val t = rememberInfiniteTransition(label = "face-${brain.id}")
    val phase by t.animateFloat(0f, 6.2832f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "phase")
    val pulse by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    val active = speaking || state == "thinking" || state == "council"
    val glow by animateFloatAsState(if (active || selected) 1f else 0f, tween(400), label = "glow")

    var blink by remember { mutableFloatStateOf(1f) }
    LaunchedEffect(brain) {
        while (true) {
            delay(Random.nextLong(2200, 5200))
            blink = 0.1f; delay(110); blink = 1f
        }
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = modifier) {
        Canvas(
            Modifier
                .size(size)
                .combinedClickable(onClick = onTap, onLongClick = onLongPress)
        ) {
            val w = this.size.width
            val h = this.size.height
            // Halo
            if (glow > 0f) {
                val a = glow * (if (active) 0.25f + 0.35f * pulse else 0.45f)
                drawCircle(style.glow.copy(alpha = a), radius = w * 0.52f, center = Offset(w / 2, h / 2))
            }
            // Body: a rounded charm
            val inset = w * 0.08f
            drawRoundRect(style.body, Offset(inset, inset), Size(w - 2 * inset, h - 2 * inset), CornerRadius(w * 0.3f))
            if (brain == Brain.GROK) {
                drawRoundRect(Color(0x33FFFFFF), Offset(inset, inset), Size(w - 2 * inset, h - 2 * inset), CornerRadius(w * 0.3f), style = Stroke(w * 0.015f))
            }

            val eyeY = h * 0.43f
            val eyeDx = w * 0.17f
            val look = when (state) {
                "thinking" -> Offset(sin(phase) * w * 0.05f, -h * 0.03f)
                else -> Offset.Zero
            }
            if (state == "error") {
                xEye(Offset(w / 2 - eyeDx, eyeY), w * 0.06f, style.ink)
                xEye(Offset(w / 2 + eyeDx, eyeY), w * 0.06f, style.ink)
            } else {
                val ew = w * 0.085f
                val eh = w * 0.13f * (if (state == "thinking") 1f else blink)
                for (dx in listOf(-eyeDx, eyeDx)) {
                    val c = Offset(w / 2 + dx, eyeY) + look
                    drawRoundRect(style.ink, Offset(c.x - ew / 2, c.y - eh / 2), Size(ew, eh), CornerRadius(ew / 2))
                }
            }

            // Mouth
            val mouthW = w * 0.24f
            val mouthY = h * 0.66f
            val open = if (speaking) (0.25f + 0.75f * ((sin(phase * 3) + 1) / 2)) else 0f
            if (open > 0.02f) {
                val mh = h * 0.1f * open
                drawRoundRect(style.ink, Offset(w / 2 - mouthW / 2, mouthY - mh / 2), Size(mouthW, mh.coerceAtLeast(h * 0.02f)), CornerRadius(mh / 2))
            } else {
                val smile = if (state == "error") -1f else if (state == "council") 0f else 1f
                drawArc(
                    style.ink,
                    startAngle = if (smile >= 0) 20f else 200f,
                    sweepAngle = if (smile == 0f) 0.1f else 140f,
                    useCenter = false,
                    topLeft = Offset(w / 2 - mouthW / 2, mouthY - h * 0.08f + if (smile < 0) h * 0.08f else 0f),
                    size = Size(mouthW, h * 0.12f),
                    style = Stroke(w * 0.03f)
                )
                if (smile == 0f) {
                    drawLine(style.ink, Offset(w / 2 - mouthW / 3, mouthY), Offset(w / 2 + mouthW / 3, mouthY), w * 0.03f)
                }
            }
        }
        Text(
            brain.label + if (selected) " ·" else "",
            color = Color(0xFFE6E6EA),
            fontSize = 13.sp,
            fontWeight = if (speaking || selected) FontWeight.Bold else FontWeight.Normal
        )
    }
}

private fun DrawScope.xEye(c: Offset, r: Float, color: Color) {
    drawLine(color, c + Offset(-r, -r), c + Offset(r, r), r * 0.5f)
    drawLine(color, c + Offset(-r, r), c + Offset(r, -r), r * 0.5f)
}
