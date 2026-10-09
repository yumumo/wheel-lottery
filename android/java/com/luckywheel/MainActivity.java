package com.luckywheel;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 幸运转盘 Android 壳。
 *
 * Web 内容来自 assets/www，通过 shouldInterceptRequest 映射到虚拟 https 源，
 * 这样 localStorage 有一个稳定的 https origin（file:// 的 origin 是临时的，
 * 用户设好的选项会在重启后丢失 —— 所以不用 file:///android_asset）。
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://wheel.local";
    private static final int REQ_FILE = 1001;

    private WebView web;
    private ValueCallback<Uri[]> pendingFile;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage：选项持久化的命脉
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);           // 不走 file://，只走拦截的 https 源
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                    // 屏蔽系统超大字体，避免布局被撑破
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null) return null;
                if (!ORIGIN.equals(u.getScheme() + "://" + u.getAuthority())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null) return true;
                // 内部链接放行；外部链接本 App 不处理（当前无外链）
                return !ORIGIN.equals(u.getScheme() + "://" + u.getAuthority());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                // 导入 Excel/Word 依赖 <input type="file">，不实现这里按钮点了没反应
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (Exception e) {
                    pendingFile = null;
                    return false;
                }
                return true;
            }
        });

        if (saved == null) {
            web.loadUrl(ORIGIN + "/index.html");
        } else {
            web.restoreState(saved);
        }
    }

    /** 把虚拟 https 路径映射到 assets/www 下的文件。 */
    private WebResourceResponse serve(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..")) return notFound();          // 路径穿越，输入来自 Web 请求
        String asset = "www" + path;
        try {
            InputStream in = getAssets().open(asset);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mimeOf(asset), "utf-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), null);
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (pendingFile != null) {
                Uri[] uris = null;
                if (res == RESULT_OK && data != null && data.getData() != null) {
                    uris = new Uri[]{ data.getData() };
                }
                // 取消也要回调，否则 input 会永远卡在 pending 状态
                pendingFile.onReceiveValue(uris);
                pendingFile = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }
}
