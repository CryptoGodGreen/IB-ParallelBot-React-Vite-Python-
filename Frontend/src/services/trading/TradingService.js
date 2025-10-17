import LimitBot from './LimitBot.js';
import LimitLine from './LimitLine.js';

/**
 * TradingService integrates the limit-order ladder strategy with TradingView chart lines
 * Manages the connection between chart drawings and trading bot logic
 */
export class TradingService {
  constructor() {
    this.activeBots = new Map(); // Map of configId -> LimitBot
    this.chartLines = new Map(); // Map of lineId -> TradingView line data
    this.isInitialized = false;
    
    // Event callbacks
    this.onBotStatusChange = null;
    this.onOrderUpdate = null;
    this.onError = null;
    
    console.log('TradingService: Initialized');
  }

  /**
   * Initialize the trading service
   * @param {Object} callbacks - Event callbacks
   */
  initialize(callbacks = {}) {
    this.onBotStatusChange = callbacks.onBotStatusChange || (() => {});
    this.onOrderUpdate = callbacks.onOrderUpdate || (() => {});
    this.onError = callbacks.onError || (() => {});
    
    this.isInitialized = true;
    console.log('TradingService: Initialized with callbacks');
  }

  /**
   * Create or update a trading bot from chart configuration
   * @param {Object} configData - Chart configuration data
   * @returns {LimitBot} Created or updated bot
   */
  createBotFromConfig(configData) {
    if (!this.isInitialized) {
      console.error('TradingService: Not initialized');
      return null;
    }

    const configId = configData.id;
    const layoutData = configData.layout_data || {};
    const botConfig = layoutData.bot_configuration || {};
    
    // Create or get existing bot
    let bot = this.activeBots.get(configId);
    if (!bot) {
      bot = new LimitBot({
        id: `bot_${configId}`,
        name: configData.name,
        symbol: configData.symbol,
        chartSide: botConfig.chart_side || 'B', // Default to buy side
        chartRight: botConfig.chart_right || 'C', // Default to call
        maxPosition: botConfig.max_position || 10000,
        positionSize: botConfig.position_size || 1000,
        maxDistanceFromEntry: botConfig.max_distance_from_entry || 0.05,
        updateInterval: botConfig.update_interval || 1000,
        // Old Ruby system stop-out configuration
        stopOutPercent: botConfig.stop_out_percent || null,
        stopOutTimeLimit: botConfig.stop_out_time_limit || null, // in minutes
        hardStopOut: botConfig.hard_stop_out || null, // percentage threshold
        // Enhanced stop-out rules (keeping for backward compatibility)
        fiveMinuteStopLoss: botConfig.five_minute_stop_loss?.enabled || false,
        fiveMinuteStopLossThreshold: botConfig.five_minute_stop_loss?.threshold || 0.02,
        fifteenMinuteStopLoss: botConfig.fifteen_minute_stop_loss?.enabled || false,
        fifteenMinuteStopLossThreshold: botConfig.fifteen_minute_stop_loss?.threshold || 0.03,
        oneHourStopLoss: botConfig.one_hour_stop_loss?.enabled || false,
        oneHourStopLossThreshold: botConfig.one_hour_stop_loss?.threshold || 0.05,
        onOrderPlaced: (order) => this.handleOrderPlaced(configId, order),
        onOrderFilled: (orderData) => this.handleOrderFilled(configId, orderData),
        onStopOut: (reason) => this.handleStopOut(configId, reason),
        onError: (error) => this.handleError(configId, error)
      });
      
      this.activeBots.set(configId, bot);
      console.log(`TradingService: Created bot for config ${configId}`);
    }

    // Update bot configuration
    bot.updateConfig({
      maxPosition: botConfig.max_position || 10000,
      positionSize: botConfig.trade_amount || 1000, // Use trade_amount from config
      maxDistanceFromEntry: botConfig.max_distance_from_entry || 0.05,
      updateInterval: botConfig.update_interval || 1000
    });

    // Update stop-out rules
    bot.stopOutRules = {
      fiveMinute: {
        enabled: botConfig.five_minute_stop_loss?.enabled || false,
        threshold: botConfig.five_minute_stop_loss?.threshold || 0.02,
        hardStop: botConfig.five_minute_stop_loss?.hard_stop || false
      },
      fifteenMinute: {
        enabled: botConfig.fifteen_minute_stop_loss?.enabled || false,
        threshold: botConfig.fifteen_minute_stop_loss?.threshold || 0.03,
        hardStop: botConfig.fifteen_minute_stop_loss?.hard_stop || false
      },
      oneHour: {
        enabled: botConfig.one_hour_stop_loss?.enabled || false,
        threshold: botConfig.one_hour_stop_loss?.threshold || 0.05,
        hardStop: botConfig.one_hour_stop_loss?.hard_stop || false
      }
    };

    return bot;
  }

  /**
   * Update bot with TradingView chart lines using intelligent line assignment
   * @param {number} configId - Configuration ID
   * @param {Object} configData - Full configuration data including trade_amount
   */
  updateBotWithChartLines(configId, configData) {
    console.log(`🤖 TradingService: updateBotWithChartLines called for config ${configId}`);
    console.log(`🤖 Config data:`, configData);
    console.log(`🤖 Trade amount:`, configData.trade_amount);
    
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.warn(`TradingService: No bot found for config ${configId}`);
      return;
    }

    // Update bot configuration with trade_amount
    if (configData.trade_amount) {
      bot.updateConfig({
        positionSize: configData.trade_amount
      });
      console.log(`💰 TradingService: Updated bot ${configId} position size to $${configData.trade_amount} (from config trade_amount)`);
    } else {
      console.log(`⚠️ TradingService: No trade_amount found in config ${configId}, using default`);
    }

    // Clear existing lines
    bot.allLines = [];
    bot.entryLine = null;
    bot.exitLines = [];

    // Collect all line data for intelligent assignment
    const allLinesData = [];

    // Skip the separate entry_line - we'll use the drawn lines instead
    // The entry line should be one of the user-drawn lines, not a separate backend entry_line

    // Simple approach: Use whatever drawings are available
    let drawings = [];
    
    if (configData.layout_data?.other_drawings?.active_shapes) {
      drawings = configData.layout_data.other_drawings.active_shapes;
      console.log(`TradingService: Using active_shapes - ${drawings.length} shapes`);
    } else if (configData.layout_data?.other_drawings?.tradingview_drawings) {
      drawings = configData.layout_data.other_drawings.tradingview_drawings;
      console.log(`TradingService: Using tradingview_drawings - ${drawings.length} drawings`);
    } else {
      console.log(`TradingService: No drawings found in layout_data`);
    }
    
    if (drawings.length > 0) {
      
      console.log(`TradingService: Processing ${drawings.length} drawings from TradingView`);
      console.log(`TradingService: Drawing IDs:`, drawings.map(d => d.id || 'unnamed'));
      console.log(`TradingService: Drawing types:`, drawings.map(d => d.type || 'no-type'));
      console.log(`TradingService: Full drawing data:`, drawings.map(d => ({
        id: d.id,
        type: d.type,
        shape: d.shape,
        name: d.name,
        points: d.points ? d.points.length : 'no-points'
      })));
      
      // Filter out duplicate drawings by ID to prevent accumulation
      const uniqueDrawings = [];
      const seenIds = new Set();
      
      drawings.forEach((drawing, index) => {
        const drawingId = drawing.id || `drawing_${index}`;
        
        if (seenIds.has(drawingId)) {
          console.log(`TradingService: Skipping duplicate drawing: ${drawingId}`);
          return;
        }
        
        seenIds.add(drawingId);
        uniqueDrawings.push(drawing);
      });
      
      console.log(`TradingService: After deduplication: ${uniqueDrawings.length} unique drawings`);
      
      uniqueDrawings.forEach((drawing, index) => {
        // Only process actual trend lines that were drawn by the user
        const isUserDrawnTrendLine = (
          drawing.type === 'trend_line' || 
          drawing.shape === 'trend_line' || 
          drawing.name === 'trend_line' ||
          drawing.type === 'LineToolTrendLine'
        ) && drawing.points && drawing.points.length >= 2;
        
        if (isUserDrawnTrendLine) {
          console.log(`TradingService: Found user-drawn trend line ${index + 1}: ${drawing.id || 'unnamed'} (type: ${drawing.type})`);
          allLinesData.push({
            id: drawing.id || `line_${allLinesData.length}`,
            is_entry_line: false, // Will be assigned intelligently below
            points: drawing.points
          });
        } else {
          console.log(`TradingService: Skipping non-trend-line drawing ${index + 1}: ${drawing.type || 'unknown'} (${drawing.id || 'unnamed'})`);
        }
      });
    } else {
      console.log(`TradingService: No drawings found in layout_data`);
    }

    console.log(`TradingService: Found ${allLinesData.length} lines for intelligent assignment`);

    if (allLinesData.length > 0) {
      // Intelligently assign entry vs exit lines based on price levels
      // Lowest line = entry line, higher lines = exit lines
      allLinesData.sort((a, b) => {
        const priceA = Math.min(a.points[0].price, a.points[1].price);
        const priceB = Math.min(b.points[0].price, b.points[1].price);
        return priceA - priceB; // Sort by lowest price first
      });
      
      // Assign first (lowest) line as entry, rest as exits
      allLinesData.forEach((lineData, index) => {
        if (index === 0) {
          lineData.is_entry_line = true;
          console.log(`TradingService: Assigned entry line: ${lineData.id} (price: ${Math.min(lineData.points[0].price, lineData.points[1].price).toFixed(2)})`);
        } else {
          lineData.is_entry_line = false;
          console.log(`TradingService: Assigned exit line: ${lineData.id} (price: ${Math.min(lineData.points[0].price, lineData.points[1].price).toFixed(2)})`);
        }
      });
      
      console.log(`TradingService: Final line assignment - Total lines: ${allLinesData.length}`);
      console.log(`TradingService: Entry lines: ${allLinesData.filter(l => l.is_entry_line).length}`);
      console.log(`TradingService: Exit lines: ${allLinesData.filter(l => !l.is_entry_line).length}`);
      
      // Use intelligent line assignment based on direction and market context
      bot.assignLinesIntelligently(allLinesData);
      console.log(`TradingService: Intelligently assigned lines for config ${configId} - Entry: ${bot.entryLine?.id || 'none'}, Exits: ${bot.exitLines.length}`);
    } else {
      console.warn(`TradingService: No lines found in layoutData for config ${configId}`);
    }

    // Redistribute shares if bot is running
    if (bot.isRunning) {
      bot.distributeTargetShares();
    }
  }

  /**
   * Start trading for a configuration
   * @param {number} configId - Configuration ID
   */
  startTrading(configId) {
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.error(`TradingService: No bot found for config ${configId}`);
      return false;
    }

    if (bot.isRunning) {
      console.warn(`TradingService: Bot ${configId} is already running`);
      return true;
    }

    bot.start();
    this.onBotStatusChange(configId, 'started', bot.getStatus());
    console.log(`TradingService: Started trading for config ${configId}`);
    return true;
  }

  /**
   * Stop trading for a configuration
   * @param {number} configId - Configuration ID
   */
  stopTrading(configId) {
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.error(`TradingService: No bot found for config ${configId}`);
      return false;
    }

    bot.stop();
    this.onBotStatusChange(configId, 'stopped', bot.getStatus());
    console.log(`TradingService: Stopped trading for config ${configId}`);
    return true;
  }

  /**
   * Emergency stop for a configuration
   * @param {number} configId - Configuration ID
   */
  emergencyStop(configId) {
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.error(`TradingService: No bot found for config ${configId}`);
      return false;
    }

    bot.emergencyStop();
    this.onBotStatusChange(configId, 'emergency_stop', bot.getStatus());
    console.log(`TradingService: Emergency stop for config ${configId}`);
    return true;
  }

  /**
   * Get bot status for a configuration
   * @param {number} configId - Configuration ID
   * @returns {Object} Bot status
   */
  getBotStatus(configId) {
    const bot = this.activeBots.get(configId);
    if (!bot) {
      return null;
    }
    return bot.getStatus();
  }

  /**
   * Get all active bot statuses
   * @returns {Object} Map of configId -> bot status
   */
  getAllBotStatuses() {
    const statuses = {};
    this.activeBots.forEach((bot, configId) => {
      statuses[configId] = bot.getStatus();
    });
    return statuses;
  }

  /**
   * Remove bot for a configuration
   * @param {number} configId - Configuration ID
   */
  removeBot(configId) {
    const bot = this.activeBots.get(configId);
    if (bot) {
      bot.stop();
      this.activeBots.delete(configId);
      console.log(`TradingService: Removed bot for config ${configId}`);
    }
  }

  /**
   * Handle order placed event
   * @param {number} configId - Configuration ID
   * @param {Object} order - Order data
   */
  handleOrderPlaced(configId, order) {
    console.log(`TradingService: Order placed for config ${configId}:`, order);
    this.onOrderUpdate(configId, 'placed', order);
  }

  /**
   * Handle order filled event
   * @param {number} configId - Configuration ID
   * @param {Object} orderData - Order data
   */
  handleOrderFilled(configId, orderData) {
    console.log(`TradingService: Order filled for config ${configId}:`, orderData);
    this.onOrderUpdate(configId, 'filled', orderData);
  }

  /**
   * Handle stop-out event
   * @param {number} configId - Configuration ID
   * @param {string} reason - Stop-out reason
   */
  handleStopOut(configId, reason) {
    console.log(`TradingService: Stop-out for config ${configId}: ${reason}`);
    this.onBotStatusChange(configId, 'stopped_out', { reason });
  }

  /**
   * Handle error event
   * @param {number} configId - Configuration ID
   * @param {string} error - Error message
   */
  handleError(configId, error) {
    console.error(`TradingService: Error for config ${configId}:`, error);
    this.onError(configId, error);
  }

  /**
   * Process real-time market data update
   * @param {number} configId - Configuration ID
   * @param {Object} marketData - Market data
   */
  processMarketData(configId, marketData) {
    console.log(`🚀 TradingService: processMarketData called for config ${configId} with price ${marketData.price}`);
    console.log(`📊 Market data:`, marketData);
    
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.warn(`❌ TradingService: No bot found for config ${configId} when processing market data`);
      console.log(`🔍 Available bots:`, Array.from(this.activeBots.keys()));
      return;
    }
    
    if (!bot.isRunning) {
      console.log(`TradingService: Bot for config ${configId} is not running, skipping price update`);
      return;
    }

    console.log(`TradingService: Bot ${configId} is running, processing price update...`);

    // Update bot with current market price
    console.log(`TradingService: Updating bot ${configId} with real-time price ${marketData.price.toFixed(4)}`);
    
    // Validate that the price is reasonable
    if (marketData.price && marketData.price > 0 && marketData.price < 100000) {
      const oldPrice = bot.currentPrice;
      bot.currentPrice = marketData.price;
      console.log(`TradingService: Price updated from ${oldPrice.toFixed(4)} to ${bot.currentPrice.toFixed(4)}`);
    } else {
      console.warn(`TradingService: Invalid real-time price received: ${marketData.price}`);
    }
    
    // Add timestamp and price to price history for market context
    if (bot.updateMarketContext) {
      bot.updateMarketContext(marketData.price);
    }
    
    bot.update();
  }

  /**
   * Get trading statistics for a configuration
   * @param {number} configId - Configuration ID
   * @returns {Object} Trading statistics
   */
  getTradingStats(configId) {
    const bot = this.activeBots.get(configId);
    if (!bot) {
      return null;
    }

    const status = bot.getStatus();
    return {
      configId,
      totalPosition: status.totalPosition,
      currentPrice: status.currentPrice,
      entryPrice: status.entryPrice,
      distanceFromEntry: status.distanceFromEntry,
      isActive: status.isActive,
      stoppedOut: status.stoppedOut,
      emergencyBrake: status.emergencyBrake,
      totalOrders: status.entryLine?.filledOrders?.length + 
                   status.exitLines?.reduce((sum, line) => sum + line.filledOrders?.length, 0) || 0,
      totalFilled: status.entryLine?.totalFilled + 
                   status.exitLines?.reduce((sum, line) => sum + line.totalFilled, 0) || 0
    };
  }

  /**
   * Enable or disable browser alerts for price crossings
   * @param {number} configId - Configuration ID
   * @param {boolean} enabled - Whether to enable alerts
   */
  setAlertsEnabled(configId, enabled) {
    const bot = this.activeBots.get(configId);
    if (bot) {
      bot.setAlertsEnabled(enabled);
    } else {
      console.warn(`TradingService: No bot found for config ${configId}`);
    }
  }

  /**
   * Get crossing events for a configuration
   * @param {number} configId - Configuration ID
   * @returns {Array} Array of crossing events
   */
  getCrossingEvents(configId) {
    const bot = this.activeBots.get(configId);
    if (bot) {
      return bot.getCrossingEvents();
    } else {
      console.warn(`TradingService: No bot found for config ${configId}`);
      return [];
    }
  }

  /**
   * Clear crossing events for a configuration
   * @param {number} configId - Configuration ID
   */
  clearCrossingEvents(configId) {
    const bot = this.activeBots.get(configId);
    if (bot) {
      bot.clearCrossingEvents();
    } else {
      console.warn(`TradingService: No bot found for config ${configId}`);
    }
  }

  /**
   * Test price crossing detection for a configuration
   * @param {number} configId - Configuration ID
   */
  testPriceCrossing(configId) {
    const bot = this.activeBots.get(configId);
    if (bot) {
      bot.testPriceCrossing();
    } else {
      console.warn(`TradingService: No bot found for config ${configId}`);
    }
  }

  /**
   * Get the current active config ID (if only one bot is running)
   * @returns {number|null} The active config ID or null if none/multiple
   */
  getCurrentActiveConfigId() {
    const activeBots = Array.from(this.activeBots.entries()).filter(([id, bot]) => bot.isRunning);
    
    if (activeBots.length === 1) {
      return activeBots[0][0]; // Return the config ID
    } else if (activeBots.length === 0) {
      console.log(`TradingService: No active bots found`);
      return null;
    } else {
      console.log(`TradingService: Multiple active bots found:`, activeBots.map(([id, bot]) => id));
      return null;
    }
  }
}

// Create singleton instance
const tradingService = new TradingService();

export default tradingService;
