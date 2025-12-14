import { useState, useEffect } from 'react';
import tradingService from '../../services/trading/TradingService.js';
import chartService from '../../services/chartService.js';
import './BotConfigPanel.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const BotConfigPanel = ({ 
  selectedConfig, 
  onConfigUpdate,
  onSaveDrawings,
  onLoadDrawings 
}) => {
  const [config, setConfig] = useState({
    name: '',
    symbol: 'NU',
    ownedBy: 'admin',
    marketDirection: 'Uptrend',
    botPublished: false,
    tradeAmount: 250,
    tradeEquityOrOption: 'Equity',
    botStopOutTime: 240,
    botHardStopOut: '3',
    multiBuy: 'disabled',
    lastQuoteReceived: '',
    buyPrice: '',
    sellPrice: ''
  });

  const [trades, setTrades] = useState([]);
  const [tradingStatus, setTradingStatus] = useState(null);
  const [botStatus, setBotStatus] = useState(null);
  const [backendBotStatus, setBackendBotStatus] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  const [tradeHistory, setTradeHistory] = useState([]);

  // Helper function to get bot status display
  const getBotStatusDisplay = (position) => {
    if (!position) return '⚪ UNKNOWN';
    
    if (position.status === 'HARD_STOPPED_OUT' || position.hardStopTriggered) {
      return '🚨 HARD_STOPPED_OUT';
    } else if (position.isActive && position.isRunning) {
      return '🟢 RUNNING';
    } else {
      return '🔴 COMPLETED';
    }
  };

  // Helper function to get bot status CSS class
  const getBotStatusClass = (position) => {
    if (!position) return 'inactive';
    
    if (position.hardStopTriggered) {
      return 'hard-stopped';
    } else if (position.isActive && position.isRunning) {
      return 'running';
    } else {
      return 'completed';
    }
  };

  // Helper function to get detailed position status
  const getDetailedPositionStatus = (position) => {
    if (!position) return '⚪ NO POSITION';

    const status = position.status || position.bot_status || '';
    const multiBuyRaw = position.multi_buy ?? position.multiBuy ?? 'disabled';
    const multiBuy = typeof multiBuyRaw === 'string' ? multiBuyRaw.toLowerCase() : multiBuyRaw ? 'enabled' : 'disabled';
    const openShares = position.openShares ?? position.open_shares ?? 0;
    const sharesEntered = position.sharesEntered ?? position.shares_entered ?? 0;
    const sharesExited = position.sharesExited ?? position.shares_exited ?? 0;
    const positionSize = position.positionSize ?? position.position_size ?? 0;
    const hardStopTriggered = position.hardStopTriggered ?? position.hard_stop_triggered ?? false;
    const isBoughtExplicit = position.isBought ?? position.is_bought;
    const inferredIsBought = isBoughtExplicit !== undefined ? isBoughtExplicit : (openShares > 0 || sharesEntered > 0);
    const isBought = Boolean(inferredIsBought);

    // Check for completed bot first
    if (status === 'COMPLETED') {
      return '🎉 COMPLETED';
    }

    // Check for hard stop-out
    if (status === 'HARD_STOPPED_OUT' || hardStopTriggered) {
      return '🚨 HARD STOP OUT';
    }

    if (isBought) {
      // Priority 1: Check if fully sold first
      if (openShares <= 0) {
        return '🔴 SOLD_100%';
      } else if (sharesExited > 0 && sharesEntered > 0) {
        // Calculate actual percentage dynamically based on shares sold
        const exitPercentage = (sharesExited / sharesEntered) * 100;
        return `🟡 SOLD_${exitPercentage.toFixed(0)}%`;
      }
      // Priority 3: Check if multi-buy mode and partially filled (before checking for full BOUGHT)
      else if (multiBuy === 'enabled' && sharesEntered > 0 && positionSize > 0 && sharesExited === 0) {
        // Calculate actual percentage dynamically based on shares entered
        const buyPercentage = (sharesEntered / positionSize) * 100;
        // If we have partial position (not 100% bought yet)
        if (buyPercentage < 100) {
          return `🟢 BUY_${buyPercentage.toFixed(0)}%`;
        } else {
          return '🟢 BOUGHT';
        }
      } else {
        return '🟢 BOUGHT';
      }
    } else {
      // Interpret backend status if bot hasn't flagged is_bought yet but status reflects entry
      if (status?.startsWith?.('BUY_')) {
        return `🟢 ${status}`;
      }
      if ((sharesEntered > 0 || openShares > 0) && multiBuy === 'enabled') {
        const buyPercentage = positionSize > 0 ? (sharesEntered / positionSize) * 100 : 0;
        if (buyPercentage > 0) {
          return `🟢 BUY_${buyPercentage.toFixed(0)}%`;
        }
      }
      return '⚪ NO POSITION';
    }
  };

  // Fetch backend bot status
  const fetchBackendBotStatus = async (configId) => {
    try {
      console.log('🔍 Fetching bot status for config ID:', configId);
      const response = await fetch(`${API_BASE_URL}/bots/list`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      
      console.log('📡 API response status:', response.status);
      
      if (response.ok) {
        const bots = await response.json();
        console.log('📊 All bots from API:', bots);
        const bot = bots.find(b => b.config_id === configId);
        console.log('🎯 Found bot for config', configId, ':', bot);
        
        // Map backend response to frontend expected format
        const mappedBot = bot ? {
          ...bot,
          isBought: bot.is_bought,
          isActive: bot.is_active,
          isRunning: bot.is_running,
          currentPrice: bot.current_price,
          entryPrice: bot.entry_price,
          openShares: bot.open_shares,
          sharesEntered: bot.shares_entered,
          sharesExited: bot.shares_exited,
          totalPosition: bot.total_position,
          positionSize: bot.position_size,
          maxPosition: bot.max_position,
          hardStopTriggered: bot.hard_stop_triggered,
          originalExitLinesCount: bot.original_exit_lines_count,
          multi_buy: bot.multi_buy,  // Add multi_buy field mapping
          status: bot.status,  // Add status field mapping
          createdAt: bot.created_at,
          updatedAt: bot.updated_at
        } : null;
        
        setBackendBotStatus(mappedBot);
        console.log('📊 Mapped bot status:', mappedBot);
        console.log('🕐 Bot status updated at:', new Date().toLocaleTimeString());
        
        // Debug: Log position status calculation
        const status = getDetailedPositionStatus(mappedBot);
        console.log('🎯 Calculated position status:', status);
        console.log('🔍 Status details:', {
          isBought: mappedBot?.isBought,
          openShares: mappedBot?.openShares,
          sharesEntered: mappedBot?.sharesEntered,
          sharesExited: mappedBot?.sharesExited,
          hardStopTriggered: mappedBot?.hardStopTriggered
        });
      } else {
        // If API fails, set to null (will show as inactive)
        setBackendBotStatus(null);
      }
    } catch (error) {
      console.error('Error fetching backend bot status:', error);
      setBackendBotStatus(null);
    }
  };

  const fetchTradeHistory = async (botIdOrConfigId, isConfigId = false) => {
    if (!botIdOrConfigId) return;
    
    try {
      let botId = botIdOrConfigId;
      
      // If it's a config ID, find the bot ID first
      if (isConfigId) {
        console.log('📊 Finding bot for config ID:', botIdOrConfigId);
        const response = await fetch(`${API_BASE_URL}/bots/list`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        });
        
        if (response.ok) {
          const bots = await response.json();
          const bot = bots.find(b => b.config_id === botIdOrConfigId);
          if (bot) {
            botId = bot.id;
            console.log('🎯 Found bot ID:', botId, 'for config ID:', botIdOrConfigId);
          } else {
            console.log('❌ No bot found for config ID:', botIdOrConfigId);
            setTradeHistory([]);
            return;
          }
        } else {
          console.error('Failed to fetch bots list:', response.status);
          setTradeHistory([]);
          return;
        }
      }
      
      console.log('📊 Fetching trade history for bot ID:', botId);
      const response = await fetch(`${API_BASE_URL}/bots/${botId}/trade-history`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      
      if (response.ok) {
        const history = await response.json();
        console.log('📈 Trade history:', history);
        setTradeHistory(history);
      } else {
        console.error('Failed to fetch trade history:', response.status);
        setTradeHistory([]);
      }
    } catch (error) {
      console.error('Error fetching trade history:', error);
      setTradeHistory([]);
    }
  };

  useEffect(() => {
    if (selectedConfig) {
      // Map all fields from selectedConfig to config state
      setConfig(prev => ({
        ...prev,
        name: selectedConfig.name || prev.name,
        symbol: selectedConfig.symbol || prev.symbol,
        ownedBy: selectedConfig.owned_by || prev.ownedBy,
        trendStrategy: selectedConfig.trend_strategy || prev.trendStrategy || 'uptrend',
        botPublished: selectedConfig.bot_published !== undefined ? selectedConfig.bot_published : prev.botPublished,
        tradeAmount: selectedConfig.trade_amount || prev.tradeAmount || 250,
        tradeEquityOrOption: selectedConfig.trade_equity_or_option || prev.tradeEquityOrOption || 'Equity',
        botStopOutTime: selectedConfig.bot_stop_out_time || prev.botStopOutTime || 240,
        botHardStopOut: selectedConfig.bot_hard_stop_out || prev.botHardStopOut || '3',
        multiBuy: selectedConfig.multi_buy || prev.multiBuy || 'disabled'
      }));
      
      // Fetch backend bot status
      fetchBackendBotStatus(selectedConfig.id);
      
      // Fetch trade history for this config (works for both active and completed bots)
      fetchTradeHistory(selectedConfig.id, true);
      
      // Get frontend bot status for this configuration (for backward compatibility)
      const status = tradingService.getBotStatus(selectedConfig.id);
      setBotStatus(status);
    }
  }, [selectedConfig]);

  // Monitor bot status updates
  useEffect(() => {
    if (!selectedConfig?.id) return;
    
    // Set up polling to refresh bot status every 5 seconds (reduced frequency to avoid DB overload)
    const interval = setInterval(async () => {
      await fetchBackendBotStatus(selectedConfig.id);
      // Also refresh trade history to keep orders table up to date
      // Use config ID - fetchTradeHistory will find the bot ID if needed
      fetchTradeHistory(selectedConfig.id, true);
    }, 5000); // Changed from 1000ms to 5000ms (5 seconds)
    
    return () => clearInterval(interval);
  }, [selectedConfig?.id]);

  // Check token expiration periodically
  useEffect(() => {
    const checkTokenExpiration = () => {
      if (!chartService.checkTokenExpiration()) {
        // Token is expired, user will be redirected to login
        return;
      }
    };

    // Check immediately
    checkTokenExpiration();

    // Check every 30 seconds
    const interval = setInterval(checkTokenExpiration, 30000);

    return () => clearInterval(interval);
  }, []);

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    console.log('🚀 BotConfigPanel Save button clicked!');
    console.log('🚀 selectedConfig:', selectedConfig);
    console.log('🚀 config state:', config);
    
    // Extract only the fields that the backend expects
    const configData = {
      name: config.name,
      symbol: config.symbol,
      interval: selectedConfig?.interval || '5M', // Use interval from selectedConfig or default to 5M
      rth: true, // Default to true like in ConfigurationPanel
      trade_amount: config.tradeAmount, // Include trade amount for position sizing
      trend_strategy: config.trendStrategy || 'uptrend', // Add trend strategy
      // Keep existing layout_data if available
      layout_data: selectedConfig?.layout_data || {
        entry_line: null,
        exit_line: null,
        tpsl_settings: null,
        bot_configuration: null,
        other_drawings: null
      },
      // Add bot configuration fields
      multi_buy: config.multiBuy || 'disabled' // Multi-buy mode (default disabled)
    };
    
    console.log('💾 BotConfigPanel: Sending config data:', configData);
    console.log('💾 BotConfigPanel: Calling onConfigUpdate...');
    onConfigUpdate(configData);
    console.log('💾 BotConfigPanel: onConfigUpdate called successfully');
    // The TradingDashboard will handle saving drawings via the save trigger
  };

  const handleStart = async () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      return;
    }
    
    try {
      console.log('🚀 Starting backend bot for config:', selectedConfig.id);
      
      // Use the simplified TradingService to start the bot
      await tradingService.startBot(selectedConfig.id, selectedConfig);
      
      // Refresh bot status
      await fetchBackendBotStatus(selectedConfig.id);
      
    } catch (error) {
      console.error('❌ Error starting bot:', error);
      setOrderStatus({
        type: 'error',
        message: `Failed to start bot: ${error.message}`
      });
    }
  };

  const handleStop = async () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      return;
    }
    
    try {
      console.log('🛑 Stopping backend bot for config:', selectedConfig.id);
      
      // Use the simplified TradingService to stop the bot
      await tradingService.stopBot(selectedConfig.id);
      
      // Refresh bot status
      await fetchBackendBotStatus(selectedConfig.id);
      
    } catch (error) {
      console.error('❌ Error stopping bot:', error);
      setOrderStatus({
        type: 'error',
        message: `Failed to stop bot: ${error.message}`
      });
    }
  };

  const handleClone = () => {
    console.log('Cloning config:', selectedConfig);
    // Implementation for cloning the configuration
  };

  const handleReject = () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      return;
    }
    
    console.log('Emergency stop for config:', selectedConfig.id);
    const success = tradingService.emergencyStop(selectedConfig.id);
    if (success) {
      console.log('🚨 Emergency stop activated');
    } else {
      console.error('❌ Failed to emergency stop');
    }
  };

  const handleMarketBuy = async () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      setOrderStatus({ type: 'error', message: 'No configuration selected' });
      return;
    }

    // Use symbol from selectedConfig first, then fallback to config.symbol, then 'NU'
    const symbol = selectedConfig.symbol || config.symbol || 'NU';
    console.log(`🛒 Placing test market buy order for symbol: ${symbol}`);
    setOrderStatus({ type: 'pending', message: `Placing market buy order for ${symbol}...` });

    try {
      const result = await chartService.placeMarketBuyOrder(symbol, 1);
      setOrderStatus({ 
        type: 'success', 
        message: `${symbol} order ${result.message} (Order ID: ${result.order_id})` 
      });
      console.log(`✅ Market buy order successful for ${symbol}:`, result);
      
      // Update bot position state to reflect the test order
      if (selectedConfig?.id) {
        const bot = tradingService.activeBots.get(selectedConfig.id);
        if (bot) {
          // Simulate a position update for the test order
          bot.isBought = true;
          bot.entryPrice = bot.currentPrice || 263.00; // Use current price or default
          bot.sharesEntered = 1; // Test order was for 1 share
          bot.totalPosition = 1;
          bot.openShares = 1;
          
          console.log(`🔄 Updated bot position state for test order:`, {
            isBought: bot.isBought,
            entryPrice: bot.entryPrice,
            sharesEntered: bot.sharesEntered,
            openShares: bot.openShares
          });
          
          // Save test position to localStorage for persistence
          const testPositionData = {
            isBought: true,
            entryPrice: bot.entryPrice,
            sharesEntered: bot.sharesEntered,
            totalPosition: bot.totalPosition,
            openShares: bot.openShares,
            timestamp: Date.now()
          };
          localStorage.setItem(`test_position_${symbol}`, JSON.stringify(testPositionData));
          console.log(`💾 Saved test position to localStorage for ${symbol}`);
          
          // Trigger status update to refresh UI
          bot.notifyStatusChange('test_position_opened');
        }
      }
    } catch (error) {
      setOrderStatus({ 
        type: 'error', 
        message: `Failed to place ${symbol} order: ${error.message}` 
      });
      console.error(`❌ Market buy order failed for ${symbol}:`, error);
    }
  };

  const handleMarketSell = async () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      setOrderStatus({ type: 'error', message: 'No configuration selected' });
      return;
    }

    const symbol = selectedConfig.symbol || config.symbol || 'NU';
    console.log(`🛒 Placing test market sell order for symbol: ${symbol}`);
    console.log(`🔍 ChartService instance:`, chartService);
    console.log(`🔍 ChartService methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(chartService)));
    
    setOrderStatus({ type: 'pending', message: `Placing market sell order for ${symbol}...` });

    try {
      const result = await chartService.placeMarketSellOrder(symbol, 1);
      setOrderStatus({ 
        type: 'success', 
        message: `${symbol} sell order ${result.message} (Order ID: ${result.order_id})` 
      });
      console.log(`✅ Market sell order successful for ${symbol}:`, result);
      
      // Update bot position state to reflect the test sell order
      if (selectedConfig?.id) {
        const bot = tradingService.activeBots.get(selectedConfig.id);
        if (bot && bot.isBought) {
          // Close the position
          bot.isBought = false;
          bot.sharesExited += bot.openShares;
          bot.openShares = 0;
          
          console.log(`🔄 Closed bot position for test sell order:`, {
            isBought: bot.isBought,
            sharesExited: bot.sharesExited,
            openShares: bot.openShares
          });
          
          // Clear test position from localStorage
          localStorage.removeItem(`test_position_${symbol}`);
          console.log(`🗑️ Cleared test position from localStorage for ${symbol}`);
          
          // Trigger status update to refresh UI
          bot.notifyStatusChange('test_position_closed');
        }
      }
    } catch (error) {
      setOrderStatus({ 
        type: 'error', 
        message: `Failed to place ${symbol} sell order: ${error.message}` 
      });
      console.error(`❌ Market sell order failed for ${symbol}:`, error);
    }
  };

  const handleCancelOrders = async () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      setOrderStatus({ type: 'error', message: 'No configuration selected' });
      return;
    }

    // Get the actual bot ID from backendBotStatus
    if (!backendBotStatus?.id) {
      console.warn('No active bot found for this configuration');
      setOrderStatus({ type: 'error', message: 'No active bot found for this configuration' });
      return;
    }

    const botId = backendBotStatus.id;
    const configId = selectedConfig.id;

    console.log(`🛑 Cancel Orders - Config ID: ${configId}, Bot ID: ${botId}`);
    console.log(`🛑 Backend Bot Status:`, backendBotStatus);

    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to cancel ALL pending orders for bot ${botId} (config ${configId})?\n\nThis will cancel:\n- Entry orders\n- Exit orders\n- Stop loss orders\n\nThis action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setOrderStatus({ type: 'pending', message: `Cancelling all orders for bot ${botId}...` });

    try {
      const response = await fetch(`${API_BASE_URL}/bots/${botId}/cancel-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${chartService.getAuthToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setOrderStatus({ 
          type: 'success', 
          message: `${result.message}. Cancelled: ${result.cancelled_orders.join(', ')}` 
        });
        console.log(`✅ Orders cancelled successfully:`, result);
        
        // Refresh bot status to reflect changes
        await fetchBackendBotStatus(selectedConfig.id);
      } else {
        setOrderStatus({ 
          type: 'error', 
          message: result.message || 'Failed to cancel orders' 
        });
        console.error(`❌ Failed to cancel orders:`, result);
      }
      
    } catch (error) {
      setOrderStatus({ 
        type: 'error', 
        message: `Failed to cancel orders: ${error.message}` 
      });
      console.error(`❌ Cancel orders failed:`, error);
    }
  };

  return (
    <div className="bot-config-panel">
      <div className="config-title">
        {selectedConfig ? `${selectedConfig.id} - ${selectedConfig.name}` : 'No Configuration Selected'}
      </div>

      <div className="config-form">
        <div className="form-row">
          <label>Symbol:</label>
          <input
            type="text"
            value={config.symbol}
            onChange={(e) => handleConfigChange('symbol', e.target.value.toUpperCase())}
          />
        </div>

        <div className="form-row">
          <label>Owned by:</label>
          <input
            type="text"
            value={config.ownedBy}
            onChange={(e) => handleConfigChange('ownedBy', e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>Trading Strategy:</label>
          <select
            value={config.trendStrategy || (selectedConfig?.trend_strategy || 'uptrend')}
            onChange={(e) => handleConfigChange('trendStrategy', e.target.value)}
          >
            <option value="uptrend">📈 Uptrend</option>
            <option value="downtrend">📉 Downtrend</option>
          </select>
        </div>

        <div className="form-row">
          <label>Bot published:</label>
          <select
            value={config.botPublished ? 'true' : 'false'}
            onChange={(e) => handleConfigChange('botPublished', e.target.value === 'true')}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>

        <div className="form-row">
          <label>Trade Amount:</label>
          <input
            type="number"
            value={config.tradeAmount || (selectedConfig?.trade_amount || 250)}
            onChange={(e) => handleConfigChange('tradeAmount', parseInt(e.target.value))}
          />
        </div>

        <div className="form-row">
          <label>Trade Equity or Option:</label>
          <select
            value={config.tradeEquityOrOption}
            onChange={(e) => handleConfigChange('tradeEquityOrOption', e.target.value)}
          >
            <option value="Equity">Equity</option>
            <option value="Option">Option</option>
          </select>
        </div>

        <div className="form-row">
          <label>Multi Buy:</label>
          <select
            value={config.multiBuy || (selectedConfig?.multi_buy || 'disabled')}
            onChange={(e) => handleConfigChange('multiBuy', e.target.value)}
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </select>
        </div>
      </div>

      {/* Trading Status Display - Only show when a config is selected */}
      {selectedConfig && (
        <div className="trading-status">
          <div className="status-item">
            <span className="status-label">Bot Active:</span>
            <span className={`status-value ${(backendBotStatus?.is_active) ? 'active' : 'inactive'}`}>
              {(backendBotStatus?.is_active) ? '🟢 Active' : '🔴 Inactive'}
            </span>
          </div>
          
          {/* Bot Status Field */}
          {backendBotStatus && (
            <div className="status-item">
              <span className="status-label">Bot Status:</span>
              <span className={`status-value ${getBotStatusClass(backendBotStatus)}`}>
                {getBotStatusDisplay(backendBotStatus)}
              </span>
            </div>
          )}
          
          {/* Only show additional status if backend bot exists */}
          {backendBotStatus && (
            <>
              {backendBotStatus.stoppedOut && (
                <div className="status-item">
                  <span className="status-label">Stop-Out:</span>
                  <span className="status-value stopped">🚨 Stopped Out</span>
                </div>
              )}
              {backendBotStatus.emergencyBrake && (
                <div className="status-item">
                  <span className="status-label">Emergency:</span>
                  <span className="status-value emergency">🚨 Emergency Stop</span>
                </div>
              )}
            </>
          )}
          
          {/* Position Status Section - Only show if backend bot exists */}
          {backendBotStatus && (
            <div className="status-section">
              <h5>Position Status</h5>
              <div className="status-item">
                <span className="status-label">Position Status:</span>
                <span className={`status-value ${getDetailedPositionStatus(backendBotStatus)}`}>
                  {getDetailedPositionStatus(backendBotStatus)}
                </span>
              </div>
              <div className="status-item">
                <span className="status-label">Shares Entered:</span>
                <span className="status-value">{backendBotStatus?.shares_entered || 0}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Shares Exited:</span>
                <span className="status-value">{backendBotStatus?.shares_exited || 0}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Open Shares:</span>
                <span className="status-value">{backendBotStatus?.open_shares || 0}</span>
              </div>
              {backendBotStatus?.entry_price > 0 && (
                <div className="status-item">
                  <span className="status-label">Entry Price:</span>
                  <span className="status-value">${backendBotStatus?.entry_price.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="action-buttons">
        <button className="save-btn" onClick={handleSave}>Save</button>
        {backendBotStatus?.is_active ? (
          <button className="stop-btn" onClick={handleStop}>Stop</button>
        ) : (
          <button className="start-btn" onClick={handleStart}>Start</button>
        )}
        <button className="clone-btn" onClick={handleClone}>Clone</button>
        <button className="reject-btn" onClick={handleReject}>Emergency</button>
      </div>

      {/* Orders Table - Always visible */}
      {selectedConfig && (
        <div className="trade-history-section">
          <h3>Orders</h3>
          <div className="trade-history-table">
            <table>
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Filled @</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {tradeHistory.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center">
                      No orders yet
                    </td>
                  </tr>
                ) : (
                  tradeHistory.map((trade, index) => (
                    <tr key={index}>
                      <td className={`side ${trade.side.toLowerCase()}`}>
                        {trade.side}
                      </td>
                      <td className={`filled ${trade.filled.toLowerCase()}`}>
                        {trade.filled === 'Yes' ? '✅ Filled' : '⏳ Pending'}
                      </td>
                      <td>{trade.target}</td>
                      <td>
                        {trade.price && trade.price > 0 ? `$${trade.price.toFixed(2)}` : '-'}
                      </td>
                      <td>
                        {trade.filled_at ? 
                          new Date(trade.filled_at).toLocaleString() : 
                          '-'
                        }
                      </td>
                      <td>{trade.shares_filled || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order Status Display */}
      {orderStatus && (
        <div className={`order-status ${orderStatus.type}`}>
          <span className={`status-indicator ${orderStatus.type}`}>
            {orderStatus.type === 'pending' && '⏳'}
            {orderStatus.type === 'success' && '✅'}
            {orderStatus.type === 'error' && '❌'}
          </span>
          {orderStatus.message}
        </div>
      )}
    </div>
  );
};

export default BotConfigPanel;
