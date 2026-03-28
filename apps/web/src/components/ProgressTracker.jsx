export default function ProgressTracker({ items, onSelect, selectedPuzzleId, enabledPuzzleIds = [] }) {
  const enabledSet = new Set(enabledPuzzleIds);

  return (
    <section className="rounded-2xl border border-slate-700/40 bg-card p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-muted">Progress</h2>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 md:grid-cols-[repeat(13,minmax(0,1fr))]">
        {items.map((item, index) => {
          const isEnabled = enabledSet.has(item.puzzleId);
          const statusClass =
            item.status === "solved"
              ? "bg-emerald-600/30 border-emerald-500"
              : item.status === "attempted"
                ? "bg-amber-500/20 border-amber-400"
                : "bg-slate-700/30 border-slate-600";

          return (
            <button
              key={item.puzzleId}
              type="button"
              onClick={() => {
                if (isEnabled) {
                  onSelect(item.puzzleId);
                }
              }}
              disabled={!isEnabled}
              className={`rounded-lg border px-2 py-3 text-center text-xs ${statusClass} ${
                selectedPuzzleId === item.puzzleId ? "ring-2 ring-accent" : ""
              } ${
                isEnabled ? "" : "cursor-not-allowed opacity-40"
              }`}
              title={isEnabled ? item.title : `${item.title} (locked)`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}
