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
    this.maxOrderSize = options.maxOrderSize || 1000;
    this.minOrderSize = options.minOrderSize || 10;
    
    // Order management
    this.placedOrders = [];
    this.pendingOrders = [];
    this.filledOrders = [];
    
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

    // Calculate slope: m = (y2 - y1) / (x2 - x1)
    this.slope = (y2 - y1) / (x2 - x1);
    
    // Calculate intercept: b = y1 - m * x1
    this.intercept = y1 - this.slope * x1;

    console.log(`LimitLine ${this.id}: slope=${this.slope.toFixed(4)}, intercept=${this.intercept.toFixed(2)}`);
  }

  /**
   * Convert timestamp to candle index
   * @param {number} timestamp - Unix timestamp
   * @returns {number} Candle index
   */
  timeToCandleIndex(timestamp) {
    // Assuming 1-minute candles starting from market open
    const marketOpen = new Date().setHours(9, 30, 0, 0); // 9:30 AM EST
    return Math.floor((timestamp - marketOpen) / 60000); // 60000ms = 1 minute
  }

  /**
   * Calculate current price level based on current candle index
   * @param {number} currentCandleIndex - Current candle index
   * @returns {number} Calculated price level
   */
  calculateCurrentPrice(currentCandleIndex) {
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
   * Get line status summary
   * @returns {Object} Status summary
   */
  getStatus() {
    return {
      id: this.id,
      type: this.type,
      rank: this.rank,
      isActive: this.isActive,
      currentPrice: this.currentPrice,
      slope: this.slope,
      intercept: this.intercept,
      totalFilled: this.getTotalFilledSize(),
      totalPending: this.getTotalPendingSize(),
      pendingOrders: this.pendingOrders.length,
      filledOrders: this.filledOrders.length
    };
  }
}

export default LimitLine;
