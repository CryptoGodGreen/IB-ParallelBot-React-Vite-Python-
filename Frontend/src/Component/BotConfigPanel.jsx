import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (selectedConfig) {
      setConfig(prev => ({
        ...prev,
        name: selectedConfig.name || '',
        symbol: selectedConfig.symbol || 'AAPL'
      }));
    }
  }, [selectedConfig]);

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onConfigUpdate(config);
    // The TradingDashboard will handle saving drawings via the save trigger
  };

  const handleStart = () => {
    console.log('Starting bot for config:', selectedConfig);
    // Implementation for starting the bot
  };

  const handleClone = () => {
    console.log('Cloning config:', selectedConfig);
    // Implementation for cloning the configuration
  };

  const handleReject = () => {
    console.log('Rejecting config:', selectedConfig);
    // Implementation for rejecting the configuration
  };

  console.log('🔍 BotConfigPanel rendering with selectedConfig:', selectedConfig);

  return (
    <div className="bot-config-panel" style={{ border: '2px solid blue', padding: '10px' }}>
      <div style={{ color: 'yellow', fontWeight: 'bold', marginBottom: '10px' }}>
        DEBUG: BotConfigPanel is rendering!
      </div>
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

      <div className="action-buttons">
        <button className="save-btn" onClick={handleSave}>Save</button>
        <button className="start-btn" onClick={handleStart}>Start</button>
        <button className="clone-btn" onClick={handleClone}>Clone</button>
        <button className="reject-btn" onClick={handleReject}>Reject</button>
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
