export default function GlowBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Grid pattern */}
      <div
        className="absolute inset-0 bg-grid-pattern"
        style={{ opacity: 0.5 }}
      />

      {/* Cyan glow orb — top center */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full blur-[120px]"
        style={{ backgroundColor: "rgba(0,200,255,0.08)" }}
      />

      {/* Gold glow orb — bottom right */}
      <div
        className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full blur-[100px]"
        style={{ backgroundColor: "rgba(255,215,0,0.06)" }}
      />

      {/* Pink glow orb — top left */}
      <div
        className="absolute top-10 left-10 w-[300px] h-[300px] rounded-full blur-[100px]"
        style={{ backgroundColor: "rgba(253,46,95,0.06)" }}
      />
    </div>
  );
}
