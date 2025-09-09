// import { useEffect, useRef } from "react";

// const CustomChart = () => {
//   const chartContainerRef = useRef(null);

//   useEffect(() => {
//     if (!window.LightweightCharts) {
//       console.error("LightweightCharts not loaded. Add script in index.html");
//       return;
//     }

//     const chart = window.LightweightCharts.createChart(
//       chartContainerRef.current,
//       {
//         width: 900,
//         height: 500,
//         layout: { background: { color: "#1e1e1e" }, textColor: "#d1d4dc" },
//         timeScale: { 
//           borderColor: "#71649C",
//           fixLeftEdge: true, 
//           fixRightEdge: true,
//         },
//         crosshair: { mode: window.LightweightCharts.CrosshairMode.Magnet },
//       }
//     );

//     const candleSeries = chart.addCandlestickSeries();

//     // ✅ Load Binance Data
//     fetch(
//       "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200"
//     )
//       .then((r) => r.json())
//       .then((data) => {
//         candleSeries.setData(
//           data.map((d) => ({
//             time: d[0] / 1000,
//             open: parseFloat(d[1]),
//             high: parseFloat(d[2]),
//             low: parseFloat(d[3]),
//             close: parseFloat(d[4]),
//           }))
//         );
//       });

//     // ✅ Line drawing logic
//     let points = [];
//     let lines = [];
//     const colors = ["yellow", "green"]; // max 2 lines
//     let storedLines = []; // yahan dono line ke price/time store honge

//     chart.subscribeClick((param) => {
//       if (!param || !param.point) return;

//       const price = candleSeries.coordinateToPrice(param.point.y);
//       const time = chart.timeScale().coordinateToTime(param.point.x);

//       if (price && time) {
//         points.push({ time, value: price });
//         console.log("Clicked:", { time, price });
//       }

//       // ✅ Jab 2 points ek line banate hain
//       if (points.length === 2) {
//         if (lines.length >= 2) {
//           // Purani lines delete
//           lines.forEach((line) => chart.removeSeries(line));
//           lines = [];
//           storedLines = [];
//         }

//         const color = colors[lines.length % colors.length];
//         const lineSeries = chart.addLineSeries({
//           color,
//           lineWidth: 2,
//         });

//         lineSeries.setData(points);
//         lines.push(lineSeries);

//         // ✅ Is line ke points store karo
//         storedLines.push({
//           color,
//           start: points[0],
//           end: points[1],
//         });

//         console.log("Line stored:", storedLines);

//         points = []; // reset for next line
//       }
//     });

//     // ✅ Resize handler
//     const resizeHandler = () => {
//       chart.applyOptions({
//         width: chartContainerRef.current.clientWidth,
//         height: chartContainerRef.current.clientHeight,
//       });
//     };
//     window.addEventListener("resize", resizeHandler);

//     return () => {
//       window.removeEventListener("resize", resizeHandler);
//       chart.remove();
//     };
//   }, []);

//   return (
//     <div
//       ref={chartContainerRef}
//       style={{ width: "100%", height: "500px" }}
//     />
//   );
// };

// export default CustomChart;





import { useEffect, useRef } from "react";

const CustomChart = () => {
  const chartContainerRef = useRef(null);

  useEffect(() => {
    if (!window.LightweightCharts) {
      console.error("LightweightCharts not loaded. Add script in index.html");
      return;
    }

    const chart = window.LightweightCharts.createChart(chartContainerRef.current, {
      width: 900,
      height: 500,
      layout: { background: { color: "#1e1e1e" }, textColor: "#d1d4dc" },
      timeScale: { borderColor: "#71649C", fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Magnet },
    });

    const candleSeries = chart.addCandlestickSeries();

    // Load Binance Data
    fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200")
      .then((r) => r.json())
      .then((data) => {
        candleSeries.setData(
          data.map((d) => ({
            time: d[0] / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
          }))
        );
      });

    // Line drawing logic
    let points = [];
    let lines = [];
    const colors = ["yellow", "green"];
    let storedLines = [];

    chart.subscribeClick((param) => {
      if (!param || !param.point) return;

      const price = candleSeries.coordinateToPrice(param.point.y);
      const time = chart.timeScale().coordinateToTime(param.point.x);

      if (price && time) {
        points.push({ time, value: price });
        console.log("Clicked:", { time, price });
      }

      if (points.length === 2) {
        // ✅ Remove oldest line if already 2 lines
        if (lines.length >= 2) {
          const oldLine = lines.shift(); // remove first (oldest) line
          chart.removeSeries(oldLine);
          storedLines.shift(); // also remove its stored data
        }

        const color = colors[lines.length % colors.length];
        const lineSeries = chart.addLineSeries({ color, lineWidth: 2 });
        lineSeries.setData(points);
        lines.push(lineSeries);

        storedLines.push({
          color,
          start: points[0],
          end: points[1],
        });

        console.log("Line stored:", storedLines);
        points = [];
         // reset for next line
      }
    });

    // Resize
    const resizeHandler = () => {
      chart.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });
    };
    window.addEventListener("resize", resizeHandler);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      chart.remove();
    };
  }, []);

  return <div ref={chartContainerRef} style={{ width: "100%", height: "500px" }} />;
};

export default CustomChart;
