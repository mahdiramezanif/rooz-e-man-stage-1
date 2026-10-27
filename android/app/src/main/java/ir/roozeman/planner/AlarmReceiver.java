package ir.roozeman.planner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("id");
        long when = intent.getLongExtra("occurrence",-1);
        if (id == null || when <= 0) return;
        if (PlannerStore.ACTION_ACK.equals(intent.getAction())) {
            PlannerStore.acknowledge(context,id,when);
        } else if (PlannerStore.ACTION_FIRE.equals(intent.getAction())) {
            PlannerStore.onFire(context,id,when);
        }
    }
}
