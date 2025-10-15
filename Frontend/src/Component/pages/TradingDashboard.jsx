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

  const handleConfigSelect = async (config) => {
    console.log('🎯 Config clicked:', config.id);
    // Fetch full configuration data from backend to ensure we have layout_data
    const fullConfig = await loadConfiguration(config.id);
    if (fullConfig) {
      setSelectedConfig(fullConfig);
      console.log('🎯 Selected configuration with full data:', fullConfig);
    } else {
      // Fallback to the config from the list if fetch fails
      setSelectedConfig(config);
      console.log('⚠️ Using config from list (no full data):', config);
    }
  };

  const handleConfigSave = async (configData) => {
    console.log('💾 BotConfigPanel Save button clicked');
    console.log('💾 selectedConfig:', selectedConfig);
    console.log('💾 configData:', configData);
    
    if (selectedConfig && selectedConfig.id) {
      console.log('💾 Updating configuration:', selectedConfig.id);
      const updatedConfig = await updateConfiguration(selectedConfig.id, configData);
      // Update selectedConfig with the response
      setSelectedConfig(updatedConfig);
      // Trigger drawing save (which will reload the config with fresh data)
      console.log('💾 Triggering drawing save...');
      setSaveTrigger(prev => prev + 1);
    } else {
      console.log('💾 Creating new configuration (selectedConfig is null or has no id)');
      console.log('💾 selectedConfig value:', selectedConfig);
      try {
        const newConfig = await saveConfiguration(configData);
        setSelectedConfig(newConfig);
      } catch (error) {
        console.error('💾 Error creating new configuration:', error);
        throw error; // Re-throw to let the UI handle the error
      }
    }
  };

  const handleConfigCreate = async (configData) => {
    try {
      const savedConfig = await saveConfiguration(configData);
      // Ensure layout_data is initialized
      if (!savedConfig.layout_data) {
        savedConfig.layout_data = {
          entry_line: null,
          exit_line: null,
          tpsl_settings: null,
          bot_configuration: null,
          other_drawings: null
        };
      }
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
    console.log('🔍 handleSaveDrawings called for config:', configId);
    console.log('🔍 Call stack:', new Error().stack);
    
    if (configId && configId !== 'undefined') {
      // Check if this config is still selected before saving
      if (selectedConfig?.id !== configId) {
        console.warn(`⚠️ Config ${configId} is no longer selected, skipping backend save`);
        return;
      }
      
      console.log('🔄 Saving drawings to backend for config:', configId);
      try {
        // PUT request and wait for it to complete
        const updatedConfig = await updateConfiguration(configId, configData);
        console.log('✅ Drawings saved to backend successfully');
        console.log('✅ Using PUT response data (no additional GET needed)');
        
        // Use the response from PUT directly - it already has the saved data
        if (updatedConfig && selectedConfig && selectedConfig.id === configId) {
          console.log('🔍 Updated config layout_data:', updatedConfig.layout_data);
          console.log('🔍 Entry line:', updatedConfig.layout_data?.entry_line);
          console.log('🔍 Exit line:', updatedConfig.layout_data?.exit_line);
          setSelectedConfig(updatedConfig);
          console.log('✅ Selected config updated with saved data from PUT response');
        }
        
        return updatedConfig;
      } catch (error) {
        console.error('❌ Error saving drawings to backend:', error);
        throw error;
      }
    } else {
      console.warn('⚠️ Cannot save drawings: No valid configuration ID');
    }
  };

  const handleLoadDrawings = async (configId) => {
    console.log('📥 TradingDashboard: Loading drawings for config:', configId);
    const result = await loadConfiguration(configId);
    console.log('📥 TradingDashboard: Load result:', result);
    return result;
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
