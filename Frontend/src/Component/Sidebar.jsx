import { Link, useLocation } from "react-router-dom";
import { SYMBOLS } from "../data/symbols";

export default function Sidebar({ isOpen, toggleSidebar }) {
  const location = useLocation();
  const items = SYMBOLS.slice(0, 10);

  return (
    <aside
      className={`transition-[width] duration-300 h-[calc(100vh-4rem)] sticky top-16 ${
        isOpen ? "w-64" : "w-0"
      } overflow-hidden`}
    >
      <div className="h-full p-4">
        <div className="card h-full p-4 bg-gradient-to-b from-slate-900/70 to-slate-900/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">Markets</h2>
            <button
              onClick={toggleSidebar}
              className="text-slate-400 hover:text-red-400 text-lg"
              aria-label="Close sidebar"
            >
              ✖
            </button>
          </div>
          <div className="space-y-1">
            {items.map((item) => {
              const href = `/stock/${item.symbol}`;
              const isActive = location.pathname === href;
              return (
                <Link
                  key={item.symbol}
                  to={href}
                  className={`block px-3 py-2 rounded-xl transition border ${
                    isActive
                      ? "bg-blue-600/20 border-blue-600/30 text-blue-200"
                      : "hover:bg-slate-800/60 border-slate-800 text-slate-200"
                  }`}
                  title={`${item.name} (${item.exchange})`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold tracking-wide">{item.symbol}</span>
                    <span className="text-xs text-slate-400">{item.exchange}</span>
                  </div>
                  <div className="text-xs truncate text-slate-400">{item.name}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}