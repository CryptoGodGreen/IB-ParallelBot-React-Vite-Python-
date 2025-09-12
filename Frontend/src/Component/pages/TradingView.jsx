// src/pages/TradingView.jsx
import React, { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";

function TradingViewWidget() {
  const { symbol } = useParams(); // URL se symbol milega
  const container = useRef(null);

  useEffect(() => {
    if (!container.current) return;

    container.current.innerHTML = "";

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "symbols": [
          ["${symbol || "AAPL"}", "${symbol || "AAPL"}|1D"]
        ],
        "chartType": "area",
        "colorTheme": "light",
        "autosize": true,
        "width": "100%",
        "height": "100%",
        "locale": "en"
      }`;

    container.current.appendChild(script);
  }, [symbol]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <h2>{symbol || "AAPL"} Chart</h2>
      <div className="tradingview-widget-container" ref={container}>
        <div className="tradingview-widget-container__widget"></div>
      </div>
    </div>
  );
}

export default TradingViewWidget;
