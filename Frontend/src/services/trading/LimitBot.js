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
    this.chartSide = config.chartSide || 'B'; // 'B' for buy, 'S' for sell
    
    // Lines management - matching old Ruby system
    this.entryLines = []; // Array of entry LimitLine objects (multiple entry lines supported)
    this.exitLines = []; // Array of exit LimitLine objects, sorted by rank
    this.allLines = []; // All lines for easy access
    this.entryLine = null; // Keep for backward compatibility
    
    // Position management - matching old Ruby system
    this.totalPosition = 0;
    this.sharesEntered = 0; // Total shares filled on entry lines
    this.sharesExited = 0;  // Total shares filled on exit lines
    this.marketSharesExited = 0; // Emergency market order exits
    this.openShares = 0;    // Calculated: sharesEntered - (sharesExited + marketSharesExited)
    this.maxPosition = config.maxPosition || 10000;
    this.positionSize = config.positionSize || 1000;
    
    // State flags
    this.stoppedOut = false;
    this.marketedOut = false;
    this.emergencyBrake = false;
    this.isStarted = false;
    this.isStopped = false;
    
    // Safety checks
    this.maxDistanceFromEntry = config.maxDistanceFromEntry || 0.05; // 5%
    this.currentPrice = 0;
    this.entryPrice = 0;
    this.distanceFromEntry = 0;
    
    // Market context and price history for trend detection
    this.priceHistory = [];
    this.maxPriceHistory = 20; // Keep last 20 prices for trend analysis
    this.marketContext = 'neutral'; // 'bullish', 'bearish', or 'neutral'
    this.trendStrength = 0; // -1 to 1, where 1 is very bullish, -1 is very bearish
    
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
    
    // Stop-out tracking - matching old Ruby system
    this.timeEnteredStopoutZone = null;
    this.timeEnteredHardStopoutZone = null;
    this.calculatedSecondsLeftInStopout = -1;
    this.lastCalculatedPercentFromEntryLine = 0;
    
    // Stop-out configuration - matching old Ruby system
    this.chartRight = config.chartRight || 'C'; // 'C' for call, 'P' for put
    this.stopOutPercent = config.stopOutPercent || null;
    this.stopOutTimeLimit = config.stopOutTimeLimit || null; // in minutes
    this.hardStopOut = config.hardStopOut || null; // percentage threshold
    
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
   * Update price history and detect market context
   * @param {number} price - Current price
   */
  updateMarketContext(price) {
    // Add current price to history
    this.priceHistory.push({
      price: price,
      timestamp: Date.now()
    });
    
    // Keep only recent prices
    if (this.priceHistory.length > this.maxPriceHistory) {
      this.priceHistory.shift();
    }
    
    // Need at least 3 prices to determine trend
    if (this.priceHistory.length >= 3) {
      this.detectMarketTrend();
    }
  }

  /**
   * Detect market trend from price history
   */
  detectMarketTrend() {
    if (this.priceHistory.length < 3) return;

    const prices = this.priceHistory.map(p => p.price);
    const recentPrices = prices.slice(-5); // Last 5 prices
    const olderPrices = prices.slice(0, -5); // Earlier prices
    
    if (recentPrices.length === 5 && olderPrices.length > 0) {
      const recentAvg = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
      const olderAvg = olderPrices.reduce((sum, p) => sum + p, 0) / olderPrices.length;
      
      // Calculate trend strength (-1 to 1)
      const priceChange = (recentAvg - olderAvg) / olderAvg;
      this.trendStrength = Math.max(-1, Math.min(1, priceChange * 10)); // Scale factor
      
      // Determine market context
      if (this.trendStrength > 0.1) {
        this.marketContext = 'bullish';
      } else if (this.trendStrength < -0.1) {
        this.marketContext = 'bearish';
      } else {
        this.marketContext = 'neutral';
      }
      
      console.log(`LimitBot ${this.id}: Market context: ${this.marketContext}, trend strength: ${this.trendStrength.toFixed(3)}`);
    }
  }

  /**
   * Set lines using simple boolean assignment like old Ruby system
   * @param {Array} allLinesData - Array of line data from TradingView
   */
  assignLinesIntelligently(allLinesData) {
    if (!allLinesData || allLinesData.length === 0) {
      console.warn(`LimitBot ${this.id}: No lines to assign`);
      return;
    }

    console.log(`LimitBot ${this.id}: Setting ${allLinesData.length} lines using old Ruby logic`);

    // Clear existing lines
    this.entryLines = [];
    this.exitLines = [];
    this.allLines = [];
    this.entryLine = null;

    // Create LimitLine objects and determine entry/exit based on data structure
    allLinesData.forEach((lineData, index) => {
      const line = new LimitLine({
        id: lineData.id || `line_${index}`,
        points: lineData.points,
        orderSize: this.positionSize,
        maxOrderSize: this.maxPosition,
        chartSide: this.chartSide
      });

      // Use the is_entry_line flag from the data (matching old Ruby system's boolean logic)
      const isEntryLine = lineData.is_entry_line === true;
      
      if (isEntryLine) {
        line.type = 'entry';
        line.isEntryLine = true;
        this.entryLines.push(line);
        this.allLines.push(line);
        
        // Set first entry line as primary entryLine for backward compatibility
        if (!this.entryLine) {
          this.entryLine = line;
        }
        
        console.log(`LimitBot ${this.id}: Entry line ${this.entryLines.length}: ${line.id} (price: ${line.points?.[0]?.price?.toFixed(2) || 'unknown'})`);
      } else {
        line.type = 'exit';
        line.isEntryLine = false;
        line.rank = this.exitLines.length + 1;
        this.exitLines.push(line);
        this.allLines.push(line);
        
        console.log(`LimitBot ${this.id}: Exit line ${line.rank}: ${line.id} (price: ${line.points?.[0]?.price?.toFixed(2) || 'unknown'})`);
      }
    });

    // Sort lines by rank (entry lines first, then exit lines)
    this.entryLines.sort((a, b) => a.rank - b.rank);
    this.exitLines.sort((a, b) => a.rank - b.rank);

    console.log(`LimitBot ${this.id}: Lines assigned - Entry: ${this.entryLines.length}, Exit: ${this.exitLines.length}`);
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
      maxOrderSize: this.maxPosition,
      chartSide: this.chartSide,
      isEntryLine: true
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
      maxOrderSize: this.maxPosition,
      chartSide: this.chartSide,
      isEntryLine: false
    });
    
    this.exitLines.push(exitLine);
    this.allLines.push(exitLine);
    
    // Sort exit lines by rank
    this.exitLines.sort((a, b) => a.rank - b.rank);
    
    console.log(`LimitBot ${this.id}: Exit line ${rank} added`);
  }

  /**
   * Distribute target shares across exit lines - Exact match to old Ruby logic
   * This matches the distribute_target_shares method from limit_bot.rb
   */
  distributeTargetShares() {
    // Set target shares for entry lines first
    this.entryLines.forEach(entryLine => {
      entryLine.targetShares = this.positionSize; // Each entry line can take the full position
      entryLine.orderSize = this.positionSize;
      console.log(`💰 LimitBot ${this.id}: Entry line allocated $${entryLine.targetShares} (trade amount from config)`);
    });

    if (this.exitLines.length === 0) {
      console.warn(`LimitBot ${this.id}: No exit lines to distribute shares`);
      return;
    }

    // Get exit lines sorted by rank (matching old Ruby system)
    const tmpLines = [...this.exitLines].sort((a, b) => a.rank - b.rank);
    
    // Reset all exit line target shares to 0 (matching old logic)
    tmpLines.forEach(exitLine => {
      exitLine.targetShares = 0;
    });
    
    // Reverse order if chart side is 'B' (buy side) - matching old logic line 294
    if (this.chartSide === 'B') {
      tmpLines.reverse();
    }
    
    // Get total shares entered (matching old logic line 295)
    this.updatePositionCounts();
    const sharesToDistribute = this.sharesEntered;
    
    console.log(`💰 LimitBot ${this.id}: Distributing $${sharesToDistribute} across ${tmpLines.length} exit lines`);
    
    // Distribute shares one by one in round-robin fashion (matching old logic lines 296-305)
    let sharesLeft = sharesToDistribute;
    while (sharesLeft > 0) {
      let distributed = false;
      tmpLines.forEach(exitLine => {
        if (sharesLeft > 0) {
          exitLine.targetShares += 1;
          sharesLeft -= 1;
          distributed = true;
        }
      });
      if (!distributed) break; // Prevent infinite loop
    }
    
    // Update order sizes based on target shares
    tmpLines.forEach(exitLine => {
      exitLine.orderSize = exitLine.targetShares;
      console.log(`LimitBot ${this.id}: Exit line ${exitLine.rank} allocated ${exitLine.targetShares} shares`);
    });
    
    console.log(`LimitBot ${this.id}: Share distribution complete`);
  }

  /**
   * Get entry lines - matching old Ruby logic (lines 61-67)
   * @returns {Array} Entry lines in correct order based on chart side
   */
  getEntryLines() {
    if (this.chartSide === 'B') {
      return [...this.entryLines].sort((a, b) => a.rank - b.rank);
    } else {
      return [...this.entryLines].sort((a, b) => b.rank - a.rank);
    }
  }

  /**
   * Get exit lines - matching old Ruby logic (line 70)
   * @returns {Array} Exit lines
   */
  getExitLines() {
    return [...this.exitLines].sort((a, b) => a.rank - b.rank);
  }

  /**
   * Get current active entry line - matching old Ruby logic (lines 308-317)
   * @returns {LimitLine|null} Current active entry line
   */
  getCurrentEntryLine() {
    const entryLines = this.getEntryLines();
    for (const entryLine of entryLines) {
      if (entryLine.isActiveLine()) {
        return entryLine;
      }
    }
    return null;
  }

  /**
   * Get current active exit line - matching old Ruby logic (lines 319-328)
   * @returns {LimitLine|null} Current active exit line
   */
  getCurrentExitLine() {
    const exitLines = this.getExitLines();
    const sortedLines = this.chartSide === 'S' ? exitLines.reverse() : exitLines;
    
    for (const exitLine of sortedLines) {
      if (exitLine.isActiveLine()) {
        return exitLine;
      }
    }
    return null;
  }

  /**
   * Update position counts - matching old Ruby logic (lines 102-116)
   */
  updatePositionCounts() {
    // Calculate shares entered from all entry lines
    this.sharesEntered = this.entryLines.reduce((total, line) => {
      return total + (line.sharesFilled() || 0);
    }, 0);

    // Calculate shares exited from all exit lines
    this.sharesExited = this.exitLines.reduce((total, line) => {
      return total + (line.sharesFilled() || 0);
    }, 0);

    // Calculate open shares (matching old Ruby logic line 102-104)
    this.openShares = this.sharesEntered - (this.sharesExited + this.marketSharesExited);
    this.totalPosition = this.openShares; // Update total position
    
    console.log(`LimitBot ${this.id}: Position - Entered: ${this.sharesEntered}, Exited: ${this.sharesExited}, Market Exited: ${this.marketSharesExited}, Open: ${this.openShares}`);
  }

  /**
   * Start the trading bot - matching old Ruby logic structure
   */
  start() {
    if (this.isRunning) {
      console.warn(`LimitBot ${this.id}: Already running`);
      return;
    }

    if (this.entryLines.length === 0) {
      console.error(`LimitBot ${this.id}: Cannot start without entry lines`);
      this.onError('No entry lines configured');
      return;
    }

    if (this.exitLines.length === 0) {
      console.warn(`LimitBot ${this.id}: No exit lines configured`);
    }

    this.isActive = true;
    this.isRunning = true;
    this.isStarted = true;
    this.isStopped = false;
    this.startTime = Date.now();
    this.stoppedOut = false;
    this.marketedOut = false;
    this.emergencyBrake = false;
    this.enableAlerts = true; // Enable browser alerts for price crossings
    this.crossingEvents = []; // Initialize crossing events array

    // Set primary entry line for backward compatibility
    this.entryLine = this.getCurrentEntryLine() || this.entryLines[0];

    // Distribute target shares to entry and exit lines
    this.distributeTargetShares();

    console.log(`🚀 LimitBot ${this.id}: Started trading - isRunning: ${this.isRunning}, currentPrice: ${this.currentPrice}`);
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
   * Main update method - matches old Ruby tick() method logic (lines 217-289)
   */
  update() {
    if (!this.isActive || this.emergencyBrake) return;

    try {
      const tickTimeStart = Date.now();
      
      // Update position counts first (matching old logic)
      this.updatePositionCounts();
      
      // Check if bot is completed (matching old logic lines 229-233)
      if (this.isCompleted()) {
        this.isStopped = true;
        console.log(`LimitBot ${this.id}: Bot completed, stopping`);
        return;
      }
      
      // Check if we have valid real-time price data
      if (this.currentPrice <= 0 || this.currentPrice > 10000) {
        console.warn(`LimitBot ${this.id}: No valid price data available yet (current: ${this.currentPrice}), waiting for real-time updates...`);
        return; // Exit early but don't error - wait for real-time data
      }
      
      // Simulate finding new executions (in real system this would come from order updates)
      const foundNewExecutions = this.checkForNewExecutions();
      
      if (foundNewExecutions) {
        console.log(`LimitBot ${this.id}: ================ FOUND NEW EXECUTIONS ================`);
        console.log(`LimitBot ${this.id}: Redistributing target shares`);
        this.distributeTargetShares();
        console.log(`LimitBot ${this.id}: Finished Redistributing target shares`);
      }
      
      // Check stop-out rules if we have open shares (matching old logic lines 260-263)
      if (this.openShares > 0 && !this.stoppedOut && !this.marketedOut) {
        this.checkSoftStopOutZone();
        this.checkHardStop();
      }
      
      // Check for price crossings with configuration lines
      this.checkPriceCrossings();

      // Update orders if not stopped out (matching old logic lines 265-271)
      if (!this.stoppedOut && !this.marketedOut) {
        const currentEntryLine = this.getCurrentEntryLine();
        const currentExitLine = this.getCurrentExitLine();
        
        if (currentEntryLine) {
          currentEntryLine.updateOrder();
        }
        if (currentExitLine) {
          currentExitLine.updateOrder();
        }
      }
      
      this.lastUpdateTime = Date.now() - tickTimeStart;
      
    } catch (error) {
      console.error(`LimitBot ${this.id}: Update error:`, error);
      this.onError(error.message);
    }
  }

  /**
   * Check if bot is completed - matching old Ruby logic (lines 126-130)
   */
  isCompleted() {
    // Check if all entry shares are filled and no open position
    const entrySharesTarget = this.entryLines.reduce((total, line) => {
      return total + (line.targetShares || 0);
    }, 0);
    
    return (this.sharesEntered === entrySharesTarget && this.openShares === 0 && 
            this.entryLines.length > 0 && this.entryLines[this.entryLines.length - 1].targetShares > 0) ||
           ((this.marketedOut || this.stoppedOut || this.isStopped) && this.openShares === 0);
  }

  /**
   * Check for new executions - placeholder for real execution detection
   */
  checkForNewExecutions() {
    // In real implementation, this would check for new order fills
    // For now, return false
    return false;
  }

  /**
   * Calculate percent from entry line - matching old Ruby logic (lines 350-356)
   * @param {number} currentPrice - Current market price
   * @returns {number} Percentage difference from entry line
   */
  percentFromEntryLine(currentPrice) {
    if (!this.entryLines || this.entryLines.length === 0) {
      return 0;
    }

    const currentCandleIndex = this.getCurrentCandleIndex();
    const entryPrice = this.entryLines[0].calculateCurrentPrice(currentCandleIndex);
    
    let val = 0;
    
    if (this.chartRight === 'C') {
      // Call: ((entry_price - current_price) / entry_price) * 100
      val = 100 * ((entryPrice - currentPrice) / entryPrice);
    } else {
      // Put: ((current_price - entry_price) / entry_price) * 100
      val = 100 * ((currentPrice - entryPrice) / entryPrice);
    }
    
    this.lastCalculatedPercentFromEntryLine = val;
    return val;
  }

  /**
   * Check soft stop-out zone - matching old Ruby logic (lines 495-520)
   * @param {number} currentPrice - Current market price
   */
  checkSoftStopOutZone() {
    const currentPrice = this.currentPrice;
    
    if (!this.stopOutPercent || !this.stopOutTimeLimit) {
      return;
    }

    const percentFromEntry = this.percentFromEntryLine(currentPrice);
    
    if (percentFromEntry > this.stopOutPercent) {
      if (!this.timeEnteredStopoutZone) {
        console.log(`LimitBot ${this.id}: Entering stopout zone`);
        this.timeEnteredStopoutZone = Date.now();
        this.calculatedSecondsLeftInStopout = this.stopOutTimeLimit * 60;
      } else {
        const timeInStopoutZone = (Date.now() - this.timeEnteredStopoutZone) / (1000 * 60); // minutes
        this.calculatedSecondsLeftInStopout = (this.stopOutTimeLimit * 60) - 
          ((Date.now() - this.timeEnteredStopoutZone) / 1000); // seconds
        
        if (timeInStopoutZone > this.stopOutTimeLimit) {
          console.log(`LimitBot ${this.id}: Stopped out @ ${currentPrice}`);
          this.stoppedOut = true;
          this.zeroOut();
        }
      }
    } else {
      this.timeEnteredStopoutZone = null;
      this.calculatedSecondsLeftInStopout = -1;
    }
  }

  /**
   * Check hard stop - matching old Ruby logic (lines 473-493)
   * @param {number} currentPrice - Current market price
   */
  checkHardStop() {
    const currentPrice = this.currentPrice;
    
    if (!this.hardStopOut) {
      return;
    }

    const percentFromEntry = this.percentFromEntryLine(currentPrice);
    
    if (percentFromEntry > this.hardStopOut) {
      if (!this.timeEnteredHardStopoutZone || 
          (this.timeEnteredHardStopoutZone + 30000) > Date.now()) { // 30 seconds
        
        if (!this.timeEnteredHardStopoutZone) {
          console.log(`LimitBot ${this.id}: Entering hard stopout zone`);
          console.log(`LimitBot ${this.id}: ${percentFromEntry.toFixed(2)}% > ${this.hardStopOut}%`);
          this.timeEnteredHardStopoutZone = Date.now();
        }
        // DO NOTHING AND WAIT (matching old logic line 482)
      } else {
        console.log(`LimitBot ${this.id}: HARD Stop out @ ${currentPrice}`);
        this.stoppedOut = true;
        this.zeroOut();
      }
    } else {
      this.timeEnteredHardStopoutZone = null;
    }
  }

  /**
   * Zero out position with market order - matching old Ruby logic (lines 180-207)
   */
  zeroOut() {
    // Cancel all orders first
    this.cancelAllOrders();
    
    const lotSizePortion = Math.max(0, this.openShares);
    this.marketedOut = true;
    
    // Determine side for market order (matching old logic line 189)
    const side = this.chartRight === 'C' ? 'S' : 'B'; // Opposite of the chart right
    
    console.log(`LimitBot ${this.id}: Zeroing out with market ${side} order for ${lotSizePortion} shares`);
    
    // In real implementation, this would place a market order
    // For now, just log the action
    console.log(`LimitBot ${this.id}: Market ${side} order would be placed for ${this.symbol} - ${lotSizePortion} shares`);
    
    // Update market shares exited
    this.marketSharesExited += lotSizePortion;
    this.updatePositionCounts();
  }

  /**
   * Cancel all orders - matching old Ruby logic (lines 73-77)
   */
  cancelAllOrders() {
    this.allLines.forEach(line => {
      line.cancelOrder();
    });
    console.log(`LimitBot ${this.id}: All orders cancelled`);
  }

  /**
   * Update current market price (placeholder - would integrate with market data)
   */
  updateCurrentPrice() {
    // This would integrate with real market data
    // For now, use entry line price as reference, but don't override real-time price data
    if (this.entryLine && this.entryLine.points && this.entryLine.points.length >= 2 && this.currentPrice <= 0) {
      try {
        const currentCandleIndex = this.getCurrentCandleIndex();
        
        // Debug the candle index calculation
        console.log(`LimitBot ${this.id}: Current candle index: ${currentCandleIndex}, slope: ${this.entryLine.slope?.toFixed(6)}, intercept: ${this.entryLine.intercept?.toFixed(6)}`);
        
        const calculatedPrice = this.entryLine.calculateCurrentPrice(currentCandleIndex);
        
        // Validate the calculated price and add reasonable bounds
        if (calculatedPrice && calculatedPrice > 0 && !isNaN(calculatedPrice) && calculatedPrice < 10000 && calculatedPrice > 1) {
          this.currentPrice = calculatedPrice;
          console.log(`LimitBot ${this.id}: Calculated price from entry line: ${calculatedPrice.toFixed(4)}`);
        } else {
          console.warn(`LimitBot ${this.id}: Invalid calculated price: ${calculatedPrice} (candleIndex: ${currentCandleIndex}), waiting for real-time data`);
          this.currentPrice = 0;
        }
      } catch (error) {
        console.warn(`LimitBot ${this.id}: Error calculating price from entry line:`, error);
        this.currentPrice = 0;
      }
    } else {
      console.warn(`LimitBot ${this.id}: Entry line not properly initialized or already has price data, waiting for real-time data`);
      // Don't override existing price data
    }
  }

  /**
   * Get current candle index
   * @returns {number} Current candle index
   */
  getCurrentCandleIndex() {
    // Current time is always index 0 for our relative calculation
    // Historical points will have negative indices (minutes ago)
    // Future projections will have positive indices (minutes ahead)
    return 0;
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
   * Manage entry orders with direction-aware logic
   */
  manageEntryOrders() {
    if (!this.entryLine) {
      console.log(`LimitBot ${this.id}: No entry line configured`);
      return;
    }
    
    if (this.totalPosition >= this.maxPosition) {
      console.log(`LimitBot ${this.id}: Position limit reached (${this.totalPosition}/${this.maxPosition})`);
      return;
    }
    
    // Ensure entry line has current price calculated
    const currentCandleIndex = this.getCurrentCandleIndex();
    const entryPrice = this.entryLine.calculateCurrentPrice(currentCandleIndex);
    const priceDiff = this.currentPrice - entryPrice;
    const priceDiffPercent = Math.abs(priceDiff / entryPrice) * 100;
    
    console.log(`LimitBot ${this.id}: Entry order check - Current: ${this.currentPrice.toFixed(4)}, Entry: ${entryPrice.toFixed(4)}, Diff: ${priceDiffPercent.toFixed(3)}%, Direction: ${this.entryLine.direction}, Market: ${this.marketContext}`);
    
    // Direction-aware entry logic
    let shouldPlaceEntry = false;
    let entryReason = '';
    
    if (priceDiffPercent < 0.1) {
      // Price is very close to entry line
      if (this.entryLine.direction === 'horizontal') {
        shouldPlaceEntry = true;
        entryReason = 'price at horizontal entry level';
      } else if (this.entryLine.direction === 'upward' && this.marketContext !== 'bearish') {
        // Upward entry line in bullish/neutral market
        shouldPlaceEntry = true;
        entryReason = 'price touching upward entry in favorable market';
      } else if (this.entryLine.direction === 'downward' && this.marketContext !== 'bullish') {
        // Downward entry line in bearish/neutral market (dip buying)
        shouldPlaceEntry = true;
        entryReason = 'price touching downward entry for dip buying';
      } else {
        console.log(`LimitBot ${this.id}: Entry conditions not met - ${this.entryLine.direction} line in ${this.marketContext} market`);
      }
    }
    
    // Risk management check for direction-aware entries
    if (shouldPlaceEntry) {
      const riskCheck = this.checkEntryRisk();
      if (!riskCheck.passed) {
        console.log(`LimitBot ${this.id}: Entry blocked by risk management: ${riskCheck.reason}`);
        shouldPlaceEntry = false;
      }
    }
    
    if (shouldPlaceEntry && this.entryLine.pendingOrders.length === 0) {
      console.log(`LimitBot ${this.id}: 🎯 ${entryReason.toUpperCase()}! Placing order...`);
      const order = this.entryLine.placeOrder(this.positionSize, 'buy');
      if (order) {
        this.onOrderPlaced(order);
        console.log(`LimitBot ${this.id}: ✅ Entry order placed:`, order);
      }
    } else if (priceDiffPercent >= 0.1) {
      console.log(`LimitBot ${this.id}: Price too far from entry line (${priceDiffPercent.toFixed(3)}%)`);
    } else if (this.entryLine.pendingOrders.length > 0) {
      console.log(`LimitBot ${this.id}: Entry order already pending`);
    }
  }

  /**
   * Check entry risk based on line direction and market context
   */
  checkEntryRisk() {
    const riskThreshold = 0.02; // 2% risk threshold
    
    // Higher risk for counter-trend entries
    if (this.entryLine.direction === 'upward' && this.marketContext === 'bearish') {
      return { passed: false, reason: 'upward entry in bearish market (high risk)' };
    }
    
    if (this.entryLine.direction === 'downward' && this.marketContext === 'bullish') {
      return { passed: false, reason: 'downward entry in bullish market (high risk)' };
    }
    
    // Check distance from current price to entry
    const currentCandleIndex = this.getCurrentCandleIndex();
    const entryPrice = this.entryLine.calculateCurrentPrice(currentCandleIndex);
    const priceDiff = Math.abs(this.currentPrice - entryPrice) / this.currentPrice;
    
    if (priceDiff > riskThreshold) {
      return { passed: false, reason: `entry price too far (${(priceDiff * 100).toFixed(2)}%)` };
    }
    
    return { passed: true };
  }

  /**
   * Manage exit orders with direction-aware logic
   */
  manageExitOrders() {
    if (this.exitLines.length === 0) return;
    
    this.exitLines.forEach(exitLine => {
      const exitPrice = exitLine.currentPrice;
      const priceDiff = this.currentPrice - exitPrice;
      const priceDiffPercent = Math.abs(priceDiff / exitPrice) * 100;
      
      // Only place exit orders if we have a position to sell
      if (this.totalPosition <= 0) {
        return;
      }
      
      // Direction-aware exit logic
      let shouldPlaceExit = false;
      let exitReason = '';
      
      if (priceDiffPercent < 0.1) {
        if (exitLine.direction === 'horizontal') {
          shouldPlaceExit = true;
          exitReason = 'price at horizontal exit level';
        } else if (exitLine.direction === 'upward') {
          // Upward exit line - profit taking as price rises
          if (priceDiff >= 0) { // Current price >= exit price
            shouldPlaceExit = true;
            exitReason = 'price reached upward profit target';
          }
        } else if (exitLine.direction === 'downward') {
          // Downward exit line - stop loss as price falls
          if (priceDiff <= 0) { // Current price <= exit price
            shouldPlaceExit = true;
            exitReason = 'price hit downward stop loss';
          }
        }
      }
      
      // Additional risk management for exits
      if (shouldPlaceExit && this.checkExitRisk(exitLine)) {
        if (exitLine.pendingOrders.length === 0) {
          console.log(`LimitBot ${this.id}: 🎯 ${exitReason.toUpperCase()}! Placing exit order...`);
          const order = exitLine.placeOrder(exitLine.orderSize, 'sell');
          if (order) {
            this.onOrderPlaced(order);
            console.log(`LimitBot ${this.id}: ✅ Exit order placed on ${exitLine.direction} line:`, order);
          }
        }
      } else if (priceDiffPercent >= 0.1) {
        console.log(`LimitBot ${this.id}: Price too far from ${exitLine.direction} exit line (${priceDiffPercent.toFixed(3)}%)`);
      }
    });
  }

  /**
   * Check exit risk based on line direction and market context
   * @param {LimitLine} exitLine - The exit line to check
   */
  checkExitRisk(exitLine) {
    // Always allow stop-loss exits (downward lines)
    if (exitLine.direction === 'downward') {
      return true;
    }
    
    // For profit-taking exits (upward lines), consider market context
    if (exitLine.direction === 'upward') {
      // Be more aggressive with profit-taking in bearish markets
      if (this.marketContext === 'bearish') {
        return true;
      }
      // Still allow in bullish markets but might be more conservative
      return true;
    }
    
    // Horizontal lines are always OK
    if (exitLine.direction === 'horizontal') {
      return true;
    }
    
    return true; // Default to allowing exit
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
   * Check for price crossings with configuration lines
   * This method detects when the current price crosses any of the drawn lines
   */
  checkPriceCrossings() {
    console.log(`🔍 LimitBot ${this.id}: checkPriceCrossings called - currentPrice: ${this.currentPrice}, isRunning: ${this.isRunning}, allLines: ${this.allLines.length}`);
    
    if (this.currentPrice <= 0) {
      console.log(`❌ LimitBot ${this.id}: No valid price data (currentPrice: ${this.currentPrice})`);
      return; // No valid price data
    }

    // Simple logging: current price and each line's price
    console.log(`✅ Current Price: $${this.currentPrice.toFixed(2)} (Bot ${this.id}, Running: ${this.isRunning})`);
    
    this.allLines.forEach((line, index) => {
      if (line.points && line.points.length >= 2) {
        const linePrice = this.calculateLinePriceAtCurrentTime(line);
        const lineType = line.isEntryLine ? 'ENTRY' : 'EXIT';
        console.log(`📊 Line ${index + 1} (${lineType}): $${linePrice.toFixed(2)}`);
      }
    });
  }

  /**
   * Calculate the price of a line at the current time
   * @param {LimitLine} line - The line to calculate price for
   * @returns {number} The calculated line price
   */
  calculateLinePriceAtCurrentTime(line) {
    if (!line.points || line.points.length < 2) {
      return 0;
    }

    try {
      const currentCandleIndex = this.getCurrentCandleIndex();
      return line.calculateCurrentPrice(currentCandleIndex);
    } catch (error) {
      console.warn(`LimitBot ${this.id}: Error calculating line price for ${line.id}:`, error);
      return 0;
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
      marketContext: this.marketContext,
      trendStrength: this.trendStrength,
      entryLine: this.entryLine?.getStatus(),
      exitLines: this.exitLines.map(line => line.getStatus()),
      startTime: this.startTime,
      lastUpdateTime: this.lastUpdateTime,
      enableAlerts: this.enableAlerts,
      crossingEvents: this.crossingEvents || []
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

  /**
   * Enable or disable browser alerts for price crossings
   * @param {boolean} enabled - Whether to enable alerts
   */
  setAlertsEnabled(enabled) {
    this.enableAlerts = enabled;
    console.log(`LimitBot ${this.id}: Alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get recent crossing events
   * @returns {Array} Array of crossing events
   */
  getCrossingEvents() {
    return this.crossingEvents || [];
  }

  /**
   * Clear crossing events history
   */
  clearCrossingEvents() {
    this.crossingEvents = [];
    console.log(`LimitBot ${this.id}: Crossing events cleared`);
  }

  /**
   * Test price crossing detection (for debugging)
   */
  testPriceCrossing() {
    console.log(`LimitBot ${this.id}: Testing price crossing detection...`);
    console.log(`Current price: ${this.currentPrice}`);
    console.log(`All lines: ${this.allLines.length}`);
    
    this.allLines.forEach((line, index) => {
      const linePrice = this.calculateLinePriceAtCurrentTime(line);
      console.log(`Line ${index + 1} (${line.id}): ${linePrice.toFixed(4)} - Type: ${line.isEntryLine ? 'ENTRY' : 'EXIT'}`);
      
      // Show detailed calculation info
      if (line.points && line.points.length >= 2) {
        console.log(`  Points: [${line.points[0].time}, ${line.points[0].price}] to [${line.points[1].time}, ${line.points[1].price}]`);
        console.log(`  Slope: ${line.slope.toFixed(6)}, Intercept: ${line.intercept.toFixed(4)}`);
        console.log(`  Current candle index: ${this.getCurrentCandleIndex()}`);
      }
    });
  }
}

export default LimitBot;
