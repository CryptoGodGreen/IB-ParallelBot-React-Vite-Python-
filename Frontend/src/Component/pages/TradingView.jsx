// src/components/TradingView.jsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createChart } from "lightweight-charts";
import { fetchDailyData } from "../../services/alphaVantageService";

const TradingView = () => {
  const { symbol } = useParams();
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDailyData(symbol);

      if (!chartRef.current || !candlestickSeriesRef.current) return;

      candlestickSeriesRef.current.setData(data);
      chartRef.current.timeScale().fitContent();
    } catch (err) {
      setError(err.message || "Failed to load chart data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 600,
      layout: { background: { color: "#0b1220" }, textColor: "#d1d5db" },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    resizeObserver.observe(chartContainerRef.current);

    loadData(); // load on mount

    return () => {
      chart.remove();
      resizeObserver.disconnect();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
    };
  }, [symbol]);

  return (
    <div className="relative flex flex-col h-screen bg-gray-950 text-white">
      <div ref={chartContainerRef} className="flex-1" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80">
          <p className="text-gray-400">Loading {symbol} data…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80">
          <div className="text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={loadData}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingView;
