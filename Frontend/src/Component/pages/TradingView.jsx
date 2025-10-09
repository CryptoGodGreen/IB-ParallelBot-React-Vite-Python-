import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ErrorBoundary from '../ErrorBoundary';

const TradingViewWidget = () => {
  const { symbol } = useParams();
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    setRetryKey(prev => prev + 1);
  };

  useEffect(() => {
    let mounted = true;
    let widget = null;
    let isInitializing = false;

    const initChart = async () => {
      if (isInitializing) {
        console.log('⏳ Already initializing, skipping...');
        return;
      }

      isInitializing = true;

      try {
        // Clean up any existing widget first
        if (widgetRef.current) {
          try {
            console.log('🧹 Removing existing widget...');
            widgetRef.current.remove();
          } catch (e) {
            console.warn('Error removing old widget:', e);
          }
          widgetRef.current = null;
        }

        // Clear the container completely
        if (containerRef.current) {
          while (containerRef.current.firstChild) {
            containerRef.current.removeChild(containerRef.current.firstChild);
          }
        }

        // Load TradingView library
        if (!window.TradingView) {
          console.log('📚 Loading TradingView library...');
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/charting_library/charting_library.standalone.js';
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        if (!mounted) {
          isInitializing = false;
          return;
        }

        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 200));

        if (!mounted) {
          isInitializing = false;
          return;
        }

        console.log('🚀 Creating TradingView widget with custom UDF datafeed');
        
        // Custom UDF-compatible datafeed
        const datafeed = {
          onReady: (callback) => {
            console.log('[onReady]: Method called');
            setTimeout(() => {
              callback({
                supports_search: true,
                supports_group_request: false,
                supports_marks: false,
                supports_timescale_marks: false,
                supports_time: true,
                supported_resolutions: ['1', '5', '15', '30', '60', 'D', 'W', 'M']
              });
            }, 0);
          },

          searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
            console.log('[searchSymbols]: Method called');
            fetch(`http://localhost:8000/udf/search?query=${userInput}&limit=50`)
              .then(response => response.json())
              .then(data => onResultReadyCallback(data))
              .catch(() => onResultReadyCallback([]));
          },

          resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
            console.log('[resolveSymbol]: Method called', symbolName);
            
            fetch(`http://localhost:8000/udf/symbol?symbol=${symbolName}`)
              .then(response => response.json())
              .then(data => {
                const symbolInfo = {
                  name: data.name || symbolName,
                  ticker: data.ticker || symbolName,
                  description: data.description || `${symbolName} Stock`,
                  type: data.type || 'stock',
                  session: data.session || '0930-1600',
                  timezone: data.timezone || 'America/New_York',
                  exchange: data.exchange || 'SMART',
                  minmov: data.minmov || 1,
                  pricescale: data.pricescale || 100,
                  has_intraday: Boolean(data.has_intraday),
                  has_daily: Boolean(data.has_daily),
                  has_weekly_and_monthly: Boolean(data.has_weekly_and_monthly),
                  supported_resolutions: data.supported_resolutions || ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
                  volume_precision: data.volume_precision || 0,
                  data_status: data.data_status || 'streaming',
                  autosize: data.autosize || true
                };
                console.log('[resolveSymbol]: Symbol resolved', symbolInfo);
                onSymbolResolvedCallback(symbolInfo);
              })
              .catch(error => {
                console.error('[resolveSymbol]: Error', error);
                onResolveErrorCallback('Cannot resolve symbol');
              });
          },

          getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
            const { from, to, firstDataRequest, countBack } = periodParams;
            
            const daysDiff = (to - from) / 86400;
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[getBars]: Called', {
              symbol: symbolInfo.name,
              resolution,
              from: new Date(from * 1000).toISOString(),
              to: new Date(to * 1000).toISOString(),
              daysDiff: daysDiff.toFixed(2),
              firstDataRequest,
              countBack
            });
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            fetch(`http://localhost:8000/udf/history?symbol=${symbolInfo.name}&from_timestamp=${from}&to_timestamp=${to}&resolution=${resolution}`)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
              })
              .then(data => {
                console.log('[getBars]: Data received', {
                  status: data.s,
                  bars: data.t?.length || 0,
                  firstTime: data.t?.[0] ? new Date(data.t[0] * 1000).toISOString() : null,
                  lastTime: data.t?.[data.t.length - 1] ? new Date(data.t[data.t.length - 1] * 1000).toISOString() : null
                });
                
                if (data.s === 'ok' && data.t && data.t.length > 0) {
                  const bars = data.t.map((time, index) => ({
                    time: time * 1000,
                    open: data.o[index],
                    high: data.h[index],
                    low: data.l[index],
                    close: data.c[index],
                    volume: data.v[index]
                  }));
                  
                  // Sort bars by time (ascending)
                  bars.sort((a, b) => a.time - b.time);
                  
                  console.log('[getBars]: Returning', bars.length, 'bars');
                  console.log('[getBars]: First bar:', new Date(bars[0].time).toISOString());
                  console.log('[getBars]: Last bar:', new Date(bars[bars.length - 1].time).toISOString());
                  console.log('[getBars]: Requested from:', new Date(from * 1000).toISOString());
                  console.log('[getBars]: Requested to:', new Date(to * 1000).toISOString());
                  
                  // Always tell TradingView there might be more data (noData: false)
                  // This allows continuous loading when panning
                  onHistoryCallback(bars, { noData: false });
                } else if (data.s === 'no_data') {
                  console.log('[getBars]: No data available');
                  onHistoryCallback([], { noData: true });
                } else if (data.s === 'error') {
                  console.error('[getBars]: Server error:', data.errmsg);
                  onErrorCallback(data.errmsg || 'Unknown error');
                } else {
                  onErrorCallback('Invalid data format');
                }
              })
              .catch(error => {
                console.error('[getBars]: Error', error);
                onErrorCallback(error.message);
              });
          },

          subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
            console.log('[subscribeBars]: Method called', subscriberUID);
          },

          unsubscribeBars: (subscriberUID) => {
            console.log('[unsubscribeBars]: Method called', subscriberUID);
          },

          calculateHistoryDepth: (resolution, resolutionBack, intervalBack) => {
            console.log('[calculateHistoryDepth]: Called', { resolution, resolutionBack, intervalBack });
            
            // Tell TradingView how much historical data to initially request
            // This controls the initial visible range
            if (resolution === '1') {
              // For 1-minute: request only 1 day initially
              return { resolutionBack: 'D', intervalBack: 1 };
            } else if (['3', '5', '15', '30'].includes(resolution)) {
              // For intraday: request 3 days
              return { resolutionBack: 'D', intervalBack: 3 };
            } else if (['60', '120', '240'].includes(resolution)) {
              // For hourly: request 1 week
              return { resolutionBack: 'D', intervalBack: 7 };
            } else {
              // For daily+: request 3 months
              return { resolutionBack: 'M', intervalBack: 3 };
            }
          }
        };

        const widgetOptions = {
          symbol: symbol || 'AAPL',
          datafeed: datafeed,
          interval: '1',
          container: containerRef.current,
          library_path: '/charting_library/',
          locale: 'en',
          disabled_features: ['use_localstorage_for_settings'],
          enabled_features: ['study_templates'],
          fullscreen: false,
          autosize: true,
          theme: 'Dark',
          debug: true,
          // Set initial visible range to 1 day for 1-minute chart
          time_frames: [
            { text: "1d", resolution: "1", description: "1 Day" },
            { text: "5d", resolution: "1", description: "5 Days" },
            { text: "1m", resolution: "5", description: "1 Month" },
            { text: "3m", resolution: "60", description: "3 Months" },
            { text: "6m", resolution: "D", description: "6 Months" },
            { text: "1y", resolution: "D", description: "1 Year" },
          ]
        };

        widget = new window.TradingView.widget(widgetOptions);
        widgetRef.current = widget;
        console.log('✅ TradingView widget created');

        widget.onChartReady(() => {
          if (mounted) {
            console.log('🎉 Chart is ready!');
            setIsLoading(false);
            setError(null);
          }
        });

      } catch (err) {
        console.error('❌ Error initializing chart:', err);
        if (mounted) {
          setError(err.message || 'Failed to initialize chart');
          setIsLoading(false);
        }
      } finally {
        isInitializing = false;
      }
    };

    // Reset error state when starting
    setError(null);
    setIsLoading(true);
    
    initChart();

    return () => {
      console.log('🔄 Component unmounting or re-rendering...');
      mounted = false;
      
      // Use setTimeout to defer cleanup and avoid React conflicts
      setTimeout(() => {
        if (widget) {
          try {
            console.log('🧹 Cleaning up widget (deferred)');
            widget.remove();
          } catch (e) {
            console.warn('Cleanup error:', e);
          }
        }
        if (widgetRef.current && widgetRef.current !== widget) {
          try {
            widgetRef.current.remove();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        widgetRef.current = null;
      }, 0);
    };
  }, [symbol, retryKey]);

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', backgroundColor: '#1e293b' }}>
        <div
          style={{
            flex: 1,
            backgroundColor: '#0f172a',
            border: "1px solid #334155",
            position: 'relative',
            minHeight: '400px',
            overflow: 'hidden'
          }}
        >
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0
            }}
            suppressHydrationWarning
          />
          {isLoading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              color: '#e2e8f0',
              fontSize: '18px',
              zIndex: 10,
              pointerEvents: 'none'
            }}>
              Loading TradingView Chart...
            </div>
          )}
      </div>

        {error && (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '24px',
            backgroundColor: '#1e293b',
            border: '2px solid #ef4444',
            color: '#e2e8f0',
            borderRadius: '12px',
            minWidth: '320px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            zIndex: 1000
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h3 style={{ margin: '0 0 8px 0', color: '#ef4444' }}>Chart Error</h3>
            <p style={{ margin: '0 0 20px 0', color: '#94a3b8' }}>{error}</p>
            <button
              onClick={handleRetry}
              style={{
                padding: '10px 24px',
                backgroundColor: '#3b82f6',
                border: 'none',
                color: 'white',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default TradingViewWidget;