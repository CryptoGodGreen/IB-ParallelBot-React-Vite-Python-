// UDF-compatible datafeed for TradingView Charting Library
// This implements the Universal Data Feed interface

const configuration = {
  supports_search: false,
  supports_group_request: false,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
  supported_resolutions: ['1', '5', '15', '30', '60', '1D', '1W', '1M'],
};

class Datafeed {
  constructor(mockData) {
    this.mockData = mockData;
    this.subscribers = {};
    this.lastBar = {};
    this.useMockData = false; // Set to true to use mock data
  }

  // Helper function to convert data to UDF format
  convertToUDFFormat(data) {
    return {
      s: "ok",
      t: data.map(bar => bar.time),
      c: data.map(bar => bar.close),
      o: data.map(bar => bar.open),
      h: data.map(bar => bar.high),
      l: data.map(bar => bar.low),
      v: data.map(bar => bar.volume)
    };
  }

  // Helper function to convert data to TradingView format
  convertToTradingViewFormat(data) {
    return data.map(bar => ({
      time: bar.time * 1000, // Convert to milliseconds for TradingView
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  }

  onReady(callback) {
    console.log('🚀 [onReady]: TradingView datafeed is ready!');
    setTimeout(() => callback(configuration), 0);
  }

  resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
    console.log('📊 [resolveSymbol]: Resolving symbol', symbolName);
    const symbolInfo = {
      name: symbolName,
      ticker: symbolName,
      description: `${symbolName} Stock`,
      type: 'stock',
      session: '0930-1600',
      timezone: 'America/New_York',
      exchange: 'NASDAQ',
      minmov: 1,
      pricescale: 100,
      has_intraday: true,
      has_seconds: false,
      has_daily: true,
      has_weekly_and_monthly: true,
      supported_resolutions: configuration.supported_resolutions,
      volume_precision: 0,
      data_status: 'streaming',
      format: 'price',
      pointvalue: 1,
      has_no_volume: false,
      currency_code: 'USD',
      original_name: symbolName,
      visible_plots_set: 'ohlcv',
      unit_id: 'USD',
    };
    console.log('📊 Symbol info resolved:', symbolInfo);
    setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
  }

  getBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback, firstDataRequest) {
    console.log('📈 [getBars]: Loading data for', symbolInfo.name, resolution);
    console.log('📅 Date range:', 'from', new Date(from * 1000), 'to', new Date(to * 1000));
    console.log('📅 Timestamps:', 'from', from, 'to', to);
    console.log('🔧 useMockData:', this.useMockData);

    if (this.useMockData) {
      console.log('📊 Using mock data');
      this.getMockBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback);
    } else {
      console.log('🌐 Using real API (Polygon.io)');
      this.getRealBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback);
    }
  }

  getMockBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback) {
    try {
      console.log('Getting mock bars for:', symbolInfo.name, 'from', from, 'to', to);
      
      // Get all available dates from mock data
      const allDates = Object.keys(this.mockData["Time Series (Daily)"]);
      console.log('📊 Available dates in mock data:', allDates.length, 'dates');
      console.log('📊 First date:', allDates[0], 'Last date:', allDates[allDates.length - 1]);
      
      // For now, let's return all available data regardless of date range
      // This ensures we always have data to display
      const bars = allDates.map(date => {
        const d = this.mockData["Time Series (Daily)"][date];
        return {
          time: new Date(date).getTime(), // TradingView expects milliseconds
          open: parseFloat(d["1. open"]),
          high: parseFloat(d["2. high"]),
          low: parseFloat(d["3. low"]),
          close: parseFloat(d["4. close"]),
          volume: parseFloat(d["5. volume"]) || 0,
        };
      }).sort((a, b) => a.time - b.time);

      console.log('📊 Processed bars:', bars.length, 'bars');
      console.log('📊 First bar:', new Date(bars[0].time), 'Last bar:', new Date(bars[bars.length - 1].time));
      
      if (bars.length > 0) {
        try {
          console.log('📊 Sample bar data:', bars[0]);
          onHistoryCallback(bars, { noData: false });
          this.lastBar[symbolInfo.name] = bars[bars.length - 1];
          console.log('✅ Successfully loaded', bars.length, 'bars for', symbolInfo.name);
        } catch (callbackError) {
          console.error('❌ Error in onHistoryCallback:', callbackError);
          onErrorCallback(callbackError);
        }
      } else {
        console.log('❌ No data found');
        try {
          onHistoryCallback([], { noData: true });
        } catch (callbackError) {
          console.error('❌ Error in onHistoryCallback (no data):', callbackError);
          onErrorCallback(callbackError);
        }
      }
    } catch (error) {
      console.error('❌ Error getting mock bars:', error);
      onErrorCallback(error);
    }
  }

  async getRealBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback) {
    try {
      console.log('🌐 Using our backend API for real-time data');
      
      // Convert timestamps to seconds (our backend expects seconds)
      const fromTimestamp = Math.floor(from);
      const toTimestamp = Math.floor(to);
      
      console.log('🔧 Timestamps:', 'from', fromTimestamp, 'to', toTimestamp);
      console.log('🔧 Dates:', new Date(fromTimestamp * 1000), 'to', new Date(toTimestamp * 1000));
      
      // Call our backend UDF endpoint
      const backendUrl = `http://localhost:8000/udf/history?symbol=${symbolInfo.name}&from_timestamp=${fromTimestamp}&to_timestamp=${toTimestamp}&resolution=${resolution}`;
      
      console.log('🌐 Fetching from our backend:', backendUrl);
      
      const response = await fetch(backendUrl);
      const data = await response.json();
      
      console.log('📊 Backend response:', data);
      
      if (data.s === 'error') {
        throw new Error(data.errmsg || 'Backend error');
      }
      
      if (!data.t || !data.c || !data.o || !data.h || !data.l) {
        throw new Error('Invalid data format from backend');
      }
      
      // Convert backend data to TradingView format
      const bars = data.t.map((time, index) => ({
        time: time * 1000, // Convert to milliseconds for TradingView
        open: data.o[index],
        high: data.h[index],
        low: data.l[index],
        close: data.c[index],
        volume: data.v ? data.v[index] : 0,
      }));
      
      console.log('📊 Processed bars:', bars.length, 'bars');
      if (bars.length > 0) {
        console.log('📊 First bar:', new Date(bars[0].time));
        console.log('📊 Last bar:', new Date(bars[bars.length - 1].time));
      }
      
      if (bars.length > 0) {
        onHistoryCallback(bars, { noData: false });
        this.lastBar[symbolInfo.name] = bars[bars.length - 1];
        console.log('✅ Successfully loaded', bars.length, 'bars for', symbolInfo.name);
      } else {
        onHistoryCallback([], { noData: true });
        console.log('⚠️ No data available for', symbolInfo.name);
      }
      
    } catch (error) {
      console.error('❌ Error getting real bars:', error);
      console.log('Falling back to mock data');
      this.getMockBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback);
    }
  }

  subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
    console.log('[subscribeBars]: Method called', symbolInfo.name, resolution, subscriberUID);
    this.subscribers[subscriberUID] = {
      symbolInfo,
      resolution,
      onRealtimeCallback,
      onResetCacheNeededCallback,
    };

    // Fetch real-time updates from our backend every 5 seconds
    const intervalId = setInterval(async () => {
      try {
        // Get recent data from backend (last 5 minutes)
        const now = Math.floor(Date.now() / 1000);
        const fromTimestamp = now - 300; // 5 minutes ago
        
        const backendUrl = `http://localhost:8000/udf/history?symbol=${symbolInfo.name}&from_timestamp=${fromTimestamp}&to_timestamp=${now}&resolution=${resolution}`;
        
        const response = await fetch(backendUrl);
        const data = await response.json();
        
        if (data.s === 'ok' && data.t && data.t.length > 0) {
          // Get the latest bar
          const latestBar = {
            time: data.t[data.t.length - 1] * 1000, // Convert to milliseconds
            open: data.o[data.o.length - 1],
            high: data.h[data.h.length - 1],
            low: data.l[data.l.length - 1],
            close: data.c[data.c.length - 1],
            volume: data.v ? data.v[data.v.length - 1] : 0,
          };
          
          console.log('📊 Real-time update:', latestBar);
          onRealtimeCallback(latestBar);
          this.lastBar[symbolInfo.name] = latestBar;
        }
      } catch (error) {
        console.error('❌ Error fetching real-time data:', error);
      }
    }, 5000); // Update every 5 seconds

    // Store interval ID for cleanup
    this.subscribers[subscriberUID].intervalId = intervalId;
  }

  unsubscribeBars(subscriberUID) {
    console.log('[unsubscribeBars]: Method called', subscriberUID);
    if (this.subscribers[subscriberUID]) {
      if (this.subscribers[subscriberUID].intervalId) {
        clearInterval(this.subscribers[subscriberUID].intervalId);
      }
      delete this.subscribers[subscriberUID];
    }
  }
}

export default Datafeed;