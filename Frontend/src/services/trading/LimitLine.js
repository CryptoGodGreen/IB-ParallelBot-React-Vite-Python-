/**
 * LimitLine class manages individual limit orders with slope/intercept calculations
 * Each line represents a dynamic price level that updates based on candle index
 */
export class LimitLine {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.type = options.type || 'entry'; // 'entry' or 'exit'
    this.rank = options.rank || 1; // For exit lines, determines order priority
    this.points = options.points || []; // TradingView line points [{time, price}, {time, price}]
    this.slope = 0;
    this.intercept = 0;
    this.currentPrice = 0;
    this.lastUpdateTime = 0;
    this.isActive = true;
    this.orderSize = options.orderSize || 0;
    this.targetShares = options.targetShares || 0; // Matching old Ruby system
    this.maxOrderSize = options.maxOrderSize || 1000;
    this.minOrderSize = options.minOrderSize || 10;
    this.isEntryLine = options.isEntryLine || false; // Boolean flag like old system
    this.chartSide = options.chartSide || 'B'; // Chart side for order direction logic
    
    // Order management
    this.placedOrders = [];
    this.pendingOrders = [];
    this.filledOrders = [];
    this._sharesFilledProperty = 0; // Total shares filled (matching old Ruby system)
    this.currentOrder = null; // Current active order (matching old Ruby system)
    
    // Calculate initial slope and intercept
    this.calculateSlopeAndIntercept();
  }

  generateId() {
    return `line_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate slope and intercept from TradingView line points
   * Uses linear regression: y = mx + b where x is candle index, y is price
   */
  calculateSlopeAndIntercept() {
    if (this.points.length < 2) {
      console.warn('LimitLine: Insufficient points for slope calculation');
      return;
    }

    const point1 = this.points[0];
    const point2 = this.points[1];
    
    // Convert time to candle index (assuming 1-minute candles for now)
    const x1 = this.timeToCandleIndex(point1.time);
    const x2 = this.timeToCandleIndex(point2.time);
    const y1 = point1.price;
    const y2 = point2.price;

    // Check for division by zero
    if (x1 === x2) {
      this.slope = 0;
      this.intercept = y1; // Use first point's price as horizontal line
    } else {
      // Calculate slope: m = (y2 - y1) / (x2 - x1)
      this.slope = (y2 - y1) / (x2 - x1);
      
      // Calculate intercept: b = y1 - m * x1
      this.intercept = y1 - this.slope * x1;
    }

    // Validate the calculated values
    if (isNaN(this.slope) || isNaN(this.intercept)) {
      // Fallback to horizontal line at average price
      this.slope = 0;
      this.intercept = (y1 + y2) / 2;
    }

    // Determine line direction and characteristics
    this.direction = this.getLineDirection();
    this.slopeStrength = this.getSlopeStrength();
    this.isTrendFollowing = this.slopeStrength > 0.1; // Significant trend if slope > 0.1

    console.log(`LimitLine ${this.id}: Final calculation - slope=${this.slope.toFixed(4)}, intercept=${this.intercept.toFixed(4)}, direction=${this.direction}, strength=${this.slopeStrength.toFixed(4)}`);
  }

  /**
   * Determine line direction based on slope
   * @returns {string} 'upward', 'downward', or 'horizontal'
   */
  getLineDirection() {
    const slopeThreshold = 0.001; // Minimum slope to be considered trending
    
    if (this.slope > slopeThreshold) {
      return 'upward';
    } else if (this.slope < -slopeThreshold) {
      return 'downward';
    } else {
      return 'horizontal';
    }
  }

  /**
   * Get slope strength as absolute value
   * @returns {number} Absolute slope value
   */
  getSlopeStrength() {
    return Math.abs(this.slope);
  }

  /**
   * Check if line direction is suitable for entry role
   * @param {string} marketContext - 'bullish', 'bearish', or 'neutral'
   * @returns {boolean} True if suitable for entry
   */
  isSuitableForEntry(marketContext = 'neutral') {
    // For entry lines, we want to buy in the direction of the trend
    // or at support/resistance levels
    
    if (this.direction === 'horizontal') {
      return true; // Horizontal lines work as entry for both directions
    }
    
    switch (marketContext) {
      case 'bullish':
        // In bullish market, prefer upward lines or horizontal support
        return this.direction === 'upward' || this.direction === 'horizontal';
      case 'bearish':
        // In bearish market, prefer downward lines or horizontal resistance  
        return this.direction === 'downward' || this.direction === 'horizontal';
      default:
        return true; // Neutral market accepts any direction
    }
  }

  /**
   * Check if line direction is suitable for exit role
   * @param {string} marketContext - 'bullish', 'bearish', or 'neutral'
   * @returns {boolean} True if suitable for exit
   */
  isSuitableForExit(marketContext = 'neutral') {
    // For exit lines, we want to take profits or stop losses
    
    if (this.direction === 'horizontal') {
      return true; // Horizontal lines work for both profit and stop loss
    }
    
    switch (marketContext) {
      case 'bullish':
        // In bullish market, upward lines are profit targets, downward lines are stop losses
        return true; // Both work in different contexts
      case 'bearish':
        // In bearish market, downward lines are profit targets, upward lines are stop losses
        return true; // Both work in different contexts
      default:
        return true; // Neutral market accepts any direction
    }
  }

  /**
   * Convert timestamp to candle index
   * @param {number} timestamp - Unix timestamp
   * @returns {number} Candle index
   */
  timeToCandleIndex(timestamp) {
    // Handle invalid timestamps
    if (!timestamp || timestamp <= 0) {
      console.warn(`LimitLine ${this.id}: Invalid timestamp: ${timestamp}`);
      return 0;
    }

    // Convert timestamp to Date object
    const pointDate = new Date(timestamp * 1000); // TradingView timestamps are in seconds
    const now = new Date();
    
    // For historical points, we need to calculate their position relative to current time
    // This allows us to project the line into the future
    
    // Calculate minutes difference from current time
    const timeDiffMinutes = Math.floor((pointDate - now) / 60000);
    
    
    return timeDiffMinutes;
  }

  /**
   * Calculate current price level based on current candle index
   * @param {number} currentCandleIndex - Current candle index
   * @returns {number} Calculated price level
   */
  calculateCurrentPrice(currentCandleIndex) {
    // Check if slope and intercept are valid
    if (isNaN(this.slope) || isNaN(this.intercept)) {
      console.warn(`LimitLine ${this.id}: Cannot calculate price - invalid slope (${this.slope}) or intercept (${this.intercept})`);
      return 0;
    }

    // Linear equation: price = slope * candleIndex + intercept
    const calculatedPrice = this.slope * currentCandleIndex + this.intercept;
    this.currentPrice = calculatedPrice;
    this.lastUpdateTime = Date.now();
    
    return calculatedPrice;
  }

  /**
   * Update line with new TradingView points
   * @param {Array} newPoints - New line points from TradingView
   */
  updatePoints(newPoints) {
    this.points = newPoints;
    this.calculateSlopeAndIntercept();
    console.log(`LimitLine ${this.id}: Updated with new points`);
  }

  /**
   * Place a limit order at current price level
   * @param {number} size - Order size
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} Order object
   */
  placeOrder(size, side = 'buy') {
    if (!this.isActive) {
      console.warn(`LimitLine ${this.id}: Cannot place order, line is inactive`);
      return null;
    }

    const order = {
      id: this.generateOrderId(),
      lineId: this.id,
      side: side,
      size: Math.max(this.minOrderSize, Math.min(size, this.maxOrderSize)),
      price: this.currentPrice,
      status: 'pending',
      timestamp: Date.now(),
      candleIndex: this.timeToCandleIndex(Date.now())
    };

    this.pendingOrders.push(order);
    console.log(`LimitLine ${this.id}: Placed ${side} order for ${order.size} @ ${order.price.toFixed(2)}`);
    
    return order;
  }

  /**
   * Update existing orders with new price levels
   */
  updateOrders(currentCandleIndex) {
    const newPrice = this.calculateCurrentPrice(currentCandleIndex);
    
    // Update pending orders
    this.pendingOrders.forEach(order => {
      const priceChange = Math.abs(order.price - newPrice);
      const priceChangePercent = (priceChange / order.price) * 100;
      
      // Only update if price change is significant (>0.1%)
      if (priceChangePercent > 0.1) {
        order.price = newPrice;
        order.lastUpdate = Date.now();
        console.log(`LimitLine ${this.id}: Updated order ${order.id} price to ${newPrice.toFixed(2)}`);
      }
    });

    // Update placed orders
    this.placedOrders.forEach(order => {
      const priceChange = Math.abs(order.price - newPrice);
      const priceChangePercent = (priceChange / order.price) * 100;
      
      if (priceChangePercent > 0.1) {
        order.price = newPrice;
        order.lastUpdate = Date.now();
        console.log(`LimitLine ${this.id}: Updated placed order ${order.id} price to ${newPrice.toFixed(2)}`);
      }
    });
  }

  /**
   * Cancel all pending orders
   */
  cancelPendingOrders() {
    this.pendingOrders.forEach(order => {
      order.status = 'cancelled';
      console.log(`LimitLine ${this.id}: Cancelled order ${order.id}`);
    });
    this.pendingOrders = [];
  }

  /**
   * Mark order as filled
   * @param {string} orderId - Order ID
   */
  fillOrder(orderId) {
    const orderIndex = this.pendingOrders.findIndex(order => order.id === orderId);
    if (orderIndex !== -1) {
      const order = this.pendingOrders.splice(orderIndex, 1)[0];
      order.status = 'filled';
      order.filledAt = Date.now();
      this.filledOrders.push(order);
      console.log(`LimitLine ${this.id}: Order ${orderId} filled`);
    }
  }

  /**
   * Get total filled size
   * @returns {number} Total filled size
   */
  getTotalFilledSize() {
    return this.filledOrders.reduce((total, order) => total + order.size, 0);
  }

  /**
   * Get total pending size
   * @returns {number} Total pending size
   */
  getTotalPendingSize() {
    return this.pendingOrders.reduce((total, order) => total + order.size, 0);
  }

  /**
   * Deactivate the line (emergency stop)
   */
  deactivate() {
    this.isActive = false;
    this.cancelPendingOrders();
    console.log(`LimitLine ${this.id}: Deactivated`);
  }

  /**
   * Reactivate the line
   */
  reactivate() {
    this.isActive = true;
    console.log(`LimitLine ${this.id}: Reactivated`);
  }

  generateOrderId() {
    return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if line is active - matching old Ruby logic (lines 57-59)
   * @returns {boolean} True if line has unfilled shares
   */
  isActiveLine() {
    return this.sharesFilled() < this.targetShares;
  }

  /**
   * Get shares filled - matching old Ruby logic (lines 61-63)
   * @returns {number} Total shares filled
   */
  sharesFilled() {
    return this.filledOrders.reduce((total, order) => total + order.size, 0);
  }

  /**
   * Cancel current order - matching old Ruby logic (lines 65-69)
   */
  cancelOrder() {
    if (this.currentOrder) {
      // In real implementation, this would call the broker API to cancel
      console.log(`LimitLine ${this.id}: Cancelling order ${this.currentOrder.id}`);
      this.currentOrder.status = 'cancelled';
      this.currentOrder = null;
    }
  }

  /**
   * Update order - matching old Ruby logic (lines 71-118)
   * @param {boolean} forceUpdate - Force order update regardless of price changes
   */
  updateOrder(forceUpdate = false) {
    // Don't update if emergency brake is on (matching old logic line 72)
    if (this.emergencyBrake) {
      return;
    }

    const price = this.calculateCurrentPrice(this.getCurrentCandleIndex());
    const lotSize = this.targetShares - this.sharesFilled();
    
    // Determine side based on chart side and line type (matching old logic lines 76-78)
    let side = 'B'; // Default to buy
    if (this.chartSide === 'B' && !this.isEntryLine) {
      side = 'S'; // Exit line on buy chart = sell
    }
    if (this.chartSide === 'S' && this.isEntryLine) {
      side = 'S'; // Entry line on sell chart = sell
    }

    if (this.sharesFilled() < this.targetShares) {
      if (!this.currentOrder) {
        // Place new order logic (matching old logic lines 80-100)
        console.log(`LimitLine ${this.id}: Sending new order side: ${side} price: ${price.toFixed(2)} size: ${lotSize}`);
        
        const order = {
          id: this.generateOrderId(),
          side: side,
          price: price,
          size: lotSize,
          status: 'pending',
          timestamp: Date.now()
        };
        
        this.currentOrder = order;
        this.pendingOrders.push(order);
        
        console.log(`LimitLine ${this.id}: New order placed:`, order);
      } else {
        // Update existing order logic (matching old logic lines 101-118)
        const currentOrderPrice = this.currentOrder.price;
        const currentOrderSize = this.currentOrder.size;
        
        if (forceUpdate || currentOrderPrice !== price || currentOrderSize !== lotSize) {
          console.log(`LimitLine ${this.id}: Updating order side: ${side} price: ${price.toFixed(2)} size: ${lotSize}`);
          
          this.currentOrder.price = price;
          this.currentOrder.size = lotSize;
          this.currentOrder.lastUpdate = Date.now();
          
          console.log(`LimitLine ${this.id}: Order updated`);
        }
      }
    }
  }

  /**
   * Get current candle index - helper method
   */
  getCurrentCandleIndex() {
    const now = Date.now();
    const marketOpen = new Date().setHours(9, 30, 0, 0); // 9:30 AM EST
    return Math.floor((now - marketOpen) / 60000); // 1-minute candles
  }

  /**
   * Get line status summary
   * @returns {Object} Status summary
   */
  getStatus() {
    return {
      id: this.id,
      type: this.type,
      rank: this.rank,
      isActive: this.isActiveLine(),
      currentPrice: this.currentPrice,
      slope: this.slope,
      intercept: this.intercept,
      direction: this.direction || 'unknown',
      slopeStrength: this.slopeStrength || 0,
      isTrendFollowing: this.isTrendFollowing || false,
      targetShares: this.targetShares,
      sharesFilled: this.sharesFilled(),
      totalFilled: this.getTotalFilledSize(),
      totalPending: this.getTotalPendingSize(),
      pendingOrders: this.pendingOrders.length,
      filledOrders: this.filledOrders.length,
      isEntryLine: this.isEntryLine
    };
  }
}

export default LimitLine;
