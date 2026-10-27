package ir.roozeman.planner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class RescheduleReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        if (intent == null) return;
        PlannerStore.rescheduleAll(context);
    }
}
