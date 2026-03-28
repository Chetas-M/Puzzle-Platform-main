export default function HintModal({ open, hints, onClose, onReveal }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-600 bg-slate-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">Hint Tiers</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-500 px-3 py-1">
            Close
          </button>
        </div>

        <div className="space-y-3">
          {hints.map((hint) => (
            <section key={hint.id} className="rounded-xl border border-slate-700 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold uppercase tracking-wide">{hint.tier}</p>
                <p className="text-xs text-amber-300">Penalty: -{hint.penaltyPoints} pts</p>
              </div>
              {hint.content ? (
                <p className="text-sm text-slate-100">{hint.content}</p>
              ) : (
                <button
                  type="button"
                  className="rounded-lg border border-amber-400/60 px-3 py-1 text-sm"
                  onClick={() => onReveal(hint.tier)}
                >
                  Reveal {hint.tier}
                </button>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
