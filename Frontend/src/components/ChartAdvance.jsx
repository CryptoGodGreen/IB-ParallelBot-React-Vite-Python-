// import { useEffect, useState } from "react";

// const TradingViewAdvancedChart = () => {
//   const [symbol, setSymbol] = useState("NASDAQ:AAPL"); // default Apple

//   useEffect(() => {

//     const container = document.getElementById("tradingview_chart");
//     if (container) container.innerHTML = "";
//     if (!document.getElementById("tradingview-widget-script")) {
//       const script = document.createElement("script");
//       script.id = "tradingview-widget-script";
//       script.type = "text/javascript";
//       script.async = true;
//       script.src = "https://s3.tradingview.com/tv.js";
//       script.onload = () => loadWidget(symbol);
//       document.body.appendChild(script);
//     } else {
//       loadWidget(symbol);
//     }
//   }, [symbol]);

//   const loadWidget = (symbol) => {
//     if (!window.TradingView) return;
//     new window.TradingView.widget({
//       container_id: "tradingview_chart",
//       autosize: true,
//       symbol: symbol,
//       interval: "15",
//       timezone: "Etc/UTC",
//       theme: "dark",
//       style: "1",
//       locale: "en",
//       enable_publishing: false,
//       hide_side_toolbar: false,
//       allow_symbol_change: true,
//       studies: ["MACD@tv-basicstudies", "RSI@tv-basicstudies"],
//     });
//   };

//   return (
//     <div>

//       <select
//         value={symbol}
//         onChange={(e) => setSymbol(e.target.value)}
//         style={{ marginBottom: "10px", padding: "5px" }}
//       >
//         <option value="NASDAQ:AAPL">Apple (AAPL)</option>
//         <option value="NASDAQ:MSFT">Microsoft (MSFT)</option>
//         <option value="NASDAQ:TSLA">Tesla (TSLA)</option>
//         <option value="BINANCE:BTCUSDT">Bitcoin (BTC/USDT)</option>
//       </select>

   
//       <div
//         id="tradingview_chart"
//         style={{ height: "600px", width: "100%" }}
//       />
//     </div>
//   );
// };

// export default TradingViewAdvancedChart;














import { useEffect } from "react";

const TradingViewAdvancedChart = () => {
  useEffect(() => {
    if (document.getElementById("tradingview-widget-script")) return;

    const script = document.createElement("script");
    script.id = "tradingview-widget-script";
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://s3.tradingview.com/tv.js";
    script.onload = () => {
      new window.TradingView.widget({
        container_id: "tradingview_chart",
        autosize: true,
        symbol: "BINANCE:BTCUSDT",
        interval: "15",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        allow_symbol_change: true,
        hide_side_toolbar: false,
      });
    };

    document.body.appendChild(script);

    // Click tracking after chart loads
    setTimeout(() => {
      const iframe = document.querySelector("#tradingview_chart iframe");
      if (!iframe) return;

      let lastCrosshair = null;
      let points = [];

      iframe.onload = () => {
        const chartWindow = iframe.contentWindow;

        chartWindow.widget.onChartReady(() => {
          const chart = chartWindow.widget.chart();

          // Track crosshair movement
          chart.onCrossHairMove((param) => {
            if (!param || !param.points || !param.points.length) return;
            lastCrosshair = {
              price: param.points[0].price,
              time: param.time,
            };
          });

          // On click → save 2 points
          chart.onClick(() => {
            if (!lastCrosshair) return;
            points.push(lastCrosshair);

            if (points.length === 2) {
              console.log("Point 1:", points[0]);
              console.log("Point 2:", points[1]);
              alert(
                `Selected Points:\nPoint 1 → Price: ${points[0].price}, Time: ${points[0].time}\nPoint 2 → Price: ${points[1].price}, Time: ${points[1].time}`
              );
              points = []; // reset
            }
          });
        });
      };
    }, 2000); // wait for widget load
  }, []);

  return <div id="tradingview_chart" style={{ height: "600px", width: "100%" }} />;
};

export default TradingViewAdvancedChart;
