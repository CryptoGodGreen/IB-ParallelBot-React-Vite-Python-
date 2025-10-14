import { useState, useEffect } from 'react';
import TradingViewWidget from './TradingView';
import ConfigurationPanel from '../ConfigurationPanel';
import BotConfigPanel from '../BotConfigPanel';
import chartService from '../../services/chartService';
import './TradingDashboard.css';

const TradingDashboard = () => {
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [configurations, setConfigurations] = useState([]);
  const [saveTrigger, setSaveTrigger] = useState(0);

  // API calls using chart service
  const fetchConfigurations = async () => {
    try {
      console.log('🔄 Fetching configurations...');
      console.log('🔑 Auth token:', localStorage.getItem('token') ? 'Present' : 'Missing');
      
      const data = await chartService.getCharts();
      console.log('✅ Fetched configurations:', data);
      setConfigurations(data);
    } catch (error) {
      console.error('❌ Error fetching configurations:', error);
      // Fallback to mock data if API fails
      console.log('📝 Using fallback mock data');
      setConfigurations([
        { id: 501, name: 'AAPL 60M', symbol: 'AAPL', interval: '60M', status: 'active' },
        { id: 257, name: 'SPY 15M', symbol: 'SPY', interval: '15M', status: 'stopped' },
      ]);
    }
  };

  const saveConfiguration = async (configData) => {
    try {
      const savedConfig = await chartService.createChart(configData);
      setConfigurations(prev => [...prev, savedConfig]);
      console.log('✅ Configuration saved:', savedConfig);
      return savedConfig;
    } catch (error) {
      console.error('❌ Error saving configuration:', error);
      throw error;
    }
  };

  const updateConfiguration = async (configId, configData) => {
    try {
      const updatedConfig = await chartService.updateChart(configId, configData);
      setConfigurations(prev => 
        prev.map(config => config.id === configId ? updatedConfig : config)
      );
      console.log('✅ Configuration updated:', updatedConfig);
      return updatedConfig;
    } catch (error) {
      console.error('❌ Error updating configuration:', error);
      throw error;
    }
  };

  const loadConfiguration = async (configId) => {
    try {
      const config = await chartService.getChart(configId);
      console.log('📥 Loaded configuration:', config);
      return config;
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      return null;
    }
  };

  const deleteConfiguration = async (configId) => {
    try {
      await chartService.deleteChart(configId);
      setConfigurations(prev => prev.filter(config => config.id !== configId));
      if (selectedConfig?.id === configId) {
        setSelectedConfig(null);
      }
      console.log('✅ Configuration deleted:', configId);
    } catch (error) {
      console.error('❌ Error deleting configuration:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchConfigurations();
  }, []);

  const handleConfigSelect = (config) => {
    setSelectedConfig(config);
    console.log('🎯 Selected configuration:', config);
  };

  const handleConfigSave = async (configData) => {
    console.log('💾 BotConfigPanel Save button clicked');
    if (selectedConfig) {
      console.log('💾 Updating configuration:', selectedConfig.id);
      await updateConfiguration(selectedConfig.id, configData);
      // Trigger drawing save
      console.log('💾 Triggering drawing save...');
      setSaveTrigger(prev => prev + 1);
    } else {
      console.log('💾 Creating new configuration');
      await saveConfiguration(configData);
    }
  };

  const handleConfigCreate = async (configData) => {
    try {
      const savedConfig = await saveConfiguration(configData);
      setSelectedConfig(savedConfig);
      console.log('✅ New configuration created and selected:', savedConfig);
    } catch (error) {
      console.error('❌ Error creating configuration:', error);
      // Don't set as selected if creation failed
    }
  };

  const handleConfigDelete = (configId) => {
    deleteConfiguration(configId);
  };

  const handleSaveDrawings = async (configId, configData) => {
    if (configId && configId !== 'undefined') {
      console.log('🔄 Saving drawings to backend for config:', configId);
      try {
        await updateConfiguration(configId, configData);
        console.log('✅ Drawings saved to backend successfully');
      } catch (error) {
        console.error('❌ Error saving drawings to backend:', error);
      }
    } else {
      console.warn('⚠️ Cannot save drawings: No valid configuration ID');
    }
  };

  const handleLoadDrawings = async (configId) => {
    return await loadConfiguration(configId);
  };

  return (
    <div className="trading-dashboard">
      {/* Main Content Area */}
      <div className="dashboard-main">
        {/* Left: BotConfigPanel */}
        <div className="dashboard-left">
          <BotConfigPanel
            selectedConfig={selectedConfig}
            onConfigUpdate={handleConfigSave}
            onSaveDrawings={handleSaveDrawings}
            onLoadDrawings={handleLoadDrawings}
          />
        </div>

        {/* Center: TradingView Chart */}
        <div className="dashboard-center">
          <TradingViewWidget
            selectedConfig={selectedConfig}
            onSaveDrawings={handleSaveDrawings}
            onLoadDrawings={handleLoadDrawings}
            onSaveRequested={saveTrigger}
          />
        </div>

        {/* Right: Configuration List */}
        <div className="dashboard-right">
          <ConfigurationPanel
            configurations={configurations}
            selectedConfig={selectedConfig}
            onConfigSelect={handleConfigSelect}
            onConfigCreate={handleConfigCreate}
            onConfigDelete={handleConfigDelete}
          />
        </div>
      </div>
    </div>
  );
};

export default TradingDashboard;
