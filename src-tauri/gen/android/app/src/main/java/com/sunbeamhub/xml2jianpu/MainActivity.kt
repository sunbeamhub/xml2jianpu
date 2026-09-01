package com.sunbeamhub.xml2jianpu

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var appSchemeDark: Boolean? = null
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applySystemBarAppearance(resolveSchemeDark())
  }

  override fun onResume() {
    super.onResume()
    applySystemBarAppearance(resolveSchemeDark())
  }

  override fun onConfigurationChanged(configuration: Configuration) {
    super.onConfigurationChanged(configuration)
    if (appSchemeDark == null) {
      applySystemBarAppearance(resolveSchemeDark())
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(AndroidChromeBridge(), "AndroidChrome")
    webView.setBackgroundColor(0x00000000)

    val insetTypes =
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      applySafeAreaInsets(
        top = insetPxToCssPx(maxInset(systemBars.top, displayCutout.top)),
        bottom = insetPxToCssPx(maxInset(systemBars.bottom, displayCutout.bottom)),
        left = insetPxToCssPx(maxInset(systemBars.left, displayCutout.left)),
        right = insetPxToCssPx(maxInset(systemBars.right, displayCutout.right)),
      )
      WindowInsetsCompat.Builder(insets)
        .setInsets(insetTypes, Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun resolveSchemeDark(): Boolean {
    appSchemeDark?.let { return it }
    val nightMode =
      resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return nightMode == Configuration.UI_MODE_NIGHT_YES
  }

  private fun insetPxToCssPx(insetPx: Int): Int {
    if (insetPx <= 0) return 0
    val density = resources.displayMetrics.density
    return (insetPx / density + 0.5f).toInt()
  }

  private fun applySafeAreaInsets(top: Int, bottom: Int, left: Int, right: Int) {
    val script =
      """
      (function() {
        var root = document.documentElement;
        root.style.setProperty('--safe-area-top', '${top}px');
        root.style.setProperty('--safe-area-bottom', '${bottom}px');
        root.style.setProperty('--safe-area-left', '${left}px');
        root.style.setProperty('--safe-area-right', '${right}px');
      })();
      """.trimIndent()

    runOnUiThread {
      webViewRef?.evaluateJavascript(script, null)
    }
  }

  private fun maxInset(a: Int, b: Int): Int = if (a > b) a else b

  private fun applySystemBarAppearance(isDark: Boolean) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = android.graphics.Color.TRANSPARENT
    window.navigationBarColor = android.graphics.Color.TRANSPARENT

    val controller = WindowInsetsControllerCompat(window, window.decorView)
    val useLightIcons = !isDark
    controller.isAppearanceLightStatusBars = useLightIcons
    controller.isAppearanceLightNavigationBars = useLightIcons
  }

  private inner class AndroidChromeBridge {
    @JavascriptInterface
    fun setScheme(scheme: String) {
      val isDark = scheme == "dark"
      appSchemeDark = isDark
      runOnUiThread { applySystemBarAppearance(isDark) }
    }
  }
}
