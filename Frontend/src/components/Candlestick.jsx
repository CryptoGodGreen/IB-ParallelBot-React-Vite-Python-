import { useEffect, useRef } from "react";

const TradingViewAppleChart = () => {
  const containerRef = useRef(null);

  useEffect(() => {
    const loadTradingView = () => {
      if (!window.TradingView) {
        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initChart;
        document.body.appendChild(script);
      } else {
        initChart();
      }
    };

    const initChart = () => {
      if (!containerRef.current) return;

      new window.TradingView.widget({
        container_id: containerRef.current.id,
        symbol: "NASDAQ:AAPL",
        interval: "60", 
        timezone: "Etc/UTC",
        theme: "light",
        style: "1",
        locale: "en",
        toolbar_bg: "#f1f3f6",
        enable_publishing: false,
        hide_top_toolbar: false,
        allow_symbol_change: true,
        save_image: true,

        studies_overrides: {},
      });
    };

    loadTradingView();
  }, []);

  return (
    <div
      ref={containerRef}
      id="tradingview-container"
      style={{ width: "100%", height: "600px" }}
    />
  );
};

export default TradingViewAppleChart;
