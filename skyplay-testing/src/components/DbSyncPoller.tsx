"use client";

import { useEffect, useRef } from "react";

/**
 * Background DB sync poller. Detects when the browser comes back online
 * after a disconnection and triggers a local→Turso sync.
 *
 * - On mount: attempts an immediate sync
 * - On `window.online` event: attempts a sync (reconnected after outage)
 * - Periodic: every 60s while online (catches transient issues)
 */
export default function DbSyncPoller() {
  const lastSyncRef = useRef(0);

  useEffect(() => {
    const triggerSync = () => {
      // Throttle: max one sync every 15s to avoid flooding
      const now = Date.now();
      if (now - lastSyncRef.current < 15_000) return;
      lastSyncRef.current = now;

      fetch("/api/admin/db/sync", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.synced) console.log("[db-sync] ✅ Replica synced with Turso");
        })
        .catch(() => {
          // Offline — silently skip, will retry next time
        });
    };

    // 1) Attempt sync as soon as the app boots
    triggerSync();

    // 2) Browser online event — fired when connectivity is restored
    const handleOnline = () => {
      console.log("[db-sync] 🌐 Browser online detected — syncing...");
      triggerSync();
    };
    window.addEventListener("online", handleOnline);

    // 3) Periodic heartbeat — keeps things in sync even without disconnect
    const interval = setInterval(triggerSync, 60_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, []);

  return null; // no UI — background only
}
