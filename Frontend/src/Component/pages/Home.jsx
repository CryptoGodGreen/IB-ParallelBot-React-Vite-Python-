import SearchAutocomplete from "../SearchAutocomplete";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 text-center">
      <div className="max-w-3xl">
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/20 text-sm mb-4">
          <span className="mr-2">🎯</span> Search a ticker and jump straight to its live chart
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
          Trade smarter with a clean, fast, and beautiful <span className="bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent">terminal</span>
        </h1>
        <p className="mt-4 text-slate-300">
          Type <kbd className="px-1.5 py-0.5 text-xs rounded bg-slate-800 border border-slate-700">/</kbd> to focus search. Use ↑/↓ to navigate and <kbd className="px-1.5 py-0.5 text-xs rounded bg-slate-800 border border-slate-700">Enter</kbd> to open.
        </p>
        <div className="mt-8 flex justify-center">
          <SearchAutocomplete onPicked={(sym) => navigate(`/stock/${sym}`)} />
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl">
        {[{t:"Secure",d:"Auth + role ready"},{t:"Fast",d:"Zero-dep local search"},{t:"Beautiful",d:"Glass + gradient UI"}].map((c) => (
          <div key={c.t} className="card p-4">
            <div className="text-lg font-semibold">{c.t}</div>
            <div className="text-slate-400 text-sm">{c.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}