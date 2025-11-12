import { useState, useEffect, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import './CurrentBots.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const CurrentBots = () => {
  const [bots, setBots] = useState([]);
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'desc' });
  const [hiddenBots, setHiddenBots] = useState(new Set());
  const [excludedBots, setExcludedBots] = useState(new Set());

  // Fetch bots and charts
  useEffect(() => {
    fetchBots();
    fetchCharts();
    
    // Set up polling to refresh bots list every 15 seconds
    const interval = setInterval(() => {
      fetchBots();
    }, 15000); // Update every 15 seconds
    
    return () => clearInterval(interval);
  }, []);

  const fetchBots = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/bots/list`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      }
    } catch (error) {
      console.error('Error fetching bots:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCharts = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/charts/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setCharts(data);
      }
    } catch (error) {
      console.error('Error fetching charts:', error);
    }
  };

  // Filter and sort bots
  const filteredAndSortedBots = useMemo(() => {
    // Filter: only active and running bots, and not hidden
    let filtered = bots.filter(bot => 
      bot.is_active && 
      bot.is_running && 
      !hiddenBots.has(bot.id)
    );
    
    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(bot => 
        bot.id.toString().includes(term) ||
        bot.symbol.toLowerCase().includes(term) ||
        bot.name?.toLowerCase().includes(term) ||
        bot.config_id.toString().includes(term)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (sortConfig.key === 'created_at') {
        const aDate = new Date(aVal);
        const bDate = new Date(bVal);
        return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return sortConfig.direction === 'asc' 
        ? (aVal || 0) - (bVal || 0)
        : (bVal || 0) - (aVal || 0);
    });

    return filtered;
  }, [bots, searchTerm, sortConfig, hiddenBots]);

  // Get chart info for a bot
  const getChartInfo = (configId) => {
    return charts.find(chart => chart.id === configId);
  };

  // Get creator (for now, default to 'admin' since we don't have user email in chart)
  const getCreator = (configId) => {
    const chart = getChartInfo(configId);
    return chart ? 'admin' : 'admin'; // Default to admin
  };

  // Get published status
  const getPublished = (configId) => {
    const chart = getChartInfo(configId);
    // Assuming published is based on some field - for now default to 'No'
    return 'No';
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  };

  // Format symbol with interval
  const formatSymbol = (bot, chart) => {
    if (chart && chart.interval) {
      return `${bot.symbol} ${chart.interval}`;
    }
    return bot.symbol;
  };

  // Handle sort
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Get sort icon
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <FaSort className="sort-icon" />;
    }
    return sortConfig.direction === 'asc' 
      ? <FaSortUp className="sort-icon active" />
      : <FaSortDown className="sort-icon active" />;
  };

  // Handle display toggle
  const handleDisplayToggle = (botId) => {
    setHiddenBots(prev => {
      const newSet = new Set(prev);
      if (newSet.has(botId)) {
        newSet.delete(botId);
      } else {
        newSet.add(botId);
      }
      return newSet;
    });
    // TODO: Add API call to persist hide state
  };

  // Handle bot report exclude
  const handleExclude = (botId) => {
    setExcludedBots(prev => {
      const newSet = new Set(prev);
      if (newSet.has(botId)) {
        newSet.delete(botId);
      } else {
        newSet.add(botId);
      }
      return newSet;
    });
    // TODO: Add API call to persist exclude state
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="text-center">Loading bots...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="current-bots-header">
        <div>
          <h1 className="page-title">Current Bots</h1>
          <p className="page-description">View and manage currently active trading bots</p>
        </div>
        <div className="search-box">
          <label>Search:</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by ID, symbol, or name..."
          />
        </div>
      </div>

      <div className="bots-table-container">
        <table className="bots-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('id')} className="sortable">
                <span className="sort-content">ID {getSortIcon('id')}</span>
              </th>
              <th onClick={() => handleSort('symbol')} className="sortable">
                <span className="sort-content">Symbol {getSortIcon('symbol')}</span>
              </th>
              <th onClick={() => handleSort('created_at')} className="sortable">
                <span className="sort-content">Date Created {getSortIcon('created_at')}</span>
              </th>
              <th onClick={() => handleSort('config_id')} className="sortable">
                <span className="sort-content">Creator {getSortIcon('config_id')}</span>
              </th>
              <th onClick={() => handleSort('status')} className="sortable">
                <span className="sort-content">Status {getSortIcon('status')}</span>
              </th>
              <th>Published</th>
              <th>Tick Time</th>
              <th>Display</th>
              <th>Bot Report</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedBots.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-center">
                  No active bots found
                </td>
              </tr>
            ) : (
              filteredAndSortedBots.map((bot) => {
                const chart = getChartInfo(bot.config_id);
                return (
                  <tr key={bot.id}>
                    <td className="id-cell">{bot.id}</td>
                    <td>{formatSymbol(bot, chart)}</td>
                    <td>{formatDate(bot.created_at)}</td>
                    <td>{getCreator(bot.config_id)}</td>
                    <td>
                      <span className={`status-badge ${bot.status?.toLowerCase() || 'active'}`}>
                        {bot.status === 'ACTIVE' && bot.is_running ? 'Running' : 
                         bot.status === 'COMPLETED' ? 'Completed' :
                         bot.status === 'HARD_STOPPED_OUT' ? 'Stopped' : 'Not started'}
                      </span>
                    </td>
                    <td>{getPublished(bot.config_id)}</td>
                    <td>-</td>
                    <td>
                      <button 
                        className={`action-btn hide-btn ${hiddenBots.has(bot.id) ? 'active' : ''}`}
                        onClick={() => handleDisplayToggle(bot.id)}
                      >
                        {hiddenBots.has(bot.id) ? 'Show' : 'Hide'}
                      </button>
                    </td>
                    <td>
                      <button 
                        className={`action-btn exclude-btn ${excludedBots.has(bot.id) ? 'active' : ''}`}
                        onClick={() => handleExclude(bot.id)}
                      >
                        {excludedBots.has(bot.id) ? 'Include' : 'Exclude'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CurrentBots;
