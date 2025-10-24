/**
 * TradingService - Frontend display only
 * All bot logic is now handled by the backend
 * This service only manages frontend display and communication
 */
export class TradingService {
  constructor() {
    this.isInitialized = false;
    
    // Event callbacks
    this.onBotStatusChange = null;
    this.onOrderUpdate = null;
    this.onError = null;
    
    console.log('TradingService: Initialized (Frontend Display Only)');
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
   * Get bot status from backend
   * @param {number} configId - Configuration ID
   * @returns {Promise<Object>} Bot status from backend
   */
  async getBotStatus(configId) {
    try {
      const response = await fetch(`http://localhost:8000/bots/list`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch bot status: ${response.statusText}`);
      }
      
      const bots = await response.json();
      const bot = bots.find(b => b.config_id === configId);
      
      return bot || null;
    } catch (error) {
      console.error('Error fetching bot status:', error);
      return null;
    }
  }

  /**
   * Start a bot via backend API
   * @param {number} configId - Configuration ID
   * @param {Object} configData - Configuration data
   * @returns {Promise<Object>} Start result
   */
  async startBot(configId, configData) {
    try {
      // First create the bot if it doesn't exist
      const createResponse = await fetch(`http://localhost:8000/bots/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          config_id: configId,
          symbol: configData.symbol || 'AAPL',
          name: configData.name || `Bot ${configId}`,
          position_size: configData.position_size || 1000,
          max_position: configData.max_position || 10000
        })
      });
      
      if (!createResponse.ok) {
        throw new Error(`Failed to create bot: ${createResponse.statusText}`);
      }
      
      const createResult = await createResponse.json();
      const botId = createResult.id || createResult.bot?.id;
      
      if (!botId) {
        throw new Error('No bot ID returned from creation');
      }
      
      // Then start the bot
      const startResponse = await fetch(`http://localhost:8000/bots/${botId}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        }
      });
      
      if (!startResponse.ok) {
        throw new Error(`Failed to start bot: ${startResponse.statusText}`);
      }
      
      const startResult = await startResponse.json();
      console.log('✅ Bot started via backend:', startResult);
      
      return startResult;
    } catch (error) {
      console.error('Error starting bot:', error);
      throw error;
    }
  }

  /**
   * Stop a bot via backend API
   * @param {number} configId - Configuration ID
   * @returns {Promise<Object>} Stop result
   */
  async stopBot(configId) {
    try {
      const bot = await this.getBotStatus(configId);
    if (!bot) {
        throw new Error('Bot not found');
      }
      
      const response = await fetch(`http://localhost:8000/bots/${bot.id}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to stop bot: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ Bot stopped via backend:', result);
      
      return result;
    } catch (error) {
      console.error('Error stopping bot:', error);
      throw error;
    }
  }

  /**
   * Add lines to a bot via backend API
   * @param {number} configId - Configuration ID
   * @param {Array} lines - Array of line objects
   * @returns {Promise<Object>} Add lines result
   */
  async addLinesToBot(configId, lines) {
    try {
      const bot = await this.getBotStatus(configId);
    if (!bot) {
        throw new Error('Bot not found');
      }
      
      const response = await fetch(`http://localhost:8000/bots/${bot.id}/lines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ lines })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to add lines: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ Lines added to bot via backend:', result);
      
      return result;
    } catch (error) {
      console.error('Error adding lines to bot:', error);
      throw error;
    }
  }

  /**
   * Legacy method - now just logs that bot logic is handled by backend
   * @param {number} configId - Configuration ID
   * @param {Object} marketData - Market data
   */
  processMarketData(configId, marketData) {
    console.log(`📊 TradingService: Market data received for config ${configId} - Bot logic handled by backend`);
    // All bot logic is now handled by the backend
    // This method is kept for compatibility but does nothing
  }

  /**
   * Legacy method - now just logs that bot creation is handled by backend
   * @param {Object} configData - Configuration data
   * @returns {Promise<Object>} Bot creation result
   */
  async createBotFromConfig(configData) {
    console.log(`🤖 TradingService: Bot creation handled by backend for config ${configData.id}`);
    // Bot creation is now handled by the backend
    // Return a mock bot object for compatibility
    return {
      id: configData.id,
      configId: configData.id,
      isActive: false,
      isRunning: false,
      isBought: false,
      currentPrice: 0,
      entryPrice: 0,
      openShares: 0,
      totalPosition: 0
    };
  }

  /**
   * Get current active config ID (legacy method)
   * @returns {number|null} Active config ID
   */
  getCurrentActiveConfigId() {
    // This is now handled by the backend
    // Return null as the frontend no longer manages active bots
      return null;
  }
}

// Export singleton instance
export default new TradingService();