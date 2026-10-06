package org.neurai.neuraiwallet

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.neurai.neuraiwallet.NativeSecureClipboardSpec

/**
 * Copies text flagged as sensitive, so Android 13+ hides it in the clipboard preview and keyboards
 * such as Gboard keep it out of their clipboard history. Used for private keys.
 */
@ReactModule(name = SecureClipboardModule.NAME)
class SecureClipboardModule(reactContext: ReactApplicationContext) : NativeSecureClipboardSpec(reactContext) {

    companion object {
        const val NAME = "SecureClipboard"
        // ClipDescription.EXTRA_IS_SENSITIVE only exists from API 33; older releases read the raw key.
        private const val EXTRA_IS_SENSITIVE_COMPAT = "android.content.extra.IS_SENSITIVE"
    }

    @ReactMethod
    override fun setSensitiveString(text: String, promise: Promise) {
        try {
            val clipboard = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("", text)
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ClipDescription.EXTRA_IS_SENSITIVE else EXTRA_IS_SENSITIVE_COMPAT
            clip.description.extras = PersistableBundle().apply { putBoolean(key, true) }
            clipboard.setPrimaryClip(clip)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SECURE_CLIPBOARD_ERROR", e)
        }
    }
}
