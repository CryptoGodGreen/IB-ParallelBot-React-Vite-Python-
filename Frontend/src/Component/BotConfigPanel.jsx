import { useState, useEffect } from 'react';
import tradingService from '../services/trading/TradingService.js';
import './BotConfigPanel.css';

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
    multiEntryLine: 'Yes',
    botPublished: false,
    tradeAmount: 1000,
    tradeEquityOrOption: 'Equity',
    botStopOutTime: 240,
    botHardStopOut: '',
    lastQuoteReceived: '',
    buyPrice: '',
    sellPrice: ''
  });

  const [trades, setTrades] = useState([]);
  const [tradingStatus, setTradingStatus] = useState(null);
  const [botStatus, setBotStatus] = useState(null);

  useEffect(() => {
    if (selectedConfig) {
      setConfig(prev => ({
        ...prev,
        name: selectedConfig.name || '',
        symbol: selectedConfig.symbol || 'AAPL'
      }));
      
      // Get bot status for this configuration
      const status = tradingService.getBotStatus(selectedConfig.id);
      setBotStatus(status);
    }
  }, [selectedConfig]);

  // Monitor bot status updates
  useEffect(() => {
    if (!selectedConfig?.id) return;

    const interval = setInterval(() => {
      const status = tradingService.getBotStatus(selectedConfig.id);
      if (status) {
        setBotStatus(status);
      }
    }, 2000); // Reduced frequency from 1000ms to 2000ms

    return () => clearInterval(interval);
  }, [selectedConfig?.id]);

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onConfigUpdate(config);
    // The TradingDashboard will handle saving drawings via the save trigger
  };

  const handleStart = () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      return;
    }
    
    console.log('Starting bot for config:', selectedConfig.id);
    const success = tradingService.startTrading(selectedConfig.id);
    if (success) {
      console.log('✅ Bot started successfully');
    } else {
      console.error('❌ Failed to start bot');
    }
  };

  const handleStop = () => {
    if (!selectedConfig?.id) {
      console.warn('No configuration selected');
      return;
    }
    
    console.log('Stopping bot for config:', selectedConfig.id);
    const success = tradingService.stopTrading(selectedConfig.id);
    if (success) {
      console.log('⏹️ Bot stopped successfully');
    } else {
      console.error('❌ Failed to stop bot');
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
          <label>Market Direction:</label>
          <select
            value={config.marketDirection}
            onChange={(e) => handleConfigChange('marketDirection', e.target.value)}
          >
            <option value="Uptrend">Uptrend</option>
            <option value="Downtrend">Downtrend</option>
            <option value="Sideways">Sideways</option>
          </select>
        </div>

        <div className="form-row">
          <label>Multi-Entry Line:</label>
          <select
            value={config.multiEntryLine}
            onChange={(e) => handleConfigChange('multiEntryLine', e.target.value)}
          >
            <option value="Yes">Yes</option>
            <option value="No">No</option>
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
            placeholder=""
          />
        </div>

        <div className="form-row">
          <label>Last Quote Received:</label>
          <input
            type="text"
            value={config.lastQuoteReceived}
            onChange={(e) => handleConfigChange('lastQuoteReceived', e.target.value)}
            placeholder=""
          />
        </div>

        <div className="form-row">
          <label>Buy Price:</label>
          <input
            type="text"
            value={config.buyPrice}
            onChange={(e) => handleConfigChange('buyPrice', e.target.value)}
            placeholder=""
          />
        </div>

        <div className="form-row">
          <label>Sell Price:</label>
          <input
            type="text"
            value={config.sellPrice}
            onChange={(e) => handleConfigChange('sellPrice', e.target.value)}
            placeholder=""
          />
        </div>
      </div>

      {/* Trading Status Display */}
      {botStatus && (
        <div className="trading-status">
          <div className="status-item">
            <span className="status-label">Status:</span>
            <span className={`status-value ${botStatus.isActive ? 'active' : 'inactive'}`}>
              {botStatus.isActive ? '🟢 Active' : '🔴 Inactive'}
            </span>
          </div>
          {botStatus.stoppedOut && (
            <div className="status-item">
              <span className="status-label">Stop-Out:</span>
              <span className="status-value stopped">🚨 Stopped Out</span>
            </div>
          )}
          {botStatus.emergencyBrake && (
            <div className="status-item">
              <span className="status-label">Emergency:</span>
              <span className="status-value emergency">🚨 Emergency Stop</span>
            </div>
          )}
          <div className="status-item">
            <span className="status-label">Position:</span>
            <span className="status-value">{botStatus.totalPosition || 0}</span>
          </div>
          {botStatus.currentPrice > 0 && (
            <div className="status-item">
              <span className="status-label">Price:</span>
              <span className="status-value">${botStatus.currentPrice.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <div className="action-buttons">
        <button className="save-btn" onClick={handleSave}>Save</button>
        {botStatus?.isActive ? (
          <button className="stop-btn" onClick={handleStop}>Stop</button>
        ) : (
          <button className="start-btn" onClick={handleStart}>Start</button>
        )}
        <button className="clone-btn" onClick={handleClone}>Clone</button>
        <button className="reject-btn" onClick={handleReject}>Emergency</button>
      </div>

      <div className="trades-section">
        <div className="trades-header">
          <div>Side</div>
          <div>Filled</div>
          <div>Target</div>
          <div>Filled @</div>
          <div>Shares Filled</div>
        </div>
        <div className="trades-list">
          {trades.length === 0 ? (
            <div className="no-trades">No trades yet</div>
          ) : (
            trades.map((trade, index) => (
              <div key={index} className="trade-row">
                <div>{trade.side}</div>
                <div>{trade.filled ? '✓' : '✗'}</div>
                <div>{trade.target}</div>
                <div>{trade.filledAt}</div>
                <div>{trade.shares}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default BotConfigPanel;
