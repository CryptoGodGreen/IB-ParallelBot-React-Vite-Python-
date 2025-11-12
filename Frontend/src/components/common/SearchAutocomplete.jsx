import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SYMBOLS } from "../../data/symbols";
import { FaSearch } from "react-icons/fa";

export default function SearchAutocomplete({ placeholder = "Search symbols or names…", onPicked }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/") {
        if (document.activeElement?.tagName?.toLowerCase() !== "input") {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Lightweight ranking: startsWith > includes, symbol priority
    const scored = SYMBOLS.map((s) => {
      const name = s.name.toLowerCase();
      const sym = s.symbol.toLowerCase();
      let score = 0;
      if (sym.startsWith(q)) score += 3; else if (sym.includes(q)) score += 1;
      if (name.startsWith(q)) score += 2; else if (name.includes(q)) score += 1;
      return { ...s, score };
    }).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    return scored.slice(0, 8);
  }, [query]);

  const pick = (sym) => {
    setOpen(false);
    setQuery("");
    onPicked?.(sym);
    navigate(`/stock/${sym}`);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIndex]) pick(results[activeIndex].symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center bg-slate-800/70 ring-1 ring-slate-700 hover:ring-slate-500 focus-within:ring-blue-500 rounded-2xl px-3 py-2 gap-2 transition">
        <FaSearch className="opacity-70" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0); }}
          onFocus={() => setOpen(Boolean(results.length))}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="bg-transparent outline-none w-full placeholder-slate-400"
        />
        <kbd className="hidden md:inline px-1.5 py-0.5 text-xs rounded bg-slate-700/70 border border-slate-600">/</kbd>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-2 w-full card overflow-hidden">
          <ul ref={listRef} className="max-h-72 overflow-y-auto divide-y divide-slate-800">
            {results.map((r, idx) => (
              <li
                key={r.symbol}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.symbol)}
                className={`px-3 py-2 cursor-pointer flex items-center justify-between ${
                  idx === activeIndex ? "bg-slate-800/70" : "hover:bg-slate-800/40"
                }`}
              >
                <div>
                  <div className="font-semibold tracking-wide">{r.symbol}</div>
                  <div className="text-xs text-slate-400">{r.name}</div>
                </div>
                <span className="text-xs text-slate-400">{r.exchange}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}