import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";

export default function TradingViewWidget() {
  const { symbol } = useParams();
  const container = useRef(null);

  useEffect(() => {
    if (!container.current) return;
    container.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `{
      "symbols": [["${symbol || "AAPL"}", "${symbol || "AAPL"}|1D"]],
      "chartType": "area",
      "colorTheme": "dark",
      "autosize": true,
      "width": "100%",
      "height": "100%",
      "locale": "en"
    }`;
    container.current.appendChild(script);
  }, [symbol]);

  return (
    <div className="h-[calc(100vh-6rem)] card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold tracking-wide">{symbol || "AAPL"} • Chart</h2>
        <span className="text-xs text-slate-400">Powered by TradingView</span>
      </div>
      <div ref={container} className="tradingview-widget-container h-full">
        <div className="tradingview-widget-container__widget h-full"></div>
      </div>
    </div>
  );
}