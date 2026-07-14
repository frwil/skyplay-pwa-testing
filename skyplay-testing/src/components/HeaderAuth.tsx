"use client";

import { LogOut } from "lucide-react";

interface HeaderAuthProps {
  username: string | null;
}

export default function HeaderAuth({ username }: HeaderAuthProps) {
  if (username) {
    return (
      <button
        onClick={async () => {
          try {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
          } catch { /* ignore */ }
          // Prevent dev identity fallback on reload
          try { sessionStorage.setItem("skyplay_logged_out", "1"); } catch { /* ignore */ }
          window.location.reload();
        }}
        className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
      >
        <LogOut className="w-3 h-3" />
        Déconnexion
      </button>
    );
  }

  return (
    <a
      href="/login"
      className="text-xs text-white/40 hover:text-white transition font-medium"
    >
      Connexion
    </a>
  );
}
