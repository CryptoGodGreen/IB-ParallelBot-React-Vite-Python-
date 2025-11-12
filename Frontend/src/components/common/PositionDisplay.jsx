import React from 'react';
import './PositionDisplay.css';

const PositionDisplay = ({ position, onClose }) => {
  const status = position?.status || position?.bot_status || '';
  const multiBuyRaw = position?.multi_buy ?? position?.multiBuy ?? 'disabled';
  const multiBuy = typeof multiBuyRaw === 'string' ? multiBuyRaw.toLowerCase() : multiBuyRaw ? 'enabled' : 'disabled';
  const openShares = position?.openShares ?? position?.open_shares ?? 0;
  const sharesEntered = position?.sharesEntered ?? position?.shares_entered ?? 0;
  const sharesExited = position?.sharesExited ?? position?.shares_exited ?? 0;
  const positionSize = position?.positionSize ?? position?.position_size ?? 0;
  const hardStopTriggered = position?.hardStopTriggered ?? position?.hard_stop_triggered ?? false;
  const isBoughtExplicit = position?.isBought ?? position?.is_bought;
  const inferredIsBought = isBoughtExplicit !== undefined ? isBoughtExplicit : (openShares > 0 || sharesEntered > 0);
  const isBought = Boolean(inferredIsBought);

  const getPositionStatus = () => {
    if (!position) return '⚪ NO POSITION';

    if (hardStopTriggered) {
      return '🚨 HARD STOP';
    }

    if (isBought) {
      if (openShares <= 0) {
        return '🔴 SOLD_100%';
      } else if (sharesExited > 0 && sharesEntered > 0) {
        const exitPercentage = (sharesExited / sharesEntered) * 100;
        return `🟡 SOLD_${exitPercentage.toFixed(0)}%`;
      } else if (multiBuy === 'enabled' && sharesEntered > 0 && positionSize > 0) {
        const buyPercentage = (sharesEntered / positionSize) * 100;
        if (buyPercentage >= 87.5) return '🟢 BUY_100%';
        if (buyPercentage >= 62.5) return '🟢 BUY_75%';
        if (buyPercentage >= 37.5) return '🟢 BUY_50%';
        if (buyPercentage >= 12.5) return '🟢 BUY_25%';
        return '🟢 BUY_25%';
      } else {
        return '🟢 LONG';
      }
    } else {
      if (status?.startsWith?.('BUY_')) {
        return `🟢 ${status}`;
      }
      if ((sharesEntered > 0 || openShares > 0) && multiBuy === 'enabled') {
        const buyPercentage = positionSize > 0 ? (sharesEntered / positionSize) * 100 : 0;
        if (buyPercentage >= 87.5) return '🟢 BUY_100%';
        if (buyPercentage >= 62.5) return '🟢 BUY_75%';
        if (buyPercentage >= 37.5) return '🟢 BUY_50%';
        if (buyPercentage >= 12.5) return '🟢 BUY_25%';
        return '🟢 BUY_25%';
      }
      return '⚪ NO POSITION';
    }
  };

  const currentPrice = (position?.currentPrice ?? position?.current_price) || 0;
  const entryPrice = (position?.entryPrice ?? position?.entry_price) || 0;
  const pnl = (currentPrice - entryPrice) * openShares;
  const pnlPercent = entryPrice > 0 ? (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2) : 'N/A';
  const pnlClass = pnl >= 0 ? 'profit' : 'loss';
  const isActive = position?.isActive ?? position?.is_active ?? false;

  return (
    <div className="position-display">
      <div className="position-header">
        <div className="position-title">
          <span className="symbol">{position?.symbol || 'AAPL'}</span>
          <span className="status">{getPositionStatus()}</span>
        </div>
        <div className="position-meta">
          <span className="timestamp">Updated: {position?.updatedAt ? new Date(position.updatedAt).toLocaleTimeString() : 'Never'}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="position-details">
        <div className="position-row">
          <span className="label">Current Price:</span>
          <span className="value">${currentPrice.toFixed(2)}</span>
        </div>

        <div className="position-row">
          <span className="label">IB Status:</span>
          <span className="value">{isActive ? '🟢 Connected' : '🔴 Disconnected'}</span>
        </div>

        <div className="position-row">
          <span className="label">Market Context:</span>
          <span className="value">{position?.marketContext || 'Neutral'}</span>
        </div>

        {isBought || sharesEntered > 0 ? (
          <>
            <div className="position-row">
              <span className="label">Shares:</span>
              <span className="value">{openShares}</span>
            </div>

            <div className="position-row">
              <span className="label">Entry Price:</span>
              <span className="value">${entryPrice.toFixed(2)}</span>
            </div>

            <div className="position-row">
              <span className="label">Position Value:</span>
              <span className="value">${(currentPrice * openShares).toFixed(2)}</span>
            </div>

            <div className="position-row">
              <span className="label">P&L:</span>
              <span className={`value ${pnlClass}`}>
                ${pnl.toFixed(2)} ({pnlPercent}%)
              </span>
            </div>
          </>
        ) : (
          <div className="position-row">
            <span className="label">Status:</span>
            <span className="value">No position</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PositionDisplay;
