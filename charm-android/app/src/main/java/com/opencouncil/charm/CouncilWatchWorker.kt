package com.opencouncil.charm

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Every 15 minutes (Android's minimum): if the council has a PRD waiting, notify once per session. */
class CouncilWatchWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        if (!prefs.configured) return Result.success()
        return try {
            val api = CharmApi(prefs.baseUrl, prefs.token)
            val waiting = api.sessions().filter { it.second == "AWAITING_APPROVAL" }.map { it.first }
            val fresh = waiting.filterNot { it in prefs.notifiedSessions }
            for (id in fresh) notify(id, api.session(id).summary)
            prefs.notifiedSessions = (prefs.notifiedSessions + fresh).toList().takeLast(50).toSet()
            Result.success()
        } catch (e: Exception) {
            Result.success() // Mac asleep or offline: try again next period, never spam retries.
        }
    }

    private fun notify(sessionId: String, summary: String?) {
        val ctx = applicationContext
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.channel_council), NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_charm)
            .setContentTitle("The council needs your approval")
            .setContentText(summary?.take(120) ?: sessionId)
            .setStyle(NotificationCompat.BigTextStyle().bigText(summary?.take(600) ?: sessionId))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(sessionId.hashCode(), n)
    }

    companion object {
        private const val CHANNEL = "council"
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<CouncilWatchWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("council-watch", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
