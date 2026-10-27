package ir.roozeman.planner;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.icu.util.ULocale;
import android.icu.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Iterator;

public final class PlannerStore {
    private static final String PREF = "planner_v3_native";
    static final String ACTION_FIRE = "ir.roozeman.planner.FIRE";
    static final String ACTION_ACK = "ir.roozeman.planner.ACK";
    private PlannerStore() {}
    private static SharedPreferences pref(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }
    static synchronized JSONObject rules(Context c) {
        try {return new JSONObject(pref(c).getString("rules", "{}"));}
        catch (Exception ignored) {return new JSONObject();}
    }
    static synchronized JSONObject nextMap(Context c) {
        try {return new JSONObject(pref(c).getString("next", "{}"));}
        catch (Exception ignored) {return new JSONObject();}
    }
    static synchronized JSONObject rule(Context c, String id) {
        return rules(c).optJSONObject(id);
    }
    static synchronized long nextFor(Context c, String id) {
        return nextMap(c).optLong(id, -1);
    }
    static synchronized void sync(Context c, String json) throws JSONException {
        JSONArray array = new JSONArray(json);
        if (array.length() > 10000) throw new JSONException("Too many notification rules");
        JSONObject old = rules(c), fresh = new JSONObject();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.getJSONObject(i);
            String id = item.getString("id");
            if (id.length() > 140 || id.isEmpty() || !item.has("date") || !item.has("time") ||
                !item.has("title")) throw new JSONException("Invalid rule");
            String rep = item.optString("repeat", "none");
            if (!(rep.equals("none") || rep.equals("weekly") || rep.equals("monthly") || rep.equals("yearly")))
                throw new JSONException("Invalid repeat mode");
            fresh.put(id, item);
        }
        // Persist rules before scheduling so the receiver always sees the new content.
        pref(c).edit().putString("rules", fresh.toString()).commit();
        Iterator<String> previous = old.keys();
        while (previous.hasNext()) {
            String id = previous.next();
            if (!fresh.has(id)) cancel(c, id);
        }
        Iterator<String> keys = fresh.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject item = fresh.optJSONObject(id);
            JSONObject oldItem = old.optJSONObject(id);
            // Reuse alarms if none of the rule data changed; previously shown unread items remain.
            if (oldItem != null && oldItem.toString().equals(item.toString()) && nextFor(c,id) > System.currentTimeMillis()) continue;
            cancel(c, id);
            schedule(c, item, System.currentTimeMillis());
        }
    }
    static synchronized void rescheduleAll(Context c) {
        JSONObject all = rules(c);
        Iterator<String> keys = all.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            cancel(c, id);
            schedule(c, all.optJSONObject(id), System.currentTimeMillis());
        }
    }
    static synchronized void onFire(Context c, String id, long occurrence) {
        if (occurrence <= 0 || nextFor(c, id) != occurrence) return;
        JSONObject item = rule(c, id);
        if (item == null) return;
        // Save notification receipt before publishing the system notification.
        addInbox(c, id, item.optString("title", "یادآوری"), occurrence);
        NotificationEngine.show(c, id, item.optString("title", "یادآوری"),
            item.optString("notes", ""), occurrence);
        schedule(c, item, Math.max(occurrence, System.currentTimeMillis()) + 1000);
    }
    private static PendingIntent intentFor(Context c, String id, long epoch) {
        Intent intent = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE)
            .setData(Uri.parse("roozeman://fire/" + Uri.encode(id)));
        intent.putExtra("id", id);
        intent.putExtra("occurrence", epoch);
        return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized void cancel(Context c, String id) {
        AlarmManager alarm = (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
        alarm.cancel(intentFor(c, id, 0));
        JSONObject next = nextMap(c);
        next.remove(id);
        pref(c).edit().putString("next", next.toString()).commit();
    }
    private static synchronized void schedule(Context c, JSONObject item, long after) {
        if (item == null) return;
        String id = item.optString("id", "");
        if (id.isEmpty()) return;
        long when = nextOccurrence(item, after);
        JSONObject next = nextMap(c);
        if (when < 0) next.remove(id);
        else nextPut(next, id, when);
        pref(c).edit().putString("next", next.toString()).commit();
        if (when < 0) return;
        AlarmManager alarm = (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = intentFor(c,id,when);
        try {
            if (Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()) {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
            } else {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
            }
        } catch (SecurityException error) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
        }
    }
    private static void nextPut(JSONObject o, String k, long v) {try{o.put(k,v);}catch(JSONException ignored){}}
    static long nextOccurrence(JSONObject item, long after) {
        try {
            LocalDate day = LocalDate.parse(item.getString("date"));
            LocalTime time = LocalTime.parse(item.getString("time"));
            long origin = day.atTime(time).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            long offset = item.optInt("offsetMinutes",0) * 60000L;
            String repeat = item.optString("repeat","none");
            if (repeat.equals("none")) return origin-offset > after ? origin-offset : -1;
            if (repeat.equals("weekly")) {
                long adjusted = origin-offset;
                if (adjusted > after) return adjusted;
                // Compute by local weeks to retain local clock time over daylight saving changes.
                long elapsedWeeks = Math.max(0, (after-adjusted)/604800000L - 2);
                for (long i=elapsedWeeks;i<elapsedWeeks+6;i++) {
                    long candidate = day.plusWeeks(i).atTime(time).atZone(ZoneId.systemDefault())
                        .toInstant().toEpochMilli()-offset;
                    if (candidate > after) return candidate;
                }
                return -1;
            }
            // Month/year repetitions follow *the Persian calendar*, anchored to the
            // original Persian day; invalid dates clamp to the final day of that month.
            Calendar anchor = Calendar.getInstance(new ULocale("fa_IR@calendar=persian"));
            anchor.setTimeInMillis(origin);
            int year = anchor.get(Calendar.YEAR);
            int month = anchor.get(Calendar.MONTH); // zero-based
            int date = anchor.get(Calendar.DAY_OF_MONTH);
            int step = repeat.equals("monthly") ? 1 : 12;
            // 3600 months = 300 years, more than enough for a personal planner.
            for (int i=0; i<3600/step; i++) {
                int absolute = year * 12 + month + step * i;
                int targetYear = Math.floorDiv(absolute, 12);
                int targetMonth = Math.floorMod(absolute, 12);
                Calendar target = Calendar.getInstance(new ULocale("fa_IR@calendar=persian"));
                target.clear();
                target.set(Calendar.YEAR, targetYear);
                target.set(Calendar.MONTH, targetMonth);
                target.set(Calendar.DAY_OF_MONTH, 1);
                int max = target.getActualMaximum(Calendar.DAY_OF_MONTH);
                target.set(Calendar.DAY_OF_MONTH, Math.min(date,max));
                target.set(Calendar.HOUR_OF_DAY, time.getHour());
                target.set(Calendar.MINUTE, time.getMinute());
                target.set(Calendar.SECOND,0);
                target.set(Calendar.MILLISECOND,0);
                long candidate = target.getTimeInMillis() - offset;
                if (candidate > after) return candidate;
            }
        } catch (Exception ignored) { }
        return -1;
    }
    static synchronized JSONArray inbox(Context c) {
        try {return new JSONArray(pref(c).getString("inbox", "[]"));}
        catch(Exception ignored) {return new JSONArray();}
    }
    static synchronized void addInbox(Context c, String id, String title, long when) {
        JSONArray all = inbox(c);
        JSONObject entry = new JSONObject();
        try { entry.put("id",id); entry.put("title",title); entry.put("occurrence",when); all.put(entry); }
        catch (JSONException ignored) {return;}
        pref(c).edit().putString("inbox",all.toString()).commit();
    }
    static synchronized void acknowledge(Context c, String id, long when) {
        JSONArray all = inbox(c), remaining = new JSONArray();
        for (int i=0;i<all.length();i++) {
            JSONObject r=all.optJSONObject(i);
            if (r!=null && !(r.optString("id").equals(id) && r.optLong("occurrence")==when)) remaining.put(r);
        }
        pref(c).edit().putString("inbox",remaining.toString()).commit();
        NotificationEngine.cancel(c,id,when);
    }
}
