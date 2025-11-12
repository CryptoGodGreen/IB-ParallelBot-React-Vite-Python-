import { useState, useEffect } from 'react';
import chartService from '../../services/chartService';
import toast from 'react-hot-toast';
import './Configuration.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const Configuration = () => {
  const [configurations, setConfigurations] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Bot configuration state
  const [botConfig, setBotConfig] = useState({
    email_updates: true,
    default_trade_size: 10000,
    stop_loss_5m: 5.0,
    stop_loss_minutes_5m: 5,
    hard_stop_5m: 5.0,
    stop_loss_15m: 5.0,
    stop_loss_minutes_15m: 5,
    hard_stop_15m: 5.0,
    stop_loss_1h: 5.0,
    stop_loss_minutes_1h: 5,
    hard_stop_1h: 5.0,
    symbols: 'AAPL,SPY,TSLA,MSFT,GOOGL,EUR,CAD'
  });
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    fetchConfigurations();
    fetchBotConfig();
  }, []);

  const fetchConfigurations = async () => {
    try {
      const data = await chartService.getCharts();
      setConfigurations(data);
    } catch (error) {
      console.error('Error fetching configurations:', error);
      toast.error('Failed to load configurations');
    } finally {
      setLoading(false);
    }
  };

  const fetchBotConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/bot-config`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setBotConfig(data);
      }
    } catch (error) {
      console.error('Error fetching bot config:', error);
    }
  };

  const handleBotConfigChange = (field, value) => {
    setBotConfig(prev => ({
      ...prev,
      [field]: field === 'email_updates' ? value : (field.includes('minutes') || field === 'default_trade_size' ? parseFloat(value) || 0 : parseFloat(value) || 0)
    }));
  };

  const handleUpdateBotConfig = async () => {
    setSavingConfig(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/bot-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(botConfig),
      });

      if (response.ok) {
        toast.success('Bot configuration updated successfully!');
        await fetchBotConfig();
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        toast.error(errorData.detail || 'Failed to update bot configuration');
      }
    } catch (error) {
      console.error('Error updating bot config:', error);
      toast.error(`Failed to update bot configuration: ${error.message}`);
    } finally {
      setSavingConfig(false);
    }
  };


  if (loading) {
    return (
      <div className="page-container">
        <div className="text-center">Loading configurations...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">Configuration</h1>
        <p className="page-description">System configuration and settings</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
        {/* Left Column: Bot Configuration */}
        <div className="bot-config-box">
          <h2 className="config-section-title">Bot Configuration</h2>
          
          <div className="bot-config-form">
            {/* Email Updates */}
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={botConfig.email_updates}
                  onChange={(e) => handleBotConfigChange('email_updates', e.target.checked)}
                />
                <span style={{ marginLeft: '8px' }}>Email Updates</span>
              </label>
            </div>

            {/* Default Trade Size */}
            <div className="form-group">
              <label htmlFor="default_trade_size">Default trade size</label>
              <input
                id="default_trade_size"
                type="number"
                step="0.01"
                min="0"
                value={botConfig.default_trade_size}
                onChange={(e) => handleBotConfigChange('default_trade_size', e.target.value)}
                className="form-input"
              />
            </div>

            {/* 5m Settings */}
            <div className="interval-group">
              <h3 className="interval-title">5m</h3>
              <div className="form-group">
                <label htmlFor="stop_loss_5m">5m stop loss</label>
                <input
                  id="stop_loss_5m"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.stop_loss_5m}
                  onChange={(e) => handleBotConfigChange('stop_loss_5m', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="stop_loss_minutes_5m">5m stop loss minutes</label>
                <input
                  id="stop_loss_minutes_5m"
                  type="number"
                  min="0"
                  value={botConfig.stop_loss_minutes_5m}
                  onChange={(e) => handleBotConfigChange('stop_loss_minutes_5m', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="hard_stop_5m">5m hard stop</label>
                <input
                  id="hard_stop_5m"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.hard_stop_5m}
                  onChange={(e) => handleBotConfigChange('hard_stop_5m', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* 15m Settings */}
            <div className="interval-group">
              <h3 className="interval-title">15m</h3>
              <div className="form-group">
                <label htmlFor="stop_loss_15m">15m stop loss</label>
                <input
                  id="stop_loss_15m"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.stop_loss_15m}
                  onChange={(e) => handleBotConfigChange('stop_loss_15m', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="stop_loss_minutes_15m">15m stop loss minutes</label>
                <input
                  id="stop_loss_minutes_15m"
                  type="number"
                  min="0"
                  value={botConfig.stop_loss_minutes_15m}
                  onChange={(e) => handleBotConfigChange('stop_loss_minutes_15m', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="hard_stop_15m">15m hard stop loss</label>
                <input
                  id="hard_stop_15m"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.hard_stop_15m}
                  onChange={(e) => handleBotConfigChange('hard_stop_15m', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* 1h Settings */}
            <div className="interval-group">
              <h3 className="interval-title">1h</h3>
              <div className="form-group">
                <label htmlFor="stop_loss_1h">1h stop loss</label>
                <input
                  id="stop_loss_1h"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.stop_loss_1h}
                  onChange={(e) => handleBotConfigChange('stop_loss_1h', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="stop_loss_minutes_1h">1h stop loss minutes</label>
                <input
                  id="stop_loss_minutes_1h"
                  type="number"
                  min="0"
                  value={botConfig.stop_loss_minutes_1h}
                  onChange={(e) => handleBotConfigChange('stop_loss_minutes_1h', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="hard_stop_1h">1h hard stop</label>
                <input
                  id="hard_stop_1h"
                  type="number"
                  step="0.1"
                  min="0"
                  value={botConfig.hard_stop_1h}
                  onChange={(e) => handleBotConfigChange('hard_stop_1h', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdateBotConfig}
              disabled={savingConfig}
              className="update-bot-config-btn"
            >
              {savingConfig ? 'Updating...' : 'Update Bot configuration'}
            </button>
          </div>
        </div>

        {/* Right Column: Symbols List */}
        <div className="symbols-box">
          <h2 className="config-section-title">Symbols</h2>
          <div className="symbols-list">
            {botConfig.symbols.split(',').map((symbol, index) => (
              <div key={index} className="symbol-item">
                {symbol.trim()}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Configurations List */}
      <div className="config-list-container" style={{ marginTop: '24px' }}>
        <h2 className="config-section-title">Configurations</h2>
        {configurations.length === 0 ? (
          <div className="text-center" style={{ padding: '40px', color: '#64748b' }}>
            No configurations found
          </div>
        ) : (
          <div className="config-list">
            {configurations.map((config) => (
              <div key={config.id} className="config-item">
                <div className="config-item-main">
                  <div className="config-item-id">ID: {config.id}</div>
                  <div className="config-item-name">{config.name || config.symbol}</div>
                  <div className="config-item-symbol">{config.symbol} {config.interval}</div>
                </div>
                <div className="config-item-meta">
                  <span className="config-item-strategy">
                    {config.trend_strategy || 'uptrend'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Configuration;
