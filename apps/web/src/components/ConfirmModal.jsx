export default function ConfirmModal({ open, title, body, onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-950 p-5">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-slate-200">{body}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="rounded-md border border-slate-500 px-3 py-1" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="rounded-md bg-accent px-3 py-1 font-semibold text-slate-950" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
