package com.opencouncil.charm

import android.content.Context

/** Bridge address and token. App-private storage; allowBackup is off so the token never leaves the phone. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("charm", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = sp.getString("baseUrl", "") ?: ""
        set(v) = sp.edit().putString("baseUrl", v.trim().trimEnd('/')).apply()

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = sp.edit().putString("token", v.trim()).apply()

    var speak: Boolean
        get() = sp.getBoolean("speak", true)
        set(v) = sp.edit().putBoolean("speak", v).apply()

    /** Sessions we already notified about, so a PRD pings once. */
    var notifiedSessions: Set<String>
        get() = sp.getStringSet("notified", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("notified", v).apply()

    val configured: Boolean get() = baseUrl.startsWith("https://") && token.length >= 32
}
