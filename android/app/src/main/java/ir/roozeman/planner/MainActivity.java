package ir.roozeman.planner;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.view.View;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net/";
    private static final int CHOOSE_FILE = 41;
    private static final int SAVE_BACKUP = 42;
    private static final int REQUEST_NOTIFICATION = 43;
    private WebView view;
    private ValueCallback<Uri[]> pendingFile;
    private String backupContent;
    private boolean loaded;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(0xff255b67);
        getWindow().setNavigationBarColor(0xffeff6f5);
        view = new WebView(this);
        setContentView(view);
        WebSettings cfg = view.getSettings();
        cfg.setJavaScriptEnabled(true);
        cfg.setDomStorageEnabled(true);
        cfg.setAllowFileAccess(false);
        cfg.setAllowContentAccess(true);
        cfg.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        cfg.setSupportMultipleWindows(false);
        view.addJavascriptInterface(new Bridge(),"AndroidPlanner");
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r) {
                String url = r.getUrl().toString();
                if (!url.startsWith(ORIGIN)) return null;
                try {
                    String relative = r.getUrl().getEncodedPath();
                    if (relative.startsWith("/")) relative=relative.substring(1);
                    if (relative.isEmpty()) relative="index.html";
                    relative = Uri.decode(relative);
                    if (relative.startsWith("/") || relative.contains("..") || relative.contains("\\")) return notFound();
                    String mime = relative.endsWith(".html") ? "text/html" :
                        relative.endsWith(".js") ? "application/javascript" :
                        relative.endsWith(".css") ? "text/css" :
                        relative.endsWith(".png") ? "image/png" :
                        relative.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream";
                    InputStream input = getAssets().open(relative);
                    return new WebResourceResponse(mime,"UTF-8",input);
                } catch (Exception error) {return notFound();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r) {
                if (r.getUrl().toString().startsWith(ORIGIN)) return false;
                startActivity(new Intent(Intent.ACTION_VIEW,r.getUrl()));
                return true;
            }
            @Override public void onPageFinished(WebView v,String url) {
                loaded=true;
                updatePage();
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if (pendingFile!=null) pendingFile.onReceiveValue(null);
                pendingFile=callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
                startActivityForResult(intent, CHOOSE_FILE);
                return true;
            }
        });
        view.loadUrl(ORIGIN+"index.html");
    }
    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
    }
    private void updatePage() {
        if (loaded) view.evaluateJavascript("window.onNativeStatusChanged && window.onNativeStatusChanged()",null);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        updatePage();
    }
    @Override protected void onResume() {
        super.onResume();
        if (view!=null) {
            PlannerStore.rescheduleAll(this);
            updatePage();
        }
    }
    @Override public void onBackPressed() {
        if (view!=null && view.canGoBack()) view.goBack(); else super.onBackPressed();
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request==CHOOSE_FILE) {
            if (pendingFile!=null) {
                pendingFile.onReceiveValue(result==RESULT_OK && data!=null && data.getData()!=null ?
                    new Uri[]{data.getData()}:null);
                pendingFile=null;
            }
        } else if (request==SAVE_BACKUP) {
            if (result==RESULT_OK && data!=null && data.getData()!=null && backupContent!=null) {
                try (OutputStream out=getContentResolver().openOutputStream(data.getData())) {
                    out.write(backupContent.getBytes(StandardCharsets.UTF_8));
                } catch (Exception e) {android.widget.Toast.makeText(this,"خطا در ذخیرهٔ پشتیبان",android.widget.Toast.LENGTH_LONG).show();}
            }
            backupContent=null;
        }
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if (request==REQUEST_NOTIFICATION) {
            requestExactAlarmPermission();
            updatePage();
        }
    }
    private void requestExactAlarmPermission() {
        AlarmManager alarm=(AlarmManager)getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT>=31 && !alarm.canScheduleExactAlarms()) {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:"+getPackageName())));
            } catch (Exception ignored) {
                android.widget.Toast.makeText(this,"اجازهٔ هشدار دقیق را از تنظیمات برنامه فعال کن.",android.widget.Toast.LENGTH_LONG).show();
            }
        }
    }
    class Bridge {
        @JavascriptInterface public void syncRules(String json) {
            try {PlannerStore.sync(MainActivity.this,json);}catch(Exception e){android.util.Log.e("Roozeman","Sync failed",e);}
        }
        @JavascriptInterface public String getInbox() {return PlannerStore.inbox(MainActivity.this).toString();}
        @JavascriptInterface public String getStatus() {
            try {
                JSONObject result=new JSONObject();
                result.put("notifications",NotificationEngine.permitted(MainActivity.this));
                AlarmManager manager=(AlarmManager)getSystemService(Context.ALARM_SERVICE);
                result.put("exact",Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms());
                return result.toString();
            } catch(Exception e) {return "{}";}
        }
        @JavascriptInterface public void requestPermissions() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    !=PackageManager.PERMISSION_GRANTED) {
                    MainActivity.this.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQUEST_NOTIFICATION);
                } else requestExactAlarmPermission();
            });
        }
        @JavascriptInterface public void acknowledge(String id,String occurrence) {
            try {PlannerStore.acknowledge(MainActivity.this,id,Long.parseLong(occurrence));}catch(Exception ignored){}
        }
        @JavascriptInterface public void testNotification() {
            String id="test:"+System.currentTimeMillis();
            long now=System.currentTimeMillis();
            PlannerStore.addInbox(MainActivity.this,id,"آزمایش اعلان روزِ من",now);
            NotificationEngine.show(MainActivity.this,id,"آزمایش اعلان روزِ من","برای بستن تأییدش کن.",now);
        }
        @JavascriptInterface public void exportBackup(String json) {
            runOnUiThread(() -> {
                backupContent=json;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE,"rooz-e-man-backup.json");
                startActivityForResult(intent,SAVE_BACKUP);
            });
        }
    }
}
