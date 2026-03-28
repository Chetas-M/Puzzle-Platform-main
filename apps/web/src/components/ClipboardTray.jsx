export default function ClipboardTray({ entries }) {
  return (
    <aside className="rounded-2xl border border-slate-700/40 bg-card p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-muted">Clipboard (Last 5)</h2>
      <div className="space-y-2">
        {entries.length === 0 ? <p className="text-sm text-muted">No copied values yet.</p> : null}
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2">
            <p className="text-xs text-muted">{entry.source}</p>
            <p className="truncate font-mono text-sm">{entry.value}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
