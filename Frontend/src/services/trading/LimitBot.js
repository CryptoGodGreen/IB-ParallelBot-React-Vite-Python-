import LimitLine from './LimitLine.js';

/**
 * LimitBot class manages the overall limit-order ladder trading strategy
 * Handles order distribution, safety checks, and state management
 */
export class LimitBot {
  constructor(config = {}) {
    this.id = config.id || this.generateId();
    this.name = config.name || 'LimitBot';
    this.symbol = config.symbol || 'AAPL';
    this.isActive = false;
    this.isRunning = false;
    
    // Lines management
    this.entryLine = null;
    this.exitLines = []; // Array of LimitLine objects, sorted by rank
    this.allLines = []; // All lines for easy access
    
    // Position management
    this.totalPosition = 0;
    this.maxPosition = config.maxPosition || 10000;
    this.positionSize = config.positionSize || 1000;
    
    // State flags
    this.stoppedOut = false;
    this.marketedOut = false;
    this.emergencyBrake = false;
    
    // Safety checks
    this.maxDistanceFromEntry = config.maxDistanceFromEntry || 0.05; // 5%
    this.currentPrice = 0;
    this.entryPrice = 0;
    this.distanceFromEntry = 0;
    
    // Stop-out rules (timeframe-based)
    this.stopOutRules = {
      fiveMinute: {
        enabled: config.fiveMinuteStopLoss || false,
        threshold: config.fiveMinuteStopLossThreshold || 0.02, // 2%
        hardStop: config.fiveMinuteHardStop || false
      },
      fifteenMinute: {
        enabled: config.fifteenMinuteStopLoss || false,
        threshold: config.fifteenMinuteStopLossThreshold || 0.03, // 3%
        hardStop: config.fifteenMinuteHardStop || false
      },
      oneHour: {
        enabled: config.oneHourStopLoss || false,
        threshold: config.oneHourStopLossThreshold || 0.05, // 5%
        hardStop: config.oneHourHardStop || false
      }
    };
    
    // Timing
    this.startTime = null;
    this.lastUpdateTime = null;
    this.updateInterval = config.updateInterval || 1000; // 1 second
    
    // Event callbacks
    this.onOrderPlaced = config.onOrderPlaced || (() => {});
    this.onOrderFilled = config.onOrderFilled || (() => {});
    this.onStopOut = config.onStopOut || (() => {});
    this.onError = config.onError || (() => {});
    
    console.log(`LimitBot ${this.id}: Initialized for ${this.symbol}`);
  }

  generateId() {
    return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set the entry line from TradingView data
   * @param {Object} lineData - TradingView line data
   */
  setEntryLine(lineData) {
    this.entryLine = new LimitLine({
      id: lineData.id || 'entry_line',
      type: 'entry',
      points: lineData.points,
      orderSize: this.positionSize,
      maxOrderSize: this.maxPosition
    });
    
    this.allLines.push(this.entryLine);
    console.log(`LimitBot ${this.id}: Entry line set`);
  }

  /**
   * Add an exit line from TradingView data
   * @param {Object} lineData - TradingView line data
   * @param {number} rank - Exit line rank (priority)
   */
  addExitLine(lineData, rank = 1) {
    const exitLine = new LimitLine({
      id: lineData.id || `exit_line_${rank}`,
      type: 'exit',
      rank: rank,
      points: lineData.points,
      orderSize: 0, // Will be calculated by distribute_target_shares
      maxOrderSize: this.maxPosition
    });
    
    this.exitLines.push(exitLine);
    this.allLines.push(exitLine);
    
    // Sort exit lines by rank
    this.exitLines.sort((a, b) => a.rank - b.rank);
    
    console.log(`LimitBot ${this.id}: Exit line ${rank} added`);
  }

  /**
   * Distribute target shares across exit lines
   * Creates laddered exits with different order sizes
   */
  distributeTargetShares() {
    if (this.exitLines.length === 0) {
      console.warn(`LimitBot ${this.id}: No exit lines to distribute shares`);
      return;
    }

    const totalShares = this.positionSize;
    const numExitLines = this.exitLines.length;
    
    // Calculate distribution weights (higher rank = smaller portion)
    const weights = this.exitLines.map((line, index) => {
      // First exit line gets largest portion, subsequent lines get smaller portions
      return Math.pow(0.7, index); // 70% of previous line's size
    });
    
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    
    // Distribute shares
    this.exitLines.forEach((line, index) => {
      const shareRatio = weights[index] / totalWeight;
      const targetShares = Math.floor(totalShares * shareRatio);
      
      line.orderSize = Math.max(line.minOrderSize, targetShares);
      line.maxOrderSize = Math.min(line.maxOrderSize, targetShares * 2);
      
      console.log(`LimitBot ${this.id}: Exit line ${line.rank} allocated ${line.orderSize} shares`);
    });
  }

  /**
   * Start the trading bot
   */
  start() {
    if (this.isRunning) {
      console.warn(`LimitBot ${this.id}: Already running`);
      return;
    }

    if (!this.entryLine) {
      console.error(`LimitBot ${this.id}: Cannot start without entry line`);
      this.onError('No entry line configured');
      return;
    }

    if (this.exitLines.length === 0) {
      console.warn(`LimitBot ${this.id}: No exit lines configured`);
    }

    this.isActive = true;
    this.isRunning = true;
    this.startTime = Date.now();
    this.stoppedOut = false;
    this.marketedOut = false;
    this.emergencyBrake = false;

    // Distribute shares across exit lines
    this.distributeTargetShares();

    console.log(`LimitBot ${this.id}: Started trading`);
    this.startUpdateLoop();
  }

  /**
   * Stop the trading bot
   */
  stop() {
    this.isActive = false;
    this.isRunning = false;
    
    // Cancel all pending orders
    this.allLines.forEach(line => {
      line.cancelPendingOrders();
    });
    
    console.log(`LimitBot ${this.id}: Stopped trading`);
  }

  /**
   * Emergency stop - cancels all orders and stops trading
   */
  emergencyStop() {
    this.emergencyBrake = true;
    this.stop();
    
    // Deactivate all lines
    this.allLines.forEach(line => {
      line.deactivate();
    });
    
    console.log(`LimitBot ${this.id}: EMERGENCY STOP activated`);
  }

  /**
   * Start the main update loop
   */
  startUpdateLoop() {
    if (!this.isRunning) return;

    this.update();
    
    setTimeout(() => {
      this.startUpdateLoop();
    }, this.updateInterval);
  }

  /**
   * Main update method - evaluates lines and manages orders
   */
  update() {
    if (!this.isActive || this.emergencyBrake) return;

    try {
      const currentTime = Date.now();
      const currentCandleIndex = this.getCurrentCandleIndex();
      
      // Update current price (this would come from market data feed)
      this.updateCurrentPrice();
      
      // Run safety checks
      if (!this.runSafetyChecks()) {
        return;
      }
      
      // Update all lines with current candle index
      this.allLines.forEach(line => {
        line.updateOrders(currentCandleIndex);
      });
      
      // Manage entry orders
      this.manageEntryOrders();
      
      // Manage exit orders
      this.manageExitOrders();
      
      this.lastUpdateTime = currentTime;
      
    } catch (error) {
      console.error(`LimitBot ${this.id}: Update error:`, error);
      this.onError(error.message);
    }
  }

  /**
   * Update current market price (placeholder - would integrate with market data)
   */
  updateCurrentPrice() {
    // This would integrate with real market data
    // For now, use entry line price as reference
    if (this.entryLine) {
      const currentCandleIndex = this.getCurrentCandleIndex();
      this.currentPrice = this.entryLine.calculateCurrentPrice(currentCandleIndex);
    }
  }

  /**
   * Get current candle index
   * @returns {number} Current candle index
   */
  getCurrentCandleIndex() {
    const now = Date.now();
    const marketOpen = new Date().setHours(9, 30, 0, 0); // 9:30 AM EST
    return Math.floor((now - marketOpen) / 60000); // 1-minute candles
  }

  /**
   * Run safety checks before placing orders
   * @returns {boolean} True if safe to trade, false otherwise
   */
  runSafetyChecks() {
    // Check distance from entry line
    if (this.entryLine && this.currentPrice > 0) {
      this.entryPrice = this.entryLine.currentPrice;
      this.distanceFromEntry = Math.abs(this.currentPrice - this.entryPrice) / this.entryPrice;
      
      if (this.distanceFromEntry > this.maxDistanceFromEntry) {
        console.warn(`LimitBot ${this.id}: Price too far from entry line (${(this.distanceFromEntry * 100).toFixed(2)}%)`);
        return false;
      }
    }
    
    // Check stop-out rules
    if (this.checkStopOutRules()) {
      return false;
    }
    
    return true;
  }

  /**
   * Check timeframe-based stop-out rules
   * @returns {boolean} True if stopped out
   */
  checkStopOutRules() {
    if (!this.startTime) return false;
    
    const elapsedTime = Date.now() - this.startTime;
    const elapsedMinutes = elapsedTime / (1000 * 60);
    
    // Check 5-minute rule
    if (elapsedMinutes >= 5 && this.stopOutRules.fiveMinute.enabled) {
      if (this.distanceFromEntry > this.stopOutRules.fiveMinute.threshold) {
        console.log(`LimitBot ${this.id}: 5-minute stop-out triggered`);
        this.triggerStopOut('five_minute');
        return true;
      }
    }
    
    // Check 15-minute rule
    if (elapsedMinutes >= 15 && this.stopOutRules.fifteenMinute.enabled) {
      if (this.distanceFromEntry > this.stopOutRules.fifteenMinute.threshold) {
        console.log(`LimitBot ${this.id}: 15-minute stop-out triggered`);
        this.triggerStopOut('fifteen_minute');
        return true;
      }
    }
    
    // Check 1-hour rule
    if (elapsedMinutes >= 60 && this.stopOutRules.oneHour.enabled) {
      if (this.distanceFromEntry > this.stopOutRules.oneHour.threshold) {
        console.log(`LimitBot ${this.id}: 1-hour stop-out triggered`);
        this.triggerStopOut('one_hour');
        return true;
      }
    }
    
    return false;
  }

  /**
   * Trigger stop-out
   * @param {string} reason - Stop-out reason
   */
  triggerStopOut(reason) {
    this.stoppedOut = true;
    this.isActive = false;
    
    // Cancel all pending orders
    this.allLines.forEach(line => {
      line.cancelPendingOrders();
    });
    
    this.onStopOut(reason);
    console.log(`LimitBot ${this.id}: Stop-out triggered - ${reason}`);
  }

  /**
   * Manage entry orders
   */
  manageEntryOrders() {
    if (!this.entryLine || this.totalPosition >= this.maxPosition) return;
    
    const entryPrice = this.entryLine.currentPrice;
    const priceDiff = Math.abs(this.currentPrice - entryPrice);
    const priceDiffPercent = (priceDiff / entryPrice) * 100;
    
    // Place entry order if price is close to entry line
    if (priceDiffPercent < 0.1 && this.entryLine.pendingOrders.length === 0) {
      const order = this.entryLine.placeOrder(this.positionSize, 'buy');
      if (order) {
        this.onOrderPlaced(order);
      }
    }
  }

  /**
   * Manage exit orders
   */
  manageExitOrders() {
    if (this.exitLines.length === 0) return;
    
    this.exitLines.forEach(exitLine => {
      const exitPrice = exitLine.currentPrice;
      const priceDiff = Math.abs(this.currentPrice - exitPrice);
      const priceDiffPercent = (priceDiff / exitPrice) * 100;
      
      // Place exit order if price is close to exit line
      if (priceDiffPercent < 0.1 && exitLine.pendingOrders.length === 0) {
        const order = exitLine.placeOrder(exitLine.orderSize, 'sell');
        if (order) {
          this.onOrderPlaced(order);
        }
      }
    });
  }

  /**
   * Handle order fill
   * @param {string} orderId - Order ID
   * @param {string} lineId - Line ID
   */
  handleOrderFill(orderId, lineId) {
    const line = this.allLines.find(l => l.id === lineId);
    if (line) {
      line.fillOrder(orderId);
      
      if (line.type === 'entry') {
        this.totalPosition += line.filledOrders.find(o => o.id === orderId)?.size || 0;
      } else if (line.type === 'exit') {
        this.totalPosition -= line.filledOrders.find(o => o.id === orderId)?.size || 0;
      }
      
      this.onOrderFilled({ orderId, lineId, lineType: line.type });
    }
  }

  /**
   * Get bot status
   * @returns {Object} Bot status
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      symbol: this.symbol,
      isActive: this.isActive,
      isRunning: this.isRunning,
      stoppedOut: this.stoppedOut,
      marketedOut: this.marketedOut,
      emergencyBrake: this.emergencyBrake,
      totalPosition: this.totalPosition,
      currentPrice: this.currentPrice,
      entryPrice: this.entryPrice,
      distanceFromEntry: this.distanceFromEntry,
      entryLine: this.entryLine?.getStatus(),
      exitLines: this.exitLines.map(line => line.getStatus()),
      startTime: this.startTime,
      lastUpdateTime: this.lastUpdateTime
    };
  }

  /**
   * Update bot configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    Object.assign(this, newConfig);
    console.log(`LimitBot ${this.id}: Configuration updated`);
  }
}

export default LimitBot;
