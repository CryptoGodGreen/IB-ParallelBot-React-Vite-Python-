import SearchAutocomplete from "../SearchAutocomplete";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
 
export default function Home() {
  const navigate = useNavigate();
  const [isTrading, setIsTrading] = useState(false);
 
  // Track first render to prevent toast on page load
  const isFirstRender = useRef(true);
 
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return; // Skip toast on initial render
    }
    toast.success(isTrading ? "Trading started 🚀" : "Trading paused ✅");
  }, [isTrading]);
 
  const handleToggleTrading = () => {
    setIsTrading((prev) => !prev); // toggle state
  };
 
  const handleCancelAllTrades = () => {
    toast.error("All trades cancelled ❌");
  };
 
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 text-center">
      <div className="max-w-3xl">
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/20 text-sm mb-4">
          <span className="mr-2">🎯</span> Search a ticker and jump straight to its live chart
        </div>
 
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
          Trade smarter with a clean, fast, and beautiful{" "}
          <span className="bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent">
            terminal
          </span>
        </h1>
 
        <p className="mt-4 text-slate-300">
          Type{" "}
          <kbd className="px-1.5 py-0.5 text-xs rounded bg-slate-800 border border-slate-700">/</kbd>{" "}
          to focus search. Use ↑/↓ to navigate and{" "}
          <kbd className="px-1.5 py-0.5 text-xs rounded bg-slate-800 border border-slate-700">Enter</kbd>{" "}
          to open.
        </p>
 
        <div className="mt-8 flex justify-center">
          <SearchAutocomplete onPicked={(sym) => navigate(`/stock/${sym}`)} />
        </div>
      </div>
 
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl">
        {[
          { t: "Secure", d: "Auth + role ready" },
          { t: "Fast", d: "Zero-dep local search" },
          { t: "Beautiful", d: "Glass + gradient UI" },
        ].map((c) => (
          <div key={c.t} className="card p-4">
            <div className="text-lg font-semibold">{c.t}</div>
            <div className="text-slate-400 text-sm">{c.d}</div>
          </div>
        ))}
      </div>
 
      {/* Trading controls */}
      <div className="mt-10 flex gap-4">
        <button
          onClick={handleToggleTrading}
          className="px-6 py-2 rounded-xl font-semibold shadow-lg transition backdrop-blur-sm
                     bg-gradient-to-r from-blue-600 via-indigo-600 to-fuchsia-600
                     text-white border border-white/20 hover:opacity-90"
        >
          {isTrading ? "Pause Trading" : "Start Trading"}
        </button>
 
        <button
          onClick={handleCancelAllTrades}
          className="px-6 py-2 rounded-xl font-semibold shadow-lg transition backdrop-blur-sm
                     bg-gradient-to-r from-pink-600 via-red-600 to-orange-500
                     text-white border border-white/20 hover:opacity-90"
        >
          Cancel All Trades
        </button>
      </div>
    </div>
  );
}
 
 