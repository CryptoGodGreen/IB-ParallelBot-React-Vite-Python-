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
      positionSize: botConfig.position_size || 1000,
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
   * @param {Object} layoutData - TradingView layout data
   */
  updateBotWithChartLines(configId, layoutData) {
    console.log(`🤖 TradingService: updateBotWithChartLines called for config ${configId}`);
    console.log(`🤖 Layout data:`, layoutData);
    console.log(`🤖 Entry line:`, layoutData?.entry_line);
    console.log(`🤖 Exit line:`, layoutData?.exit_line);
    
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.warn(`TradingService: No bot found for config ${configId}`);
      return;
    }

    // Clear existing lines
    bot.allLines = [];
    bot.entryLine = null;
    bot.exitLines = [];

    // Collect all line data for intelligent assignment
    const allLinesData = [];

    // Add entry line if provided - mark it explicitly as entry line for old Ruby system
    if (layoutData.entry_line && layoutData.entry_line.p1 && layoutData.entry_line.p2) {
      allLinesData.push({
        id: 'entry_line',
        is_entry_line: true, // Explicitly mark as entry line for old Ruby system logic
        points: [
          { time: layoutData.entry_line.p1.time, price: layoutData.entry_line.p1.price },
          { time: layoutData.entry_line.p2.time, price: layoutData.entry_line.p2.price }
        ]
      });
    }

    // Add all drawings from TradingView
    if (layoutData.other_drawings && layoutData.other_drawings.tradingview_drawings) {
      const drawings = layoutData.other_drawings.tradingview_drawings;
      
      drawings.forEach(drawing => {
        // Check if it's a trend line with sufficient points
        const isTrendLine = drawing.type === 'trend_line' || 
                           drawing.shape === 'trend_line' || 
                           drawing.name === 'trend_line' ||
                           drawing.type === 'LineToolTrendLine' ||
                           (drawing.points && drawing.points.length >= 2);
        
        if (isTrendLine && drawing.points && drawing.points.length >= 2) {
          allLinesData.push({
            id: drawing.id || `line_${allLinesData.length}`,
            is_entry_line: false, // Mark all other lines as exit lines for old Ruby system
            points: drawing.points
          });
        }
      });
    }

    console.log(`TradingService: Found ${allLinesData.length} lines for intelligent assignment`);

    if (allLinesData.length > 0) {
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
    const bot = this.activeBots.get(configId);
    if (!bot) {
      console.warn(`TradingService: No bot found for config ${configId} when processing market data`);
      return;
    }
    
    if (!bot.isRunning) {
      console.log(`TradingService: Bot for config ${configId} is not running, skipping price update`);
      return;
    }

    // Update bot with current market price
    console.log(`TradingService: Updating bot ${configId} with real-time price ${marketData.price.toFixed(4)}`);
    
    // Validate that the price is reasonable
    if (marketData.price && marketData.price > 0 && marketData.price < 100000) {
      bot.currentPrice = marketData.price;
      console.log(`TradingService: Price validated and set to ${bot.currentPrice.toFixed(4)}`);
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
}

// Create singleton instance
const tradingService = new TradingService();

export default tradingService;
