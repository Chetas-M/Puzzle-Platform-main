import { useEffect, useState } from "react";

const KEY = "mvp-dark-mode";

export default function DarkModeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem(KEY) !== "false");

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem(KEY, `${dark}`);
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((value) => !value)}
      className="rounded-xl border border-slate-500/40 bg-card px-3 py-2 text-sm"
    >
      {dark ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
