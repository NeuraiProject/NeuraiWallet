# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- Reached by name at runtime, so R8 cannot see the reference ---

# WorkManager rebuilds a worker from the class name it stored in its database.
-keep class org.neurai.neuraiwallet.WidgetUpdateWorker { <init>(...); }
-keep class org.neurai.neuraiwallet.MarketWidgetUpdateWorker { <init>(...); }

# The app's own bridge module: React Native looks it up by the @ReactModule name
# and calls @ReactMethod members reflectively from JS.
-keep class org.neurai.neuraiwallet.SettingsModule { *; }
-keep class org.neurai.neuraiwallet.SettingsPackage { *; }

# Activities, widget providers and the Application are named in the manifest,
# which AGP already turns into keep rules — no entries needed for those here.
