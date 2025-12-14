import { useState, useEffect } from "react";
import "./Report.css";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const Report = () => {
  const [tradeHistory, setTradeHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAllTradeHistory();
  }, []);

  const fetchAllTradeHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE_URL}/bots/all/trade-history`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch trade history");
      }

      const data = await response.json();
      setTradeHistory(data);
    } catch (err) {
      console.error("Error fetching trade history:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Group transactions by bot
  const groupTransactionsByBot = () => {
    const grouped = {};
    
    tradeHistory.forEach((trade) => {
      const botKey = trade.bot_id || trade.bot_config_id || 'unknown';
      if (!grouped[botKey]) {
        grouped[botKey] = {
          bot_id: trade.bot_id,
          bot_config_id: trade.bot_config_id,
          bot_name: trade.bot_name || `Bot ${trade.bot_id || trade.bot_config_id}`,
          bot_symbol: trade.bot_symbol || '-',
          transactions: []
        };
      }
      grouped[botKey].transactions.push(trade);
    });
    
    // Sort transactions within each group by filled_at (most recent first)
    Object.values(grouped).forEach((group) => {
      group.transactions.sort((a, b) => {
        const timeA = a.filled_at ? new Date(a.filled_at).getTime() : 0;
        const timeB = b.filled_at ? new Date(b.filled_at).getTime() : 0;
        return timeB - timeA;
      });
    });
    
    return grouped;
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Report</h1>
      <p className="page-description">Trading performance reports and analytics</p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button onClick={fetchAllTradeHistory} className="refresh-button">
          🔄 Refresh
        </button>
      </div>

      {loading && (
        <div className="loading-state">
          <p>Loading trade history...</p>
        </div>
      )}

      {error && (
        <div className="error-state">
          <p>Error: {error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="trade-history-section">
          {tradeHistory.length === 0 ? (
            <div className="text-center">
              <p>No transactions yet</p>
            </div>
          ) : (
            Object.values(groupTransactionsByBot()).map((group) => (
              <div key={group.bot_id || group.bot_config_id} className="bot-group">
                <div className="bot-group-header">
                  <div className="bot-group-title">
                    <span className="bot-name">{group.bot_name}</span>
                    <span className="bot-symbol">({group.bot_symbol})</span>
                  </div>
                  <span className="bot-group-count">
                    {group.transactions.length} transaction{group.transactions.length !== 1 ? 's' : ''}
                  </span>
                </div>
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
                      {group.transactions.map((trade, index) => (
                        <tr key={index}>
                          <td className={`side ${trade.side?.toLowerCase()}`}>
                            {trade.side}
                          </td>
                          <td className={`filled ${trade.filled?.toLowerCase()}`}>
                            {trade.filled === "Yes" ? "✅ Filled" : trade.filled === "Pending" ? "⏳ Pending" : trade.filled || "-"}
                          </td>
                          <td>{trade.target || "-"}</td>
                          <td>
                            {trade.price ? `$${Number(trade.price).toFixed(2)}` : "-"}
                          </td>
                          <td>
                            {trade.filled_at
                              ? new Date(trade.filled_at).toLocaleString()
                              : "-"}
                          </td>
                          <td>{trade.shares_filled || trade.quantity || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Report;
