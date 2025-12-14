import { useEffect, useRef } from "react";

const CustomChart = () => {
  const chartContainerRef = useRef(null);

  useEffect(() => {
    if (!window.LightweightCharts) {
      console.error("LightweightCharts not loaded. Add script in index.html");
      return;
    }

    const chart = window.LightweightCharts.createChart(
      chartContainerRef.current,
      {
        width: 900,
        height: 500,
        layout: {
          background: { color: "#0f172a" },
          textColor: "#f8fafc",
        },
        grid: {
          vertLines: { color: "#334155" },
          horzLines: { color: "#334155" },
        },
        crosshair: {
          mode: window.LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: "#94a3b8",
            width: 1,
            style: 3,
          },
          horzLine: {
            color: "#94a3b8",
            width: 1,
            style: 3,
          },
        },
        timeScale: {
          borderColor: "#475569",
          fixLeftEdge: true,
          fixRightEdge: true,
        },
      }
    );

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    fetch(
      "/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=200"
    )
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

    let points = [];
    let lines = [];
    let markers = [];
    const colors = ["#facc15", "#0ea5e9"];
    let storedLines = [];

    chart.subscribeClick((param) => {
      if (!param || !param.point) return;

      const price = candleSeries.coordinateToPrice(param.point.y);
      const time = chart.timeScale().coordinateToTime(param.point.x);

      if (price && time) {
        const newPoint = { time, value: price };
        candleSeries.setMarkers([
          ...markers,
          {
            time: newPoint.time,
            position: "aboveBar",
            color: "#f59e0b",
            shape: "circle",
            text: `${price.toFixed(2)}`,
          },
        ]);
        markers.push({
          time: newPoint.time,
          position: "aboveBar",
          color: "#f59e0b",
          shape: "circle",
          text: `${price.toFixed(2)}`,
        });

        points.push(newPoint);


        console.table([
          {
            Time: new Date(time * 1000).toLocaleString(),
            Price: price.toFixed(2),
          },
        ]);
      }


      if (points.length === 2) {
        if (lines.length >= 2) {
          lines.forEach((line) => chart.removeSeries(line));
          lines = [];
          storedLines = [];
          markers = [];
          candleSeries.setMarkers([]);
        }

        const color = colors[lines.length % colors.length];
        const lineSeries = chart.addLineSeries({
          color,
          lineWidth: 2,
          lineStyle: lines.length % 2 === 0 ? 0 : 2,
        });

        lineSeries.setData(points);
        lines.push(lineSeries);

        storedLines.push({
          color,
          start: points[0],
          end: points[1],
        });

        console.log("Line stored:");
        console.table(storedLines);

        points = [];
      }
    });

    //  Resize handler
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

  return (
    <div
      ref={chartContainerRef}
      style={{
        width: "100%",
        height: "500px",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      }}
    />
  );
};

export default CustomChart;
