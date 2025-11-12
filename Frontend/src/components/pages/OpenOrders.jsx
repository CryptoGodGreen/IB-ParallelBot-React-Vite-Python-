import { useState, useEffect, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaSync } from 'react-icons/fa';
import ConfirmModal from '../common/ConfirmModal';
import toast from 'react-hot-toast';
import './CurrentBots.css';
import '../pages/Configuration.css';

const logger = console; // Use console as logger for debugging

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const OpenOrders = () => {
  const [orders, setOrders] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [positionsSearchTerm, setPositionsSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'order_id', direction: 'desc' });
  const [positionsSortConfig, setPositionsSortConfig] = useState({ key: 'symbol', direction: 'asc' });
  const [error, setError] = useState(null);
  const [positionsError, setPositionsError] = useState(null);
  const [cancellingOrders, setCancellingOrders] = useState(new Set());
  const [cancelModal, setCancelModal] = useState({ isOpen: false, orderId: null, order: null });
  
  // Limit order form state
  const [limitOrderForm, setLimitOrderForm] = useState({
    symbol: '',
    limitPrice: '',
    quantity: 1
  });
  const [submitting, setSubmitting] = useState(false);
  const [closingAll, setClosingAll] = useState(false);
  
  // Market order form state
  const [marketOrderForm, setMarketOrderForm] = useState({
    symbol: '',
    quantity: 1
  });
  const [submittingMarket, setSubmittingMarket] = useState(false);

  // Fetch open orders
  useEffect(() => {
    fetchOpenOrders();
    fetchPositions();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      fetchOpenOrders();
      fetchPositions();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchOpenOrders = async () => {
    try {
      setError(null);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/orders/open`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const ordersList = data.orders || [];
        setOrders(ordersList);
        logger.info(`✅ Loaded ${ordersList.length} open orders`, ordersList);
        
        // Log details if no orders found but count > 0
        if (ordersList.length === 0 && data.count > 0) {
          logger.warn(`⚠️ API returned count=${data.count} but orders array is empty`);
        }
      } else if (response.status === 503) {
        setError('IBKR not connected');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.detail || 'Failed to fetch open orders');
        logger.error('Failed to fetch open orders:', errorData);
      }
    } catch (error) {
      console.error('Error fetching open orders:', error);
      setError(error.message || 'Failed to fetch open orders');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort orders
  const filteredAndSortedOrders = useMemo(() => {
    let filtered = [...orders];
    
    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(order => 
        order.order_id?.toString().includes(term) ||
        order.symbol?.toLowerCase().includes(term) ||
        order.contract_display?.toLowerCase().includes(term) ||
        order.action?.toLowerCase().includes(term) ||
        order.order_type?.toLowerCase().includes(term)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (sortConfig.key === 'order_id') {
        return sortConfig.direction === 'asc' 
          ? (aVal || 0) - (bVal || 0)
          : (bVal || 0) - (aVal || 0);
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' 
          ? aVal - bVal
          : bVal - aVal;
      }
      
      return sortConfig.direction === 'asc' 
        ? (aVal || 0) - (bVal || 0)
        : (bVal || 0) - (aVal || 0);
    });

    return filtered;
  }, [orders, searchTerm, sortConfig]);

  // Format price
  const formatPrice = (price) => {
    if (price === null || price === undefined) return '-';
    return `$${parseFloat(price).toFixed(2)}`;
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

  // Get status badge class
  const getStatusClass = (status) => {
    const statusLower = (status || '').toLowerCase();
    if (statusLower.includes('filled')) return 'running';
    if (statusLower.includes('pending') || statusLower.includes('pre')) return 'active';
    if (statusLower.includes('cancelled') || statusLower.includes('cancel')) return 'stopped';
    return 'active';
  };

  // Handle cancel order button click - open modal
  const handleCancelOrderClick = (order) => {
    if (!order || !order.order_id) {
      alert('Invalid order');
      return;
    }
    setCancelModal({ isOpen: true, orderId: order.order_id, order });
  };

  // Handle cancel confirmation from modal
  const handleCancelOrderConfirm = async () => {
    const { orderId, order } = cancelModal;
    
    if (!orderId) {
      return;
    }

    setCancellingOrders(prev => new Set(prev).add(orderId));

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        logger.info(`✅ Order ${orderId} cancelled successfully`);
        // Close modal first
        setCancelModal({ isOpen: false, orderId: null, order: null });
        // Refresh the orders list
        await fetchOpenOrders();
      } else {
        logger.error(`❌ Failed to cancel order ${orderId}:`, data);
        alert(data.detail || `Failed to cancel order ${orderId}`);
      }
    } catch (error) {
      logger.error(`❌ Error cancelling order ${orderId}:`, error);
      alert(`Error cancelling order: ${error.message}`);
    } finally {
      setCancellingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  };

  // Handle modal close
  const handleCancelModalClose = () => {
    setCancelModal({ isOpen: false, orderId: null, order: null });
  };

  // Fetch positions
  const fetchPositions = async () => {
    try {
      setPositionsError(null);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/orders/positions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const positionsList = data.positions || [];
        setPositions(positionsList);
        logger.info(`✅ Loaded ${positionsList.length} positions`, positionsList);
      } else if (response.status === 503) {
        setPositionsError('IBKR not connected');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setPositionsError(errorData.detail || 'Failed to fetch positions');
        logger.error('Failed to fetch positions:', errorData);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositionsError(error.message || 'Failed to fetch positions');
    } finally {
      setPositionsLoading(false);
    }
  };

  // Filter and sort positions
  const filteredAndSortedPositions = useMemo(() => {
    let filtered = [...positions];
    
    // Filter by search term
    if (positionsSearchTerm) {
      const term = positionsSearchTerm.toLowerCase();
      filtered = filtered.filter(position => 
        position.symbol?.toLowerCase().includes(term) ||
        position.contract_display?.toLowerCase().includes(term) ||
        position.sec_type?.toLowerCase().includes(term)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[positionsSortConfig.key];
      const bVal = b[positionsSortConfig.key];
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return positionsSortConfig.direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return positionsSortConfig.direction === 'asc' 
          ? aVal - bVal
          : bVal - aVal;
      }
      
      return positionsSortConfig.direction === 'asc' 
        ? (aVal || 0) - (bVal || 0)
        : (bVal || 0) - (aVal || 0);
    });

    return filtered;
  }, [positions, positionsSearchTerm, positionsSortConfig]);

  // Handle positions sort
  const handlePositionsSort = (key) => {
    setPositionsSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Get positions sort icon
  const getPositionsSortIcon = (key) => {
    if (positionsSortConfig.key !== key) {
      return <FaSort className="sort-icon" />;
    }
    return positionsSortConfig.direction === 'asc' 
      ? <FaSortUp className="sort-icon active" />
      : <FaSortDown className="sort-icon active" />;
  };

  // Format currency
  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    return num >= 0 ? `$${num.toFixed(2)}` : `-$${Math.abs(num).toFixed(2)}`;
  };

  // Check if order can be cancelled (not filled, not cancelled)
  const canCancelOrder = (order) => {
    const statusLower = (order.status || '').toLowerCase();
    return !statusLower.includes('filled') && 
           !statusLower.includes('cancelled') && 
           !statusLower.includes('cancel') &&
           (order.remaining || 0) > 0;
  };

  // Handle limit order submit
  const handleLimitOrderSubmit = async (action) => {
    // Validate form
    if (!limitOrderForm.symbol || !limitOrderForm.limitPrice || !limitOrderForm.quantity) {
      toast.error('Please fill in all fields');
      return;
    }

    const limitPrice = parseFloat(limitOrderForm.limitPrice);
    const quantity = parseInt(limitOrderForm.quantity);

    if (isNaN(limitPrice) || limitPrice <= 0) {
      toast.error('Please enter a valid limit price');
      return;
    }

    if (isNaN(quantity) || quantity <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const endpoint = action === 'BUY' ? '/orders/limit-buy' : '/orders/limit-sell';
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbol: limitOrderForm.symbol.toUpperCase(),
          quantity: quantity,
          limit_price: limitPrice
        }),
      });

      const data = await response.json().catch(() => ({ detail: 'Failed to parse response' }));

      if (response.ok) {
        toast.success(data.message || `Limit ${action.toLowerCase()} order placed successfully! Order ID: ${data.order_id || 'N/A'}`);
        // Clear form
        setLimitOrderForm({
          symbol: '',
          limitPrice: '',
          quantity: 1
        });
        // Refresh orders list
        await fetchOpenOrders();
        // Log for debugging
        logger.info(`✅ Order placed successfully:`, data);
      } else {
        toast.error(data.detail || `Failed to place ${action.toLowerCase()} order`);
        logger.error(`❌ Order placement failed:`, data);
      }
    } catch (error) {
      logger.error(`Error placing limit ${action.toLowerCase()} order:`, error);
      toast.error(`Failed to place ${action.toLowerCase()} order: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle market order submit
  const handleCloseAllLimitOrders = async () => {
    const symbol = limitOrderForm.symbol.trim().toUpperCase();
    if (!symbol) {
      toast.error('Enter a symbol to close limit orders');
      return;
    }

    setClosingAll(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/orders/limit-close-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ symbol })
      });

      const data = await response.json().catch(() => ({ detail: 'Failed to parse response' }));

      if (response.ok) {
        toast.success(data.message || `Closed limit orders for ${symbol}`);
        await fetchOpenOrders();
      } else {
        toast.error(data.detail || `Failed to close limit orders for ${symbol}`);
      }
    } catch (error) {
      toast.error(`Failed to close limit orders: ${error.message}`);
    } finally {
      setClosingAll(false);
    }
  };

  const handleMarketOrderSubmit = async (action) => {
    // Validate form
    if (!marketOrderForm.symbol || !marketOrderForm.quantity) {
      toast.error('Please fill in all fields');
      return;
    }

    const quantity = parseInt(marketOrderForm.quantity);

    if (isNaN(quantity) || quantity <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    setSubmittingMarket(true);
    try {
      const token = localStorage.getItem('token');
      const endpoint = action === 'BUY' ? '/orders/market-buy' : '/orders/market-sell';
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbol: marketOrderForm.symbol.toUpperCase(),
          quantity: quantity
        }),
      });

      const data = await response.json().catch(() => ({ detail: 'Failed to parse response' }));

      if (response.ok) {
        toast.success(data.message || `Market ${action.toLowerCase()} order placed successfully! Order ID: ${data.order_id || 'N/A'}`);
        // Clear form
        setMarketOrderForm({
          symbol: '',
          quantity: 1
        });
        // Refresh orders list
        await fetchOpenOrders();
        // Log for debugging
        logger.info(`✅ Market order placed successfully:`, data);
      } else {
        toast.error(data.detail || `Failed to place ${action.toLowerCase()} order`);
        logger.error(`❌ Market order placement failed:`, data);
      }
    } catch (error) {
      logger.error(`Error placing market ${action.toLowerCase()} order:`, error);
      toast.error(`Failed to place ${action.toLowerCase()} order: ${error.message}`);
    } finally {
      setSubmittingMarket(false);
    }
  };

  if (loading && orders.length === 0 && positionsLoading && positions.length === 0) {
    return (
      <div className="page-container">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="current-bots-header">
        <div>
          <h1 className="page-title">Open Orders</h1>
          <p className="page-description">
            Monitor and manage all open orders from IB account
            {!loading && !error && (
              <span style={{ marginLeft: '12px', color: '#94a3b8', fontSize: '14px' }}>
                ({orders.length} {orders.length === 1 ? 'order' : 'orders'})
              </span>
            )}
          </p>
          {error && (
            <div style={{ color: '#ef4444', marginTop: '8px', fontSize: '14px' }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="search-box">
            <label>Search:</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by order ID, symbol, or action..."
            />
          </div>
          <button
            onClick={fetchOpenOrders}
            className="action-btn"
            style={{
              padding: '8px 16px',
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Refresh orders"
          >
            <FaSync /> Refresh
          </button>
        </div>
      </div>

      <div className="bots-table-container">
        <table className="bots-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('order_id')} className="sortable">
                <span className="sort-content">Order ID {getSortIcon('order_id')}</span>
              </th>
              <th onClick={() => handleSort('contract_display')} className="sortable">
                <span className="sort-content">Symbol {getSortIcon('contract_display')}</span>
              </th>
              <th onClick={() => handleSort('action')} className="sortable">
                <span className="sort-content">Action {getSortIcon('action')}</span>
              </th>
              <th onClick={() => handleSort('order_type')} className="sortable">
                <span className="sort-content">Type {getSortIcon('order_type')}</span>
              </th>
              <th onClick={() => handleSort('total_quantity')} className="sortable">
                <span className="sort-content">Quantity {getSortIcon('total_quantity')}</span>
              </th>
              <th onClick={() => handleSort('filled')} className="sortable">
                <span className="sort-content">Filled {getSortIcon('filled')}</span>
              </th>
              <th onClick={() => handleSort('remaining')} className="sortable">
                <span className="sort-content">Remaining {getSortIcon('remaining')}</span>
              </th>
              <th onClick={() => handleSort('limit_price')} className="sortable">
                <span className="sort-content">Limit Price {getSortIcon('limit_price')}</span>
              </th>
              <th onClick={() => handleSort('status')} className="sortable">
                <span className="sort-content">Status {getSortIcon('status')}</span>
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedOrders.length === 0 ? (
              <tr>
                <td colSpan="10" className="text-center">
                  {error ? error : 'No open orders found'}
                </td>
              </tr>
            ) : (
              filteredAndSortedOrders.map((order) => {
                const isCancelling = cancellingOrders.has(order.order_id);
                const canCancel = canCancelOrder(order);
                
                return (
                  <tr key={order.order_id}>
                    <td className="id-cell">{order.order_id || '-'}</td>
                    <td>{order.contract_display || order.symbol || '-'}</td>
                    <td>
                      <span style={{
                        color: order.action === 'BUY' ? '#22c55e' : '#ef4444',
                        fontWeight: 600
                      }}>
                        {order.action || '-'}
                      </span>
                    </td>
                    <td>{order.order_type || '-'}</td>
                    <td>{order.total_quantity || 0}</td>
                    <td>{order.filled || 0}</td>
                    <td>{order.remaining || 0}</td>
                    <td>{formatPrice(order.limit_price)}</td>
                    <td>
                      <span className={`status-badge ${getStatusClass(order.status)}`}>
                        {order.status || 'Unknown'}
                      </span>
                    </td>
                    <td>
                      {canCancel && (
                        <button
                          onClick={() => handleCancelOrderClick(order)}
                          disabled={isCancelling}
                          style={{
                            padding: '6px 12px',
                            background: isCancelling ? '#6b7280' : '#ef4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isCancelling ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                            fontWeight: 500,
                            opacity: isCancelling ? 0.6 : 1,
                            transition: 'opacity 0.2s'
                          }}
                          title={isCancelling ? 'Cancelling...' : `Cancel order ${order.order_id}`}
                        >
                          {isCancelling ? 'Cancelling...' : 'Cancel'}
                        </button>
                      )}
                      {!canCancel && (
                        <span style={{ color: '#6b7280', fontSize: '13px' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Positions Section */}
      <div style={{ marginTop: '40px' }}>
        <div className="current-bots-header">
          <div>
            <h2 className="page-title" style={{ fontSize: '24px' }}>Account Positions</h2>
            <p className="page-description">
              All assets currently held in the IB account
              {!positionsLoading && !positionsError && (
                <span style={{ marginLeft: '12px', color: '#94a3b8', fontSize: '14px' }}>
                  ({positions.length} {positions.length === 1 ? 'position' : 'positions'})
                </span>
              )}
            </p>
            {positionsError && (
              <div style={{ color: '#ef4444', marginTop: '8px', fontSize: '14px' }}>
                {positionsError}
              </div>
            )}
          </div>
          <div className="search-box">
            <label>Search:</label>
            <input
              type="text"
              value={positionsSearchTerm}
              onChange={(e) => setPositionsSearchTerm(e.target.value)}
              placeholder="Search by symbol..."
            />
          </div>
        </div>

        <div className="bots-table-container">
          <table className="bots-table">
            <thead>
              <tr>
                <th onClick={() => handlePositionsSort('contract_display')} className="sortable">
                  <span className="sort-content">Symbol {getPositionsSortIcon('contract_display')}</span>
                </th>
                <th onClick={() => handlePositionsSort('sec_type')} className="sortable">
                  <span className="sort-content">Type {getPositionsSortIcon('sec_type')}</span>
                </th>
                <th onClick={() => handlePositionsSort('position')} className="sortable">
                  <span className="sort-content">Position {getPositionsSortIcon('position')}</span>
                </th>
                <th onClick={() => handlePositionsSort('avg_cost')} className="sortable">
                  <span className="sort-content">Avg Cost {getPositionsSortIcon('avg_cost')}</span>
                </th>
                <th onClick={() => handlePositionsSort('market_price')} className="sortable">
                  <span className="sort-content">Market Price {getPositionsSortIcon('market_price')}</span>
                </th>
                <th onClick={() => handlePositionsSort('market_value')} className="sortable">
                  <span className="sort-content">Market Value {getPositionsSortIcon('market_value')}</span>
                </th>
                <th onClick={() => handlePositionsSort('unrealized_pnl')} className="sortable">
                  <span className="sort-content">Unrealized P&L {getPositionsSortIcon('unrealized_pnl')}</span>
                </th>
                <th onClick={() => handlePositionsSort('realized_pnl')} className="sortable">
                  <span className="sort-content">Realized P&L {getPositionsSortIcon('realized_pnl')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedPositions.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center">
                    {positionsError ? positionsError : (positionsLoading ? 'Loading positions...' : 'No positions found')}
                  </td>
                </tr>
              ) : (
                filteredAndSortedPositions.map((position, index) => {
                  const isPositive = (position.unrealized_pnl || 0) >= 0;
                  const isPositiveRealized = (position.realized_pnl || 0) >= 0;
                  
                  return (
                    <tr key={`${position.symbol}_${position.sec_type}_${index}`}>
                      <td>{position.contract_display || position.symbol || '-'}</td>
                      <td>{position.sec_type || '-'}</td>
                      <td style={{ 
                        color: (position.position || 0) > 0 ? '#22c55e' : (position.position || 0) < 0 ? '#ef4444' : '#94a3b8',
                        fontWeight: 600
                      }}>
                        {position.position || 0}
                      </td>
                      <td>{formatCurrency(position.avg_cost)}</td>
                      <td>{formatCurrency(position.market_price)}</td>
                      <td>{formatCurrency(position.market_value)}</td>
                      <td style={{ 
                        color: isPositive ? '#22c55e' : '#ef4444',
                        fontWeight: 600
                      }}>
                        {formatCurrency(position.unrealized_pnl)}
                      </td>
                      <td style={{ 
                        color: isPositiveRealized ? '#22c55e' : '#ef4444',
                        fontWeight: 600
                      }}>
                        {formatCurrency(position.realized_pnl)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submit Limit Orders Section */}
      <div className="limit-order-box" style={{ marginTop: '40px' }}>
        <h2 className="config-section-title">Submit Limit Orders</h2>
        <p className="config-section-description">
          Submit limit buy or sell orders to your IB account
        </p>
        
        <div className="limit-order-form">
          <div className="form-group">
            <label htmlFor="symbol">Symbol</label>
            <input
              id="symbol"
              type="text"
              value={limitOrderForm.symbol}
              onChange={(e) => setLimitOrderForm(prev => ({ ...prev, symbol: e.target.value }))}
              placeholder="e.g., AAPL"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="limitPrice">Limit Price</label>
            <input
              id="limitPrice"
              type="number"
              step="0.01"
              min="0"
              value={limitOrderForm.limitPrice}
              onChange={(e) => setLimitOrderForm(prev => ({ ...prev, limitPrice: e.target.value }))}
              placeholder="0.00"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              type="number"
              min="1"
              value={limitOrderForm.quantity}
              onChange={(e) => setLimitOrderForm(prev => ({ ...prev, quantity: e.target.value }))}
              placeholder="1"
              className="form-input"
            />
          </div>

          <div className="form-actions">
            <button
              onClick={() => handleLimitOrderSubmit('BUY')}
              disabled={submitting}
              className="limit-order-btn buy-btn"
            >
              {submitting ? 'Submitting...' : 'Buy'}
            </button>
            <button
              onClick={() => handleLimitOrderSubmit('SELL')}
              disabled={submitting}
              className="limit-order-btn sell-btn"
            >
              {submitting ? 'Submitting...' : 'Sell'}
            </button>
            <button
              onClick={handleCloseAllLimitOrders}
              disabled={closingAll}
              className="limit-order-btn"
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}
            >
              {closingAll ? 'Closing...' : 'Close All Limit Orders'}
            </button>
          </div>
        </div>
      </div>

      {/* Submit Market Orders Section */}
      <div className="limit-order-box" style={{ marginTop: '40px' }}>
        <h2 className="config-section-title">Submit Market Orders</h2>
        <p className="config-section-description">
          Submit market buy or sell orders to your IB account
        </p>
        
        <div className="limit-order-form">
          <div className="form-group">
            <label htmlFor="marketSymbol">Symbol</label>
            <input
              id="marketSymbol"
              type="text"
              value={marketOrderForm.symbol}
              onChange={(e) => setMarketOrderForm(prev => ({ ...prev, symbol: e.target.value }))}
              placeholder="e.g., AAPL"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="marketQuantity">Quantity</label>
            <input
              id="marketQuantity"
              type="number"
              min="1"
              value={marketOrderForm.quantity}
              onChange={(e) => setMarketOrderForm(prev => ({ ...prev, quantity: e.target.value }))}
              placeholder="1"
              className="form-input"
            />
          </div>

          <div className="form-actions">
            <button
              onClick={() => handleMarketOrderSubmit('BUY')}
              disabled={submittingMarket}
              className="limit-order-btn buy-btn"
            >
              {submittingMarket ? 'Submitting...' : 'Buy'}
            </button>
            <button
              onClick={() => handleMarketOrderSubmit('SELL')}
              disabled={submittingMarket}
              className="limit-order-btn sell-btn"
            >
              {submittingMarket ? 'Submitting...' : 'Sell'}
            </button>
          </div>
        </div>
      </div>

      {/* Cancel Order Confirmation Modal */}
      {cancelModal.isOpen && (
        <ConfirmModal
          isOpen={cancelModal.isOpen}
          onClose={handleCancelModalClose}
          onConfirm={handleCancelOrderConfirm}
          title="Cancel Order"
          message={
            cancelModal.order
              ? `Are you sure you want to cancel order ${cancelModal.orderId}?

Symbol: ${cancelModal.order.contract_display || cancelModal.order.symbol || 'N/A'}
Action: ${cancelModal.order.action || 'N/A'}
Quantity: ${cancelModal.order.total_quantity || 0}
Remaining: ${cancelModal.order.remaining || 0}
Limit Price: ${cancelModal.order.limit_price ? `$${cancelModal.order.limit_price.toFixed(2)}` : 'N/A'}

This action cannot be undone.`
              : `Are you sure you want to cancel order ${cancelModal.orderId}?

This action cannot be undone.`
          }
          confirmText="Cancel Order"
          cancelText="Keep Order"
          type="danger"
        />
      )}
    </div>
  );
};

export default OpenOrders;
