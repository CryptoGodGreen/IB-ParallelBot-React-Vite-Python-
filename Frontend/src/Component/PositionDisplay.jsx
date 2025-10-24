import React from 'react';
import './PositionDisplay.css';

const PositionDisplay = ({ position, onClose }) => {
  // Determine position status with more detail
  const getPositionStatus = () => {
    if (!position) return '⚪ NO POSITION';
    
    // Check for hard stop-out first
    if (position.hardStopTriggered) {
      return '🚨 HARD STOP';
    }
    
    if (position.isBought) {
      const openShares = position.openShares || 0;
      const sharesEntered = position.sharesEntered || 0;
      const sharesExited = position.sharesExited || 0;
      
      if (openShares <= 0) {
        return '🔴 SOLD_100%';
      } else if (sharesExited > 0) {
        const exitPercentage = sharesEntered > 0 ? (sharesExited / sharesEntered) * 100 : 0;
        return `🟡 SOLD_${exitPercentage.toFixed(0)}%`;
      } else {
        return '🟢 LONG';
      }
    } else {
      return '⚪ NO POSITION';
    }
  };

  // Always show market status regardless of bot state
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
          <span className="value">${position?.currentPrice?.toFixed(2) || '0.00'}</span>
        </div>
        
        <div className="position-row">
          <span className="label">IB Status:</span>
          <span className="value">{position?.isActive ? '🟢 Connected' : '🔴 Disconnected'}</span>
        </div>
        
        <div className="position-row">
          <span className="label">Market Context:</span>
          <span className="value">{position?.marketContext || 'Neutral'}</span>
        </div>
        
        {position?.isBought ? (
          <>
            <div className="position-row">
              <span className="label">Shares:</span>
              <span className="value">{position.openShares || 0}</span>
            </div>
            
            <div className="position-row">
              <span className="label">Entry Price:</span>
              <span className="value">${(position.entryPrice || 0).toFixed(2)}</span>
            </div>
            
            <div className="position-row">
              <span className="label">Position Value:</span>
              <span className="value">${((position.currentPrice || 0) * (position.openShares || 0)).toFixed(2)}</span>
            </div>
            
            <div className="position-row">
              <span className="label">P&L:</span>
              <span className={`value ${((position.currentPrice - position.entryPrice) * (position.openShares || 0)) >= 0 ? 'profit' : 'loss'}`}>
                ${((position.currentPrice - position.entryPrice) * (position.openShares || 0)).toFixed(2)} ({position.entryPrice > 0 ? (((position.currentPrice - position.entryPrice) / position.entryPrice) * 100).toFixed(2) : 'N/A'}%)
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
