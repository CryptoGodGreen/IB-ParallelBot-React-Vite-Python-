import { useState, useEffect } from 'react';
import tradingService from '../services/trading/TradingService.js';
import chartService from '../services/chartService.js';
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
    symbol: 'AAPL',
    ownedBy: 'admin',
    marketDirection: 'Uptrend',
    botPublished: false,
    tradeAmount: 1000,
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
      if (openShares <= 0) {
        return '🔴 SOLD_100%';
      } else if (sharesExited > 0 && sharesEntered > 0) {
        // Calculate actual percentage dynamically based on shares sold
        const exitPercentage = (sharesExited / sharesEntered) * 100;
        return `🟡 SOLD_${exitPercentage.toFixed(0)}%`;
      } else {
        // Multi-buy partial fill handling
        if (multiBuy === 'enabled' && sharesEntered > 0 && positionSize > 0) {
          // Calculate actual percentage dynamically based on shares entered
          const buyPercentage = (sharesEntered / positionSize) * 100;
          return `🟢 BUY_${buyPercentage.toFixed(0)}%`;
        }
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
      setConfig(prev => ({
        ...prev,
        name: selectedConfig.name || '',
        symbol: selectedConfig.symbol || 'AAPL'
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
    const interval = setInterval(() => {
      fetchBackendBotStatus(selectedConfig.id);
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
      interval: selectedConfig?.interval || '1M', // Use interval from selectedConfig or default to 1M
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
      bot_hard_stop_out: config.botHardStopOut || '5', // Hard stop-out percentage (default 5%)
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
            value={config.trendStrategy || 'uptrend'}
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
          <label>Trade Amount (USD):</label>
          <input
            type="number"
            value={config.tradeAmount}
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
          <label>Bot Stop Out Time (min):</label>
          <input
            type="number"
            value={config.botStopOutTime}
            onChange={(e) => handleConfigChange('botStopOutTime', parseInt(e.target.value))}
          />
        </div>

        <div className="form-row">
          <label>Bot Hard Stop Out %:</label>
          <input
            type="text"
            value={config.botHardStopOut}
            onChange={(e) => handleConfigChange('botHardStopOut', e.target.value)}
            placeholder="5"
          />
        </div>

        <div className="form-row">
          <label>Multi Buy:</label>
          <select
            value={config.multiBuy || 'disabled'}
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

      {/* Trade History Table */}
      {tradeHistory.length > 0 && (
        <div className="trade-history-section">
          <h3>Trade History</h3>
          <div className="trade-history-table">
            <table>
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Filled</th>
                  <th>Target</th>
                  <th>Filled @</th>
                  <th>Shares Filled</th>
                </tr>
              </thead>
              <tbody>
                {tradeHistory.map((trade, index) => (
                  <tr key={index}>
                    <td className={`side ${trade.side.toLowerCase()}`}>
                      {trade.side}
                    </td>
                    <td className={`filled ${trade.filled.toLowerCase()}`}>
                      {trade.filled}
                    </td>
                    <td>{trade.target}</td>
                    <td>
                      {trade.filled_at ? 
                        new Date(trade.filled_at).toLocaleString() : 
                        'Pending'
                      }
                    </td>
                    <td>{trade.shares_filled}</td>
                  </tr>
                ))}
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
