package ir.roozeman.planner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

public final class NotificationEngine {
    private static final String CHANNEL = "roozeman_reminders";
    private NotificationEngine() {}
    private static NotificationManager manager(Context c) {
        return (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
    }
    public static boolean permitted(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
    }
    public static int notificationId(String id,long when) {return (id+"|"+when).hashCode() & 0x7fffffff;}
    public static void show(Context c, String id, String title, String body, long occurrence) {
        if (!permitted(c)) return;
        NotificationManager mgr = manager(c);
        NotificationChannel channel = new NotificationChannel(CHANNEL,"یادآوری‌های روزِ من",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("اعلان‌های زمان‌بندی‌شده و دوره‌ای برنامه‌ریز شخصی");
        mgr.createNotificationChannel(channel);
        Intent openIntent = new Intent(c,MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(c,notificationId(id,occurrence),openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Intent ackIntent = new Intent(c,AlarmReceiver.class).setAction(PlannerStore.ACTION_ACK)
            .setData(Uri.parse("roozeman://ack/"+Uri.encode(id)+"/"+occurrence))
            .putExtra("id",id).putExtra("occurrence",occurrence);
        PendingIntent acknowledge = PendingIntent.getBroadcast(c,0,ackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(c,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title).setContentText(body.isEmpty()?"زمان یادآوری رسید":body)
            .setStyle(new Notification.BigTextStyle().bigText(body.isEmpty()?"زمان یادآوری رسید":body))
            .setContentIntent(open).setAutoCancel(false).setOngoing(true)
            .setWhen(occurrence).setShowWhen(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(android.R.drawable.ic_menu_view,"مشاهده شد",acknowledge).build();
        mgr.notify(notificationId(id,occurrence),notification);
    }
    public static void cancel(Context c,String id,long occurrence) {
        manager(c).cancel(notificationId(id,occurrence));
    }
}
