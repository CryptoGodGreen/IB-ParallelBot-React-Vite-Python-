// Simple datafeed for TradingView Charting Library
// Minimal implementation focused on working with mock data

const configuration = {
  supports_search: false,
  supports_group_request: false,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
  supported_resolutions: ['1D'],
};

class SimpleDatafeed {
  constructor(mockData) {
    this.mockData = mockData;
    console.log('🚀 SimpleDatafeed initialized with', Object.keys(mockData["Time Series (Daily)"]).length, 'data points');
  }

  onReady(callback) {
    console.log('🚀 [onReady]: Simple datafeed ready');
    setTimeout(() => callback(configuration), 0);
  }

  resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
    console.log('📊 [resolveSymbol]: Resolving', symbolName);
    
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
      has_intraday: false,
      has_seconds: false,
      has_daily: true,
      has_weekly_and_monthly: false,
      supported_resolutions: ['1D'],
      volume_precision: 0,
      data_status: 'streaming',
    };
    
    console.log('📊 Symbol resolved:', symbolInfo);
    setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
  }

  getBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback, firstDataRequest) {
    console.log('📈 [getBars]: Getting bars for', symbolInfo.name, resolution);
    
    try {
      // Convert mock data to TradingView format
      const bars = Object.keys(this.mockData["Time Series (Daily)"])
        .map(date => {
          const d = this.mockData["Time Series (Daily)"][date];
          return {
            time: new Date(date).getTime(),
            open: parseFloat(d["1. open"]),
            high: parseFloat(d["2. high"]),
            low: parseFloat(d["3. low"]),
            close: parseFloat(d["4. close"]),
            volume: parseFloat(d["5. volume"]) || 0,
          };
        })
        .sort((a, b) => a.time - b.time);

      console.log('📊 Processed', bars.length, 'bars');
      console.log('📊 Sample bar:', bars[0]);
      
      if (bars.length > 0) {
        onHistoryCallback(bars, { noData: false });
        console.log('✅ Data loaded successfully');
      } else {
        onHistoryCallback([], { noData: true });
        console.log('❌ No data found');
      }
    } catch (error) {
      console.error('❌ Error in getBars:', error);
      onErrorCallback(error);
    }
  }

  subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
    console.log('📡 [subscribeBars]: Subscribing to', symbolInfo.name);
    // No real-time updates for now
  }

  unsubscribeBars(subscriberUID) {
    console.log('📡 [unsubscribeBars]: Unsubscribing', subscriberUID);
  }
}

export default SimpleDatafeed;
