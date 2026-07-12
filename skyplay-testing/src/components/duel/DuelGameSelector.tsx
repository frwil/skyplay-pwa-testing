"use client";

import { useState, useMemo } from "react";
import { Search, Swords, Gamepad2, LayoutGrid, AlignJustify } from "lucide-react";
import type { ResolvedDuelGame } from "@/lib/duel/useDuelGames";

/** Category visual definitions — each category gets a distinct accent color + icon. */
const CATEGORY_DEFS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  fighting: { label: "🥊 Combat", color: "#f15bb5", bg: "rgba(241,91,181,0.1)", icon: "🥊" },
  versus: { label: "🎯 Versus", color: "#00c8ff", bg: "rgba(0,200,255,0.1)", icon: "🎯" },
  sports: { label: "⚽ Sport", color: "#4ade80", bg: "rgba(74,222,128,0.1)", icon: "⚽" },
  puzzle: { label: "🧩 Puzzle", color: "#facc15", bg: "rgba(250,204,21,0.1)", icon: "🧩" },
  racing: { label: "🏎️ Course", color: "#fd2e5f", bg: "rgba(253,46,95,0.1)", icon: "🏎️" },
};

/** Generate a unique gradient background for a game card (used when no cover image). */
function gameGradient(gameId: string): string {
  const gradients: Record<string, string> = {
    kof98: "linear-gradient(135deg, #1a0a2e 0%, #3d0a4e 30%, #6b1040 60%, #9b1b3a 100%)",
    kof2002: "linear-gradient(135deg, #0a1a2e 0%, #0a2e4e 30%, #10406b 60%, #1b529b 100%)",
    sf2: "linear-gradient(135deg, #2e0a0a 0%, #4e1a0a 30%, #6b3a10 60%, #9b5a1b 100%)",
    sfa2: "linear-gradient(135deg, #0a2e1a 0%, #1a4e2a 30%, #2a6b40 60%, #3a9b50 100%)",
  };
  return gradients[gameId] ?? "linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 30%, #4a2060 60%, #6b2a7a 100%)";
}

export interface DuelGameSelectorProps {
  games: ResolvedDuelGame[];
  selectedGameId: string;
  onSelectGame: (gameId: string) => void;
}

export default function DuelGameSelector({ games, selectedGameId, onSelectGame }: DuelGameSelectorProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Collect unique categories from the game list
  const categories = useMemo(() => {
    const cats = new Set<string>();
    games.forEach((g) => { if (g.category) cats.add(g.category); });
    return Array.from(cats);
  }, [games]);

  // Filter games by search + category
  const filtered = useMemo(() => {
    let list = games;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (g) =>
          g.label.toLowerCase().includes(q) ||
          (g.description?.toLowerCase().includes(q) ?? false),
      );
    }
    if (categoryFilter) {
      list = list.filter((g) => g.category === categoryFilter);
    }
    return list;
  }, [games, search, categoryFilter]);

  return (
    <div className="space-y-4">
      {/* Search bar + view toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: "rgba(255,255,255,0.25)" }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un jeu…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm font-medium outline-none transition-all placeholder:text-white/20"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#fff",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(241,91,181,0.35)";
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
            }}
          />
        </div>

        {/* View mode toggle */}
        <div
          className="flex rounded-xl overflow-hidden flex-shrink-0"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <button
            onClick={() => setViewMode("grid")}
            className="p-2 transition-all"
            title="Vue grille"
            style={{
              backgroundColor: viewMode === "grid" ? "rgba(241,91,181,0.15)" : "rgba(255,255,255,0.02)",
              color: viewMode === "grid" ? "#f15bb5" : "rgba(255,255,255,0.25)",
            }}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className="p-2 transition-all"
            title="Vue liste"
            style={{
              backgroundColor: viewMode === "list" ? "rgba(241,91,181,0.15)" : "rgba(255,255,255,0.02)",
              color: viewMode === "list" ? "#f15bb5" : "rgba(255,255,255,0.25)",
            }}
          >
            <AlignJustify className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className="rounded-full px-3 py-1.5 text-xs font-bold transition-all"
            style={{
              backgroundColor: !categoryFilter ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)",
              border: !categoryFilter ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(255,255,255,0.06)",
              color: !categoryFilter ? "#fff" : "rgba(255,255,255,0.4)",
            }}
          >
            Tous
          </button>
          {categories.map((cat) => {
            const def = CATEGORY_DEFS[cat] ?? { label: cat, color: "#fff", bg: "rgba(255,255,255,0.05)", icon: "🎮" };
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(active ? null : cat)}
                className="rounded-full px-3 py-1.5 text-xs font-bold transition-all"
                style={{
                  backgroundColor: active ? def.bg : "rgba(255,255,255,0.03)",
                  border: active
                    ? `1px solid ${def.color}33`
                    : "1px solid rgba(255,255,255,0.06)",
                  color: active ? def.color : "rgba(255,255,255,0.4)",
                }}
              >
                {def.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Grid View ─────────────────────────────────────────── */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((game) => {
            const isSelected = selectedGameId === game.id;
            const catDef = game.category ? (CATEGORY_DEFS[game.category] ?? { label: game.category, color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.05)", icon: "🎮" }) : null;

            return (
              <button
                key={game.id}
                onClick={() => onSelectGame(game.id)}
                className="rounded-2xl border overflow-hidden text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  backgroundColor: "rgba(13,27,46,0.8)",
                  borderColor: isSelected ? "rgba(241,91,181,0.5)" : "rgba(255,255,255,0.06)",
                  boxShadow: isSelected
                    ? "0 0 30px rgba(241,91,181,0.15), inset 0 0 20px rgba(241,91,181,0.03)"
                    : "0 0 0 rgba(0,0,0,0)",
                }}
              >
                {/* Cover image area */}
                {game.coverImage ? (
                  <div className="h-28 w-full overflow-hidden">
                    <img
                      src={game.coverImage}
                      alt={game.label}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className="h-28 w-full flex items-center justify-center relative overflow-hidden"
                    style={{ background: gameGradient(game.id) }}
                  >
                    <div
                      className="absolute inset-0 opacity-10"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 1px, transparent 1px), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.2) 1px, transparent 1px)",
                        backgroundSize: "40px 40px, 60px 60px",
                      }}
                    />
                    <span
                      className="relative text-4xl font-black tracking-wider select-none"
                      style={{
                        color: "rgba(255,255,255,0.12)",
                        textShadow: "0 2px 20px rgba(0,0,0,0.5)",
                      }}
                    >
                      {game.label.charAt(0)}{game.label.includes("'") ? "'" : ""}
                    </span>
                  </div>
                )}

                {/* Card body */}
                <div className="p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <h3
                      className="text-sm font-bold"
                      style={{ color: isSelected ? "#f15bb5" : "#fff" }}
                    >
                      {game.label}
                    </h3>
                    {isSelected && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: "#f15bb5", boxShadow: "0 0 6px rgba(241,91,181,0.6)" }}
                      />
                    )}
                  </div>
                  {game.description && (
                    <p className="text-[11px] text-white/35 leading-relaxed mb-2 line-clamp-2">
                      {game.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {catDef && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: catDef.bg, color: catDef.color, border: `1px solid ${catDef.color}22` }}
                      >
                        {catDef.icon} {catDef.label.replace(/^[^\s]+\s/, "")}
                      </span>
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{
                        backgroundColor: "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.3)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <Gamepad2 className="w-2.5 h-2.5 inline mr-0.5" />
                      {game.system}
                    </span>
                    {game.modes.length > 0 && (
                      <span className="text-[10px] text-white/20 ml-auto">
                        {game.modes.length} mode{game.modes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── List View ──────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className="space-y-1.5">
          {filtered.map((game) => {
            const isSelected = selectedGameId === game.id;
            const catDef = game.category ? (CATEGORY_DEFS[game.category] ?? { label: game.category, color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.05)", icon: "🎮" }) : null;

            return (
              <button
                key={game.id}
                onClick={() => onSelectGame(game.id)}
                className="w-full rounded-xl border text-left transition-all hover:scale-[1.005] active:scale-[0.995]"
                style={{
                  backgroundColor: isSelected ? "rgba(241,91,181,0.06)" : "rgba(13,27,46,0.6)",
                  borderColor: isSelected ? "rgba(241,91,181,0.4)" : "rgba(255,255,255,0.05)",
                  boxShadow: isSelected
                    ? "0 0 20px rgba(241,91,181,0.08), inset 0 0 10px rgba(241,91,181,0.02)"
                    : "none",
                }}
              >
                <div className="flex items-center gap-3 px-3.5 py-3">
                  {/* Mini cover */}
                  {game.coverImage ? (
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={game.coverImage} alt={game.label} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: gameGradient(game.id) }}
                    >
                      <span className="text-xl font-black" style={{ color: "rgba(255,255,255,0.15)" }}>
                        {game.label.charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3
                        className="text-sm font-bold truncate"
                        style={{ color: isSelected ? "#f15bb5" : "#fff" }}
                      >
                        {game.label}
                      </h3>
                      {isSelected && (
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: "#f15bb5", boxShadow: "0 0 5px rgba(241,91,181,0.6)" }}
                        />
                      )}
                    </div>
                    {game.description && (
                      <p className="text-[11px] text-white/30 leading-relaxed truncate mb-1">
                        {game.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5">
                      {catDef && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                          style={{ backgroundColor: catDef.bg, color: catDef.color }}
                        >
                          {catDef.icon} {catDef.label.replace(/^[^\s]+\s/, "")}
                        </span>
                      )}
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.04)",
                          color: "rgba(255,255,255,0.3)",
                        }}
                      >
                        {game.system}
                      </span>
                    </div>
                  </div>

                  {/* Right side: modes count + arrow */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {game.modes.length > 0 && (
                      <span className="text-[10px] text-white/20 whitespace-nowrap">
                        {game.modes.length} mode{game.modes.length > 1 ? "s" : ""}
                      </span>
                    )}
                    <span
                      className="text-sm transition-transform"
                      style={{
                        color: isSelected ? "#f15bb5" : "rgba(255,255,255,0.15)",
                        transform: isSelected ? "translateX(2px)" : "none",
                      }}
                    >
                      →
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-8">
          <Swords className="w-8 h-8 mx-auto mb-2" style={{ color: "rgba(255,255,255,0.1)" }} />
          <p className="text-xs text-white/25">
            {search.trim() ? "Aucun jeu ne correspond à votre recherche" : "Aucun jeu disponible dans cette catégorie"}
          </p>
        </div>
      )}
    </div>
  );
}
