package com.sunbeamhub.xml2jianpu

import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.ViewTreeObserver
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.IOException

class MainActivity : TauriActivity() {
  private var appSchemeDark: Boolean? = null
  private var webViewRef: WebView? = null
  private var cachedTop = 0
  private var cachedBottom = 0
  private var cachedLeft = 0
  private var cachedRight = 0
  private var preDrawListener: ViewTreeObserver.OnPreDrawListener? = null
  private var pageReady = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applySystemBarAppearance(resolveSchemeDark())
  }

  override fun onResume() {
    super.onResume()
    applySystemBarAppearance(resolveSchemeDark())
    if (pageReady) {
      scheduleReplaySafeAreaInsets()
    }
  }

  override fun onConfigurationChanged(configuration: Configuration) {
    super.onConfigurationChanged(configuration)
    if (appSchemeDark == null) {
      applySystemBarAppearance(resolveSchemeDark())
    }
    webViewRef?.let { ViewCompat.requestApplyInsets(it) }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(AndroidChromeBridge(), "AndroidChrome")
    webView.setBackgroundColor(0x00000000)
    attachSafeAreaWebViewClient(webView)
    updateCachedInsets(0, 0, 0, 0)

    val insetTypes =
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      updateCachedInsets(
        top = insetPxToCssPx(maxInset(systemBars.top, displayCutout.top)),
        bottom = insetPxToCssPx(maxInset(systemBars.bottom, displayCutout.bottom)),
        left = insetPxToCssPx(maxInset(systemBars.left, displayCutout.left)),
        right = insetPxToCssPx(maxInset(systemBars.right, displayCutout.right)),
      )
      if (pageReady) {
        scheduleReplaySafeAreaInsets()
      }
      if (cachedTop == 0) {
        ensureNonZeroTopInsetFallback()
      } else {
        removePreDrawListener()
      }
      WindowInsetsCompat.Builder(insets)
        .setInsets(insetTypes, Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun attachSafeAreaWebViewClient(webView: WebView) {
    val delegate = webView.webViewClient
    webView.webViewClient =
      object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
          view: WebView,
          request: WebResourceRequest,
        ): Boolean = delegate.shouldOverrideUrlLoading(view, request)

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
          @Suppress("DEPRECATION")
          return delegate.shouldOverrideUrlLoading(view, url)
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
          pageReady = false
          delegate.onPageStarted(view, url, favicon)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
          delegate.onPageFinished(view, url)
          onWebPageVisible()
        }

        override fun onPageCommitVisible(view: WebView?, url: String?) {
          delegate.onPageCommitVisible(view, url)
          onWebPageVisible()
        }
      }
  }

  private fun onWebPageVisible() {
    pageReady = true
    scheduleReplaySafeAreaInsets()
    webViewRef?.let { ViewCompat.requestApplyInsets(it) }
  }

  private fun systemBarHeightCssPx(dimenName: String): Int {
    val resourceId = resources.getIdentifier(dimenName, "dimen", "android")
    if (resourceId <= 0) return 0
    return insetPxToCssPx(resources.getDimensionPixelSize(resourceId))
  }

  private fun updateCachedInsets(top: Int, bottom: Int, left: Int, right: Int) {
    val topFallback = systemBarHeightCssPx("status_bar_height")
    val bottomFallback = systemBarHeightCssPx("navigation_bar_height")
    cachedTop = maxOf(top, topFallback)
    cachedBottom = maxOf(bottom, bottomFallback)
    cachedLeft = left
    cachedRight = right
  }

  private fun scheduleReplaySafeAreaInsets() {
    val webView = webViewRef ?: return
    webView.post {
      applySafeAreaInsets(cachedTop, cachedBottom, cachedLeft, cachedRight)
    }
  }

  private fun reapplySafeAreaInsets() {
    if (!pageReady) return
    scheduleReplaySafeAreaInsets()
  }

  private fun ensureNonZeroTopInsetFallback() {
    if (cachedTop > 0) {
      removePreDrawListener()
      if (pageReady) scheduleReplaySafeAreaInsets()
      return
    }
    val webView = webViewRef ?: return
    if (preDrawListener != null) return

    preDrawListener =
      ViewTreeObserver.OnPreDrawListener {
        val view = webViewRef
        if (view == null) {
          removePreDrawListener()
          return@OnPreDrawListener true
        }
        if (cachedTop > 0) {
          if (pageReady) scheduleReplaySafeAreaInsets()
          removePreDrawListener()
          return@OnPreDrawListener true
        }
        val topFallback = systemBarHeightCssPx("status_bar_height")
        if (topFallback > 0) {
          cachedTop = topFallback
          if (pageReady) scheduleReplaySafeAreaInsets()
          removePreDrawListener()
          return@OnPreDrawListener true
        }
        ViewCompat.requestApplyInsets(view)
        true
      }
    webView.viewTreeObserver.addOnPreDrawListener(preDrawListener!!)
  }

  private fun removePreDrawListener() {
    val webView = webViewRef
    val listener = preDrawListener
    if (webView != null && listener != null && webView.viewTreeObserver.isAlive) {
      webView.viewTreeObserver.removeOnPreDrawListener(listener)
    }
    preDrawListener = null
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
        if (!root) return;
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

    webViewRef?.let { view ->
      ViewCompat.requestApplyInsets(view)
      reapplySafeAreaInsets()
    }
  }

  private inner class AndroidChromeBridge {
    @JavascriptInterface
    fun setThemePreference(pref: String) {
      runOnUiThread {
        when (pref) {
          "auto" -> {
            appSchemeDark = null
            applySystemBarAppearance(resolveSchemeDark())
          }
          "dark" -> {
            appSchemeDark = true
            applySystemBarAppearance(true)
          }
          else -> {
            appSchemeDark = false
            applySystemBarAppearance(false)
          }
        }
      }
    }

    @JavascriptInterface
    fun requestSafeAreaSync() {
      runOnUiThread {
        pageReady = true
        scheduleReplaySafeAreaInsets()
        webViewRef?.let { ViewCompat.requestApplyInsets(it) }
      }
    }

    @JavascriptInterface
    @Throws(IOException::class)
    fun writeContentUri(uri: String, base64: String) {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val target = Uri.parse(uri)
      val output =
        this@MainActivity.contentResolver.openOutputStream(target, "wt")
          ?: this@MainActivity.contentResolver.openOutputStream(target)
      output?.use { it.write(bytes) }
        ?: throw IOException("Cannot open output stream: $uri")
    }
  }
}
