package com.dielin44.inventory;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline inventory workspace. Native access is limited to user-selected photos/files. */
public final class MainActivity extends Activity {
    private static final String ORIGIN_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ORIGIN_HOST + "/assets/www/index.html";
    private static final String DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final long MAX_EXPORT_SIZE = 200L * 1024L * 1024L;
    private static final int MAX_CHUNK_SIZE = 128 * 1024;
    private static final int PICK_FILE = 201, TAKE_PHOTO = 202, SAVE_EXPORT = 203;
    private static final int URI_GRANTS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private final Object exportLock = new Object();
    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private volatile boolean trustedDocument;
    private volatile boolean destroyed;
    private ExportSession exportSession;
    private String pendingSaveId;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;
    private File deliveredCameraFile;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        clearOldCache("exports");
        clearOldCache("camera");
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 246, 243));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(245, 246, 243));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.requestApplyInsets();
        assetLoader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Needed only for content URIs returned by the file picker.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setTextZoom(100);
        webView.addJavascriptInterface(new ExportBridge(), "InventoryAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isBundledUrl(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isBundledUrl(Uri.parse(url));
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                trustedDocument = isBundledUrl(Uri.parse(url));
                if (!trustedDocument) view.stopLoading();
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isBundledUrl(request.getUrl())) return deniedResponse();
                WebResourceResponse result = assetLoader.shouldInterceptRequest(request.getUrl());
                return result != null ? result : deniedResponse();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trustedDocument) { callback.onReceiveValue(null); return true; }
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                if (deliveredCameraFile != null) { deliveredCameraFile.delete(); deliveredCameraFile = null; }
                String mime = pickerMime(params.getAcceptTypes());
                if (params.isCaptureEnabled() && mime.startsWith("image/")) launchCamera();
                else launchPicker(mime);
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) ->
            Toast.makeText(this, "請使用匯出按鍵儲存檔案", Toast.LENGTH_SHORT).show());
        trustedDocument = true;
        webView.loadUrl(START_URL);
    }

    private static boolean isBundledUrl(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || !ORIGIN_HOST.equals(uri.getHost()) || uri.getPort() != -1 || uri.getUserInfo() != null) return false;
        String path = uri.getPath();
        return path != null && path.startsWith("/assets/www/") && !path.contains("..") && !path.contains("\\");
    }

    private static WebResourceResponse deniedResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream("Blocked".getBytes(StandardCharsets.UTF_8)));
    }

    private static String pickerMime(String[] accepts) {
        if (accepts != null) for (String accept : accepts) {
            if (accept == null) continue;
            if (accept.contains("image")) return "image/*";
            if (accept.contains("json")) return "application/json";
        }
        return "*/*";
    }

    private void launchPicker(String mime) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(intent, PICK_FILE); }
        catch (RuntimeException e) { finishFileChoice(null); message("無法開啟選檔工具，請確認手機已有檔案管理程式"); }
    }

    private void launchCamera() {
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(getPackageManager()) == null) {
            message("找不到相機，改為選取照片");
            launchPicker("image/*");
            return;
        }
        try {
            File directory = new File(getCacheDir(), "camera");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("無法建立照片暫存");
            cameraFile = File.createTempFile("capture-", ".jpg", directory);
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", cameraFile);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            intent.setClipData(ClipData.newRawUri("物品照片", cameraUri));
            intent.addFlags(URI_GRANTS);
            startActivityForResult(intent, TAKE_PHOTO);
        } catch (RuntimeException | IOException e) {
            cleanupCamera();
            message("無法開啟相機，改為選取照片");
            launchPicker("image/*");
        }
    }

    private void finishFileChoice(Uri[] result) {
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback != null) callback.onReceiveValue(result);
    }

    private void cleanupCamera() {
        if (cameraUri != null) { try { revokeUriPermission(cameraUri, URI_GRANTS); } catch (RuntimeException ignored) {} }
        if (cameraFile != null) cameraFile.delete();
        cameraUri = null;
        cameraFile = null;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == TAKE_PHOTO) {
            Uri[] selection = null;
            if (result == RESULT_OK && cameraUri != null && cameraFile != null && cameraFile.length() > 0) {
                selection = new Uri[] {cameraUri};
                deliveredCameraFile = cameraFile;
                cameraFile = null;
            }
            cleanupCamera();
            finishFileChoice(selection);
        } else if (request == PICK_FILE) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            finishFileChoice(uri != null && "content".equals(uri.getScheme()) ? new Uri[] {uri} : null);
        } else if (request == SAVE_EXPORT) {
            String id = pendingSaveId;
            pendingSaveId = null;
            if (id == null) return;
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) { completeExport(id, "cancel", null); return; }
            if (!"content".equals(uri.getScheme())) { completeExport(id, "error", "無效的儲存位置"); return; }
            fileExecutor.execute(() -> writeExport(id, uri));
        }
    }

    private final class ExportBridge {
        @JavascriptInterface public String startExport(String name, String mime, long size) {
            synchronized (exportLock) {
                if (!trustedDocument || destroyed || exportSession != null || size < 0 || size > MAX_EXPORT_SIZE) return "";
                if (!DOCX_MIME.equals(mime) && !"application/json".equals(mime)) return "";
                try {
                    File directory = new File(getCacheDir(), "exports");
                    if (!directory.isDirectory() && !directory.mkdirs()) return "";
                    String safeName = sanitizeFilename(name, "application/json".equals(mime) ? ".json" : ".docx");
                    File temporary = File.createTempFile("export-", ".tmp", directory);
                    exportSession = new ExportSession(UUID.randomUUID().toString(), safeName, mime, size, temporary);
                    return exportSession.id;
                } catch (IOException | RuntimeException e) { return ""; }
            }
        }

        @JavascriptInterface public boolean appendExport(String id, String base64) {
            synchronized (exportLock) {
                ExportSession session = exportSession;
                if (!trustedDocument || destroyed || session == null || !session.id.equals(id) || session.ready || base64 == null || base64.length() > 174764) return false;
                try {
                    if (!base64.matches("[A-Za-z0-9+/]*={0,2}") || base64.length() % 4 != 0) return false;
                    byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
                    if (bytes.length > MAX_CHUNK_SIZE || session.written + bytes.length > session.expected || session.written + bytes.length > MAX_EXPORT_SIZE) return false;
                    session.output.write(bytes);
                    session.written += bytes.length;
                    return true;
                } catch (IOException | IllegalArgumentException e) { return false; }
            }
        }

        @JavascriptInterface public boolean finishExport(String id) {
            synchronized (exportLock) {
                ExportSession session = exportSession;
                if (!trustedDocument || destroyed || session == null || !session.id.equals(id) || session.ready || session.written != session.expected) return false;
                try { session.output.close(); session.ready = true; }
                catch (IOException e) { return false; }
                runOnUiThread(() -> showSavePicker(id));
                return true;
            }
        }

        @JavascriptInterface public void cancelExport(String id) {
            if (trustedDocument) completeExport(id, "cancel", null);
        }
    }

    private static String sanitizeFilename(String name, String extension) {
        String result = name == null ? "財產清冊" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (result.isEmpty()) result = "財產清冊";
        if (result.length() > 100) result = result.substring(0, 100);
        if (!result.toLowerCase(java.util.Locale.ROOT).endsWith(extension)) result += extension;
        return result;
    }

    private void showSavePicker(String id) {
        ExportSession session;
        synchronized (exportLock) { session = exportSession; }
        if (destroyed || session == null || !session.id.equals(id) || !session.ready) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(session.mime);
        intent.putExtra(Intent.EXTRA_TITLE, session.name);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        pendingSaveId = id;
        try { startActivityForResult(intent, SAVE_EXPORT); }
        catch (RuntimeException e) { pendingSaveId = null; completeExport(id, "error", "無法開啟儲存工具"); }
    }

    private void writeExport(String id, Uri uri) {
        ExportSession session;
        synchronized (exportLock) { session = exportSession; }
        if (session == null || !session.id.equals(id)) return;
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(session.file));
             OutputStream rawOutput = getContentResolver().openOutputStream(uri, "wt")) {
            if (rawOutput == null) throw new IOException("無法開啟儲存位置");
            try (BufferedOutputStream output = new BufferedOutputStream(rawOutput)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            completeExport(id, "success", null);
        } catch (IOException | RuntimeException e) { completeExport(id, "error", "儲存失敗，請檢查可用空間或重新選擇位置"); }
    }

    private void completeExport(String id, String status, String error) {
        synchronized (exportLock) {
            if (id == null || exportSession == null || !exportSession.id.equals(id)) return;
            try { exportSession.output.close(); } catch (IOException ignored) {}
            exportSession.file.delete();
            exportSession = null;
        }
        runOnUiThread(() -> {
            if (destroyed || webView == null || !trustedDocument) return;
            JSONObject payload = new JSONObject();
            try { payload.put("id", id); payload.put("status", status); if (error != null) payload.put("error", error); }
            catch (org.json.JSONException ignored) { return; }
            webView.evaluateJavascript("window.inventoryNativeExportResult && window.inventoryNativeExportResult(" + payload + ");", null);
        });
    }

    private static final class ExportSession {
        final String id, name, mime;
        final long expected;
        final File file;
        final BufferedOutputStream output;
        long written;
        boolean ready;
        ExportSession(String id, String name, String mime, long expected, File file) throws IOException {
            this.id = id; this.name = name; this.mime = mime; this.expected = expected; this.file = file;
            output = new BufferedOutputStream(new FileOutputStream(file));
        }
    }

    private void clearOldCache(String folder) {
        File[] files = new File(getCacheDir(), folder).listFiles();
        if (files != null) for (File file : files) if (file.isFile()) file.delete();
    }

    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        webView.requestApplyInsets();
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(!d)return false;var e=new Event('cancel',{cancelable:true});if(d.dispatchEvent(e))d.close();return true;})()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override protected void onPause() {
        if (webView != null) { webView.evaluateJavascript("window.inventoryNativeFlush && window.inventoryNativeFlush();", null); webView.onPause(); }
        super.onPause();
    }

    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }

    @Override protected void onDestroy() {
        destroyed = true;
        trustedDocument = false;
        finishFileChoice(null);
        cleanupCamera();
        if (deliveredCameraFile != null) deliveredCameraFile.delete();
        synchronized (exportLock) {
            if (exportSession != null) {
                try { exportSession.output.close(); } catch (IOException ignored) {}
                exportSession.file.delete(); exportSession = null;
            }
        }
        fileExecutor.shutdown();
        if (webView != null) { webView.removeJavascriptInterface("InventoryAndroid"); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
