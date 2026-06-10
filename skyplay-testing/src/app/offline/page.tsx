import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#070f1e]">
      <div className="text-center max-w-sm">
        <div
          className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: "rgba(253,46,95,0.1)",
            border: "2px solid rgba(253,46,95,0.3)",
          }}
        >
          <WifiOff className="w-10 h-10 text-[#FD2E5F]" />
        </div>

        <h1
          className="text-2xl font-black mb-3"
          style={{
            background: "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          SKYPLAY PWA
        </h1>

        <p className="text-white/60 text-sm mb-2 font-medium">
          Vous êtes hors ligne
        </p>
        <p className="text-white/30 text-xs leading-relaxed">
          La connexion internet est nécessaire pour soumettre vos feedbacks.
          Reconnectez-vous et réessayez.
        </p>
      </div>
    </main>
  );
}
