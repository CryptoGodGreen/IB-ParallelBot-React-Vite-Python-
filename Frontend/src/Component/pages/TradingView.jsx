import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import chartData from '../../data/chartData.json'

const TradingViewWidget = () => {
  
  const chartContainerRef = useRef(null);
  const { symbol } = useParams();
  const [selectedColor, setSelectedColor] = useState('#f5647cff');
  const [lineMode, setLineMode] = useState('create');
  const [savedLayouts, setSavedLayouts] = useState([]);
  const [selectedLayoutId, setSelectedLayoutId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [drawingEnabled, setDrawingEnabled] = useState(true);

  // API configuration
  const API_KEY = 'K54V0ZJY31VRD59K';
  const API_BASE_URL = 'http://localhost:8000';

  // Chart references
  const chartInstance = useRef(null);
  const candleSeries = useRef(null);
  const areaSeries = useRef(null);
  const lines = useRef([]);
  const lineData = useRef({ entry_line: null, exit_line: null });
  const clickPoints = useRef([]);
  const colorIndex = useRef(0);
  const updateSelection = useRef(null); 
  const handleChartClickRef = useRef(null); 
  const subscribedClickWrapperRef = useRef(null);

  // Color options with better visual representation
  const colorOptions = [
    { value: '#f5647cff', name: 'Red', bg: '#f5647c' },
    { value: '#6cfaa0ff', name: 'Green', bg: '#6cfaa0' },

  ];

  // Show success message temporarily
  const showSuccess = (message) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  // Toggle drawing mode
  const toggleDrawing = () => {
    setDrawingEnabled(!drawingEnabled);
    setLineMode('none');
    showSuccess(drawingEnabled ? 'Drawing disabled' : 'Drawing enabled');
  };

  

  // Initialize chart
  const initChart = useCallback(() => {
    if (!window.LightweightCharts) {
      setError("LightweightCharts library not loaded");
      return null;
    }

    if (!chartContainerRef.current) {
      setError("Chart container not found");
      return null;
    }

    const containerWidth = chartContainerRef.current.clientWidth || 800;
    const containerHeight = chartContainerRef.current.clientHeight || 500;

    const chart = window.LightweightCharts.createChart(
      chartContainerRef.current,
      {
        width: containerWidth,
        height: containerHeight,
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
        },
        timeScale: {
          borderColor: "#475569",
          fixLeftEdge: true,
          fixRightEdge: true,
        },
      }
    );

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const areaSeriesInstance = chart.addAreaSeries({
      lineColor: "#38bdf8",
      topColor: "rgba(56, 189, 248, 0.4)",
      bottomColor: "rgba(15, 23, 42, 0)",
      lineWidth: 2,
    });

    chartInstance.current = chart;
    candleSeries.current = candlestickSeries;
    areaSeries.current = areaSeriesInstance;

    return chart;
  }, []);

  // Fetch stock data
  const fetchStockData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // const response = await fetch(
      //   `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${API_KEY}`
      // );

      // if (!response.ok) {
      //   throw new Error(`API request failed: ${response.status}`);
      // }

      // const data = await response.json();
      const data = chartData
      console.log(data);
      
      if (!data["Time Series (Daily)"]) {
        throw new Error("Invalid API response: No time series data found");
      }

      const dailyData = data["Time Series (Daily)"];
      const candles = Object.keys(dailyData)
        .map((date) => {
          const d = dailyData[date];
          return {
            time: Math.floor(new Date(date).getTime() / 1000),
            open: parseFloat(d["1. open"]),
            high: parseFloat(d["2. high"]),
            low: parseFloat(d["3. low"]),
            close: parseFloat(d["4. close"]),
          };
        })
        .reverse();

      if (candleSeries.current) {
        candleSeries.current.setData(candles);
      }
      if (areaSeries.current) {
        areaSeries.current.setData(
          candles.map((c) => ({
            time: c.time,
            value: c.close,
          }))
        );
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching stock data:', error);
      setError(`Failed to load stock data: ${error.message}`);
      setIsLoading(false);
    }
  }, [symbol, API_KEY]);

  // Chart interaction handlers
  const clearLines = useCallback(() => {
    const chart = chartInstance.current;
    if (chart && Array.isArray(lines.current) && lines.current.length > 0) {
      lines.current.filter(Boolean).forEach((series) => {
        try {
          chart.removeSeries(series);
        } catch (_) {
          // ignore already-removed or invalid refs
        }
      });
    }
    lines.current = [];
    clickPoints.current = [];
    lineData.current = { entry_line: null, exit_line: null };
    colorIndex.current = 0;
    setSelectedLayoutId(null);
    showSuccess('All lines cleared');
  }, []);

  const drawLine = useCallback((points, color = selectedColor) => {
    if (!chartInstance.current) return null;
    
    const lineSeries = chartInstance.current.addLineSeries({
      color: color,
      lineWidth: 2,
      lineStyle: 0, // Solid line
      crosshairMarkerVisible: true,
    });
    lineSeries.setData(points);
    lines.current.push(lineSeries);
    return lineSeries;
  }, [selectedColor]);

  const sendLayoutData = useCallback(async (method = 'POST', id = null) => {

    try {
      const layoutData = {
        name: `${symbol} Layout Plan`,
        symbol: symbol,
        interval: "1d",
        rth: true,
        layout_data: {
          entry_line: lineData.current.entry_line,
          exit_line: lineData.current.exit_line,
          tpsl_settings: {
            tp_type: "percentage",
            tp_value: 2.5,
            sl_type: "fixed",
            sl_value: 1.0
          },
          other_drawings: {}
        }
      };

      const token = localStorage.getItem("token");
      console.log(layoutData,token);

      if (!token) {
        setError('Authentication token not found');
        return;
      }

      const url = id ? `${API_BASE_URL}/charts/${id}` : `${API_BASE_URL}/charts`;

      console.log('[Save] URL:', url, 'METHOD:', method, 'payload:', layoutData);
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(layoutData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Save] Error response', response.status, errorText);
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[Save] Success response', data);
      // Try multiple common shapes for id
      const newId = data?.id || data?.data?.id || data?.chart?.id || id;
      if (newId) setSelectedLayoutId(newId);
      if (method === 'POST' && newId) {
        setLineMode('update');
      }
      showSuccess(id ? 'Layout updated successfully!' : 'Layout saved successfully!');
      // If full layout returned, load it immediately; else refetch symbol layouts
      if (data && data.layout_data) {
        loadLayout(data);
      } else {
      fetchLayouts();
      }
    } catch (error) {
      console.error('Error saving layout data:', error);
      setError(`Failed to save layout: ${error.message}`);
    }
  }, [symbol, API_BASE_URL]);

  const deleteLayout = useCallback(async (id) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setError('Authentication token not found');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/charts/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to delete layout: ${response.status}`);
      }

      showSuccess('Layout deleted successfully!');
      fetchLayouts();

      if (selectedLayoutId === id) {
        setSelectedLayoutId(null);
        clearLines();
      }
    } catch (error) {
      console.error('Error deleting layout:', error);
      setError('Failed to delete layout');
    }
  }, [API_BASE_URL, selectedLayoutId, clearLines]);

  const loadLayout = useCallback((layout) => {
    // Clear safely without unsetting selected layout id here
    const chart = chartInstance.current;
    if (chart && Array.isArray(lines.current) && lines.current.length > 0) {
      lines.current.filter(Boolean).forEach((series) => {
        try { chart.removeSeries(series); } catch (_) {}
      });
    }
    lines.current = [];
    clickPoints.current = [];
    lineData.current = { entry_line: null, exit_line: null };
    colorIndex.current = 0;
    
    // Draw entry line
    if (layout.layout_data.entry_line) {
      const entryPoints = [
        { time: layout.layout_data.entry_line.p1.time, value: layout.layout_data.entry_line.p1.price },
        { time: layout.layout_data.entry_line.p2.time, value: layout.layout_data.entry_line.p2.price }
      ];
      drawLine(entryPoints, colorOptions[0].value);
      lineData.current.entry_line = layout.layout_data.entry_line;
    }
    
    // Draw exit line
    if (layout.layout_data.exit_line) {
      const exitPoints = [
        { time: layout.layout_data.exit_line.p1.time, value: layout.layout_data.exit_line.p1.price },
        { time: layout.layout_data.exit_line.p2.time, value: layout.layout_data.exit_line.p2.price }
      ];
      drawLine(exitPoints, colorOptions[1].value);
      lineData.current.exit_line = layout.layout_data.exit_line;
    }
    
    setSelectedLayoutId(layout.id);
    showSuccess('Layout loaded successfully!');
  }, [clearLines, drawLine]);

  // Fetch saved layouts (moved after loadLayout so it's initialized before use)
  const fetchLayouts = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        console.warn('No authentication token found');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/charts`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch layouts: ${response.status}`);
      }

      const data = await response.json();
      const bySymbol = Array.isArray(data) ? data.filter(l => (l?.symbol || '').toString() === (symbol || '').toString()) : [];
      setSavedLayouts(bySymbol);
      if (bySymbol.length > 0) {
        const first = bySymbol[0];
        setSelectedLayoutId(first.id);
        loadLayout(first);
      }
    } catch (error) {
      console.error('Error fetching layouts:', error);
      setError('Failed to load saved layouts');
    }
  }, [API_BASE_URL, symbol, loadLayout]);

  // Layout existence flags (computed before handlers to avoid TDZ in deps)
  const hasLayoutForSymbol = Array.isArray(savedLayouts)
    && savedLayouts.some(l => l && l.id === selectedLayoutId && (l.symbol || '').toString() === (symbol || '').toString());
  const anyLayoutExistsForSymbol = Array.isArray(savedLayouts) && savedLayouts.length > 0;
  // Treat layout as present immediately if we have an id, even before refetch
  const uiLayoutPresent = !!selectedLayoutId || hasLayoutForSymbol;

  // Reset local drawing state when symbol changes to avoid stale series references
  useEffect(() => {
    lines.current = [];
    clickPoints.current = [];
    lineData.current = { entry_line: null, exit_line: null };
    colorIndex.current = 0;
    updateSelection.current = null;
  }, [symbol]);

  // Handle chart click events
  const handleChartClick = useCallback((param) => {
    if (!drawingEnabled || !param.time || lineMode === 'none' || !candleSeries.current) return;

    const price = param.seriesData.get(candleSeries.current)?.close;
    if (!price) return;

    // Update mode: select and move a single endpoint, then save immediately
    if (lineMode === 'update' && selectedLayoutId) {
      // Helper to find closest endpoint within tolerance
      const findClosestEndpoint = () => {
        const candidates = [];
        const pushCandidate = (lineKey, pointKey, pt) => {
          const dt = Math.abs(pt.time - param.time);
          const dp = Math.abs(pt.price - price) / Math.max(1e-6, pt.price);
          candidates.push({ lineKey, pointKey, dt, dp });
        };

        if (lineData.current.entry_line) {
          pushCandidate('entry_line', 'p1', lineData.current.entry_line.p1);
          pushCandidate('entry_line', 'p2', lineData.current.entry_line.p2);
        }
        if (lineData.current.exit_line) {
          pushCandidate('exit_line', 'p1', lineData.current.exit_line.p1);
          pushCandidate('exit_line', 'p2', lineData.current.exit_line.p2);
        }

        if (candidates.length === 0) return null;
        // Choose by weighted distance; time window ~1 day (86400s), price tolerance ~1%
        const ranked = candidates
          .map(c => ({ ...c, score: c.dt / 86400 + c.dp / 0.01 }))
          .sort((a, b) => a.score - b.score);
        const best = ranked[0];
        if (!best) return null;
        // Require within loose tolerance
        if (best.dt <= 2 * 86400 && best.dp <= 0.05) return { lineKey: best.lineKey, pointKey: best.pointKey };
        return null;
      };

      // If no selection yet, try to select a close endpoint
      if (!updateSelection.current) {
        const sel = findClosestEndpoint();
        if (sel) {
          updateSelection.current = sel;
          showSuccess('Endpoint selected. Click new position to update.');
        }
        return; // wait for next click
      }

      // We have a selected endpoint; update it to this click location
      const { lineKey, pointKey } = updateSelection.current;
      if (lineData.current[lineKey]) {
        // Update the underlying data
        lineData.current[lineKey][pointKey] = { time: param.time, price };
        const seriesIndex = lineKey === 'entry_line' ? 0 : 1;
        const series = lines.current[seriesIndex];
        if (series) {
          const newPoints = [
            { time: lineData.current[lineKey].p1.time, value: lineData.current[lineKey].p1.price },
            { time: lineData.current[lineKey].p2.time, value: lineData.current[lineKey].p2.price },
          ];
          series.setData(newPoints);
        }
        updateSelection.current = null;
        sendLayoutData('PUT', selectedLayoutId);
        showSuccess('Line updated');
      }
      return;
    }

    if (lineMode === 'delete') {
      // Find and remove the clicked line
      const clickedLineIndex = lines.current.findIndex(line => {
        const seriesData = line.data();
        return seriesData && seriesData.some(point =>
          Math.abs(point.time - param.time) < 86400 &&
          Math.abs(point.value - price) < price * 0.01
        );
      });

      if (clickedLineIndex !== -1 && chartInstance.current) {
        // If any line clicked in delete mode and a layout is selected, delete the layout
        if (selectedLayoutId) {
          deleteLayout(selectedLayoutId);
          return;
        }

        // Fallback: remove the clicked line locally when no layout exists
        chartInstance.current.removeSeries(lines.current[clickedLineIndex]);
        lines.current.splice(clickedLineIndex, 1);
        if (clickedLineIndex === 0) lineData.current.entry_line = null; else if (clickedLineIndex === 1) lineData.current.exit_line = null;
        showSuccess('Line deleted');
      }
      return;
    }

    // Create mode: draw by two clicks
    if (lineMode === 'create') {
    clickPoints.current.push({ time: param.time, value: price });

    if (clickPoints.current.length === 2) {
      // Add new line
      drawLine(clickPoints.current, selectedColor);

      // Store line data
      if (colorIndex.current === 0 || lines.current.length === 1) {
        lineData.current.entry_line = {
          p1: { time: clickPoints.current[0].time, price: clickPoints.current[0].value },
          p2: { time: clickPoints.current[1].time, price: clickPoints.current[1].value }
        };
      } else {
        lineData.current.exit_line = {
          p1: { time: clickPoints.current[0].time, price: clickPoints.current[0].value },
          p2: { time: clickPoints.current[1].time, price: clickPoints.current[1].value }
        };
      }

      clickPoints.current = [];
      colorIndex.current++;

        // Only create layout when two lines are drawn and no layout exists for this symbol
      if (lines.current.length === 2) {
          const sym = (symbol || '').toString();
          const alreadyExists = Array.isArray(savedLayouts)
            && savedLayouts.some(l => ((l?.symbol || '').toString().toUpperCase()) === sym.toUpperCase());
          console.log('[Create] Two lines completed for symbol', sym, 'alreadyExists?', alreadyExists, 'savedLayouts:', savedLayouts);
          if (!alreadyExists) {
            console.log('[Create] Sending POST layout');
            sendLayoutData('POST');
        } else {
            console.log('[Create] Skipping POST, layout exists for symbol', sym);
            showSuccess('Only one layout per symbol is allowed');
        }
      } else {
        showSuccess('Line created');
      }
    }
    }
  }, [drawingEnabled, lineMode, selectedLayoutId, selectedColor, clearLines, drawLine, sendLayoutData, anyLayoutExistsForSymbol]);

  // Keep ref pointing to the latest click handler implementation
  useEffect(() => {
    handleChartClickRef.current = handleChartClick;
  }, [handleChartClick]);

  // Setup chart and data; subscribe click once via stable wrapper
  useEffect(() => {
    const chart = initChart();
    if (!chart) return;

    fetchStockData();
    fetchLayouts();

    // Subscribe to click events via a stable wrapper
    const clickWrapper = (param) => {
      if (handleChartClickRef.current) {
        handleChartClickRef.current(param);
      }
    };
    subscribedClickWrapperRef.current = clickWrapper;
    chart.subscribeClick(clickWrapper);

    // Handle resize
    const resizeHandler = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", resizeHandler);

    // Cleanup on unmount only
    return () => {
      window.removeEventListener("resize", resizeHandler);
      if (subscribedClickWrapperRef.current) {
        try { chart.unsubscribeClick(subscribedClickWrapperRef.current); } catch (_) {}
        subscribedClickWrapperRef.current = null;
      }
      if (chart) {
        try { chart.remove(); } catch (_) {}
      }
    };
  }, [initChart, fetchStockData, fetchLayouts]);

  // Keep delete button visibility accurate for current symbol

  // If symbol changes or no matching layout exists, hide delete by clearing selectedLayoutId
  useEffect(() => {
    if (!hasLayoutForSymbol) {
      // do not clear during active draw; just hide delete by nulling id
      setSelectedLayoutId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, savedLayouts]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px', backgroundColor: '#1e293b' }}>
      {/* Header with controls - Professional trading style */}
      <div style={{
        padding: '16px', 
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
        flexWrap: 'wrap',
        backgroundColor: '#334155',
        borderRadius: '8px',
        marginBottom: '16px',
        border: '1px solid #475569'
      }}>
        {/* Drawing Mode / Toggle */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontWeight: '600', color: '#e2e8f0', fontSize: '14px' }}>Drawing:</span>
          {/* Toggle Switch */}
          <div
            onClick={toggleDrawing}
            role="switch"
            aria-checked={drawingEnabled}
            style={{
              position: 'relative',
              width: '54px',
              height: '28px',
              backgroundColor: drawingEnabled ? '#10b981' : '#475569',
              borderRadius: '9999px',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              border: '1px solid #334155'
            }}
            title={drawingEnabled ? 'Drawing On' : 'Drawing Off'}
          >
            <div
              style={{
                position: 'absolute',
                top: '3px',
                left: drawingEnabled ? '28px' : '3px',
                width: '22px',
                height: '22px',
                backgroundColor: '#fff',
                borderRadius: '50%',
                transition: 'left 0.2s ease'
              }}
            />
          </div>

          {/* Create/Update appear only when drawing is enabled */}
          {drawingEnabled && (
            <>
              {!uiLayoutPresent && (
          <button
                  onClick={() => { setLineMode('create'); }}
            style={{
              backgroundColor: lineMode === 'create' ? '#3b82f6' : '#475569', 
              color: 'white', 
              padding: '8px 16px', 
              borderRadius: '6px', 
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Create Line
          </button>
              )}

              {uiLayoutPresent && (
          <button
                  onClick={() => { setLineMode('update'); }}
            style={{
              backgroundColor: lineMode === 'update' ? '#3b82f6' : '#475569', 
              color: 'white', 
              padding: '8px 16px', 
              borderRadius: '6px', 
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Update Line
          </button>
              )}
            </>
          )}
        </div>

        {/* Right side controls: color (when creating) and Delete at far right */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
          {drawingEnabled && !uiLayoutPresent && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontWeight: '600', color: '#e2e8f0', fontSize: '14px' }}>Line Color:</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {colorOptions.slice(0, 6).map((color) => (
              <button
                key={color.value}
                onClick={() => setSelectedColor(color.value)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: color.bg,
                  border: selectedColor === color.value ? '2px solid white' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                title={color.name}
              />
            ))}
          </div>
        </div>
          )}

          {uiLayoutPresent && (
          <button
            onClick={() => deleteLayout(selectedLayoutId)}
            style={{
              backgroundColor: '#ef4444', 
              color: 'white', 
              padding: '8px 16px', 
              borderRadius: '6px', 
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '14px'
            }}
            title={`Delete layout ${selectedLayoutId}`}
          >
            Delete
          </button>
        )}
        </div>
      </div>

      {/* Status messages (top-right overlays) */}
      <div style={{ position: 'fixed', top: '16px', right: '16px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1000 }}>
        {error && (
          <div style={{
            padding: '10px 14px',
          backgroundColor: '#7f1d1d', 
          border: '1px solid #ef4444', 
            color: '#fecaca',
          borderRadius: '6px',
            minWidth: '260px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 8px 16px rgba(0,0,0,0.3)'
          }}>
            <span style={{ marginRight: '12px' }}>{error}</span>
            <button
              onClick={() => setError(null)}
              style={{ background: 'none', border: 'none', color: '#fecaca', cursor: 'pointer', fontSize: '18px' }}
            >
            ×
            </button>
          </div>
        )}

        {successMessage && (
          <div style={{
            padding: '10px 14px',
          backgroundColor: '#065f46', 
            border: '1px solid #10b981',
            color: '#d1fae5',
          borderRadius: '6px',
            minWidth: '260px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 8px 16px rgba(0,0,0,0.3)'
          }}>
            <span style={{ marginRight: '12px' }}>{successMessage}</span>
            <button
              onClick={() => setSuccessMessage('')}
              style={{ background: 'none', border: 'none', color: '#d1fae5', cursor: 'pointer', fontSize: '18px' }}
            >
            ×
            </button>
          </div>
        )}
      </div>

      {/* Chart container */}
      <div
        ref={chartContainerRef}
        style={{
          flex: 1,
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid #475569",
          backgroundColor: '#1e293b',
          minHeight: '500px'
        }}
      />
    </div>
  );
};

export default TradingViewWidget;
