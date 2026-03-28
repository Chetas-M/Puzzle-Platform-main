export default function TimerBar({ remainingSeconds, penaltiesPoints, isPaused = false }) {
  const total = Math.max(remainingSeconds, 0);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60)
    .toString()
    .padStart(2, "0")
    .slice(-2);

  return (
    <div className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/40 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-sm md:px-6">
        <p className="font-mono text-amber-300">
          Event Timer: {minutes}:{seconds}
          {isPaused ? " (PAUSED)" : ""}
        </p>
        <p className="text-xs text-slate-300">Hint Penalty: {penaltiesPoints} pts</p>
      </div>
    </div>
  );
}
