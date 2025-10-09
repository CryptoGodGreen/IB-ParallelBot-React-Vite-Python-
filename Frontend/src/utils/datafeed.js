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
      // Convert resolution to Polygon.io format
      const resolutionMap = {
        '1': '1min',
        '5': '5min',
        '15': '15min',
        '30': '30min',
        '60': '1hour',
        '1D': '1day',
        '1W': '1week',
        '1M': '1month'
      };

      const polygonResolution = resolutionMap[resolution] || '1day';
      
      // Fix timestamp conversion - ensure we have valid numbers
      console.log('🔧 Raw timestamps:', 'from', from, 'to', to);
      console.log('🔧 Timestamp types:', typeof from, typeof to);
      
      // Convert to valid dates
      const fromDate = new Date(Number(from) * 1000);
      const toDate = new Date(Number(to) * 1000);
      
      console.log('🔧 Converted dates:', fromDate, toDate);
      
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid timestamp conversion');
      }
      
      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];

      // Using Polygon.io free API (no key required for basic data)
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbolInfo.name}/range/1/${polygonResolution}/${fromDateStr}/${toDateStr}?adjusted=true&sort=asc&limit=50000`;

      console.log('🌐 Fetching from Polygon.io:', url);
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results) {
        // Convert Polygon data to UDF format
        const filteredData = data.results.map(bar => ({
          time: Math.floor(bar.t / 1000), // Convert to seconds for UDF
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v || 0,
        }));

        if (filteredData.length > 0) {
          // Convert to UDF format with arrays
          const udfData = this.convertToUDFFormat(filteredData);
          console.log('UDF Data format from API:', udfData);
          
          // Convert back to TradingView format for onHistoryCallback
          const bars = this.convertToTradingViewFormat(filteredData);

          onHistoryCallback(bars, { noData: false });
          this.lastBar[symbolInfo.name] = bars[bars.length - 1];
        } else {
          onHistoryCallback([], { noData: true });
        }
      } else {
        console.warn('No data from Polygon.io, falling back to mock data');
        this.getMockBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback);
      }
    } catch (error) {
      console.error('Error fetching real data:', error);
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

    // Simulate real-time updates (for demonstration)
    const intervalId = setInterval(() => {
      if (this.lastBar[symbolInfo.name]) {
        const lastBar = { ...this.lastBar[symbolInfo.name] };
        lastBar.close = lastBar.close + (Math.random() * 2 - 1); // Simulate price change
        lastBar.high = Math.max(lastBar.high, lastBar.close);
        lastBar.low = Math.min(lastBar.low, lastBar.close);
        lastBar.volume = lastBar.volume + Math.floor(Math.random() * 100000);
        lastBar.time = Date.now(); // New timestamp for real-time
        onRealtimeCallback(lastBar);
        this.lastBar[symbolInfo.name] = lastBar;
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