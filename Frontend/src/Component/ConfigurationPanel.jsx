import { useState, useEffect } from 'react';
import './ConfigurationPanel.css';

const ConfigurationPanel = ({ 
  configurations = [],
  selectedConfig, 
  onConfigSelect, 
  onConfigSave, 
  onConfigCreate,
  onConfigDelete 
}) => {
  const [showNewConfigForm, setShowNewConfigForm] = useState(false);
  const [newConfig, setNewConfig] = useState({
    name: '',
    symbol: 'AAPL',
    interval: '1D'
  });

  const handleConfigSelect = (config) => {
    onConfigSelect(config);
  };

  const handleCreateConfig = async () => {
    console.log('🔧 ConfigurationPanel: Create button clicked');
    console.log('🔧 New config data:', newConfig);
    
    if (newConfig.name && newConfig.symbol) {
      const configData = {
        name: newConfig.name,
        symbol: newConfig.symbol,
        interval: newConfig.interval,
        rth: true,
        layout_data: {
          drawings: [],
          timestamp: Date.now()
        }
      };
      
      console.log('🔧 Calling onConfigCreate with:', configData);
      setNewConfig({ name: '', symbol: 'AAPL', interval: '1D' });
      setShowNewConfigForm(false);
      onConfigCreate(configData);
    } else {
      console.log('⚠️ ConfigurationPanel: Missing name or symbol');
    }
  };

  const handleDeleteConfig = (configId) => {
    console.log('🗑️ ConfigurationPanel: Delete button clicked for config:', configId);
    if (window.confirm('Are you sure you want to delete this configuration?')) {
      console.log('🗑️ Calling onConfigDelete with:', configId);
      onConfigDelete(configId);
    }
  };

  return (
    <div className="config-panel">
      <div className="config-header">
        <h3>Configurations</h3>
        <button 
          className="add-config-btn"
          onClick={() => setShowNewConfigForm(!showNewConfigForm)}
        >
          +
        </button>
      </div>

      {showNewConfigForm && (
        <div className="new-config-form">
          <input
            type="text"
            placeholder="Configuration Name"
            value={newConfig.name}
            onChange={(e) => setNewConfig(prev => ({ ...prev, name: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Symbol"
            value={newConfig.symbol}
            onChange={(e) => setNewConfig(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
          />
          <select
            value={newConfig.interval}
            onChange={(e) => setNewConfig(prev => ({ ...prev, interval: e.target.value }))}
          >
            <option value="1M">1 Minute</option>
            <option value="5M">5 Minutes</option>
            <option value="15M">15 Minutes</option>
            <option value="30M">30 Minutes</option>
            <option value="1H">1 Hour</option>
            <option value="4H">4 Hours</option>
            <option value="1D">1 Day</option>
            <option value="1W">1 Week</option>
          </select>
          <div className="form-buttons">
            <button onClick={handleCreateConfig} className="save-btn">Create</button>
            <button onClick={() => setShowNewConfigForm(false)} className="cancel-btn">Cancel</button>
          </div>
        </div>
      )}

      <div className="config-list">
        {configurations.map((config) => (
          <div
            key={config.id}
            className={`config-item ${selectedConfig?.id === config.id ? 'selected' : ''} active`}
            onClick={() => handleConfigSelect(config)}
          >
            <div className="config-info">
              <div className="config-id">{config.id}</div>
              <div className="config-name">{config.name}</div>
              <div className="config-details">{config.symbol} {config.interval}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteConfig(config.id);
              }}
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConfigurationPanel;
