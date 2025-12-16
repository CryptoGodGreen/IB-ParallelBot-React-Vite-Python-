import { useState, useEffect } from 'react';
import './Status.css';
import ConfirmModal from '../common/ConfirmModal';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const Status = () => {
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Fetch status from API
  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/system/status`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        // During restart, 502/503 errors are expected
        if (isRestarting && (response.status === 502 || response.status === 503)) {
          return; // Suppress error during restart
        }
        throw new Error('Failed to fetch status');
      }

      const data = await response.json();
      setStatusData(data);
      setError(null);
      setLastUpdate(new Date());

      // Check if all services are healthy after restart
      if (isRestarting && data.overall_status === 'healthy') {
        setIsRestarting(false);
      }
    } catch (err) {
      // Suppress errors during restart
      if (!isRestarting) {
        setError(err.message);
      }
      console.error('Error fetching status:', err);
    } finally {
      setLoading(false);
    }
  };

  // Poll every 10s (5s during restart)
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, isRestarting ? 5000 : 10000);
    return () => clearInterval(interval);
  }, [isRestarting]);

  // Handle restart confirmation
  const handleRestartConfirm = async () => {
    try {
      setIsRestarting(true);
      setShowConfirmModal(false);

      const response = await fetch(`${API_BASE_URL}/system/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ confirm: true })
      });

      if (!response.ok) {
        throw new Error('Restart request failed');
      }

      // Poll every 5s until all services are healthy (max 5 minutes)
      const startTime = Date.now();
      const checkInterval = setInterval(async () => {
        await fetchStatus();

        // Stop if healthy or timeout after 5 minutes
        if (statusData?.overall_status === 'healthy' || Date.now() - startTime > 300000) {
          clearInterval(checkInterval);
          if (statusData?.overall_status !== 'healthy') {
            setError('Restart timeout - services may still be starting');
          }
          setIsRestarting(false);
        }
      }, 5000);

    } catch (err) {
      setError(err.message);
      setIsRestarting(false);
    }
  };

  // Format uptime display
  const formatUptime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return '#10b981'; // Green
      case 'unhealthy':
        return '#ef4444'; // Red
      case 'degraded':
        return '#f59e0b'; // Yellow
      default:
        return '#6b7280'; // Gray
    }
  };

  // Service card component
  const ServiceCard = ({ name, displayName, icon, data }) => {
    if (!data) return null;

    return (
      <div className="service-card">
        <div className="service-header">
          <div className="service-icon">{icon}</div>
          <div className="service-name-group">
            <h3 className="service-name">{displayName}</h3>
            <div className="service-subtitle">{name}</div>
          </div>
          <div
            className="status-indicator"
            style={{ backgroundColor: getStatusColor(data.status) }}
            title={data.status}
          />
        </div>

        <div className="service-details">
          <div className="detail-row">
            <span className="detail-label">Status:</span>
            <span className={`detail-value status-${data.status}`}>
              {data.status}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Connection:</span>
            <span className="detail-value">{data.connection_status}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Uptime:</span>
            <span className="detail-value">{formatUptime(data.uptime_seconds)}</span>
          </div>

          {/* Additional details */}
          {data.details && Object.keys(data.details).length > 0 && (
            <div className="detail-row">
              <span className="detail-label">Details:</span>
              <span className="detail-value detail-small">
                {Object.entries(data.details).map(([key, value]) => {
                  // Skip error field if status is healthy
                  if (key === 'error' && data.status === 'healthy') return null;
                  // Format key nicely
                  const formattedKey = key.replace(/_/g, ' ');
                  return (
                    <div key={key}>
                      {formattedKey}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}
                    </div>
                  );
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading && !statusData) {
    return (
      <div className="page-container">
        <h1 className="page-title">System Status</h1>
        <div className="loading-state">Loading system status...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="status-header">
        <div>
          <h1 className="page-title">System Status</h1>
          <p className="page-description">Monitor container health and system performance</p>
        </div>
        <div className="status-header-actions">
          {lastUpdate && (
            <div className="last-update">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
          <button
            onClick={fetchStatus}
            className="refresh-button"
            disabled={isRestarting}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && !isRestarting && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

      {isRestarting && (
        <div className="restart-banner">
          🔄 System restart in progress... Services will be unavailable for ~60 seconds.
        </div>
      )}

      {statusData && (
        <>
          <div className="services-grid">
            <ServiceCard
              name="postgres"
              displayName="PostgreSQL"
              icon="🗄️"
              data={statusData.services.postgres}
            />
            <ServiceCard
              name="redis"
              displayName="Redis"
              icon="⚡"
              data={statusData.services.redis}
            />
            <ServiceCard
              name="ib_gateway"
              displayName="IB Gateway"
              icon="📊"
              data={statusData.services.ib_gateway}
            />
            <ServiceCard
              name="fastapi"
              displayName="API Server"
              icon="🚀"
              data={statusData.services.fastapi}
            />
          </div>

          <div className="actions-section">
            <button
              onClick={() => setShowConfirmModal(true)}
              className="restart-button"
              disabled={isRestarting}
            >
              {isRestarting ? (
                <>
                  <span className="spinner"></span>
                  Restarting...
                </>
              ) : (
                <>
                  🔄 Restart All Containers
                </>
              )}
            </button>
          </div>

          <div className="overall-status">
            <div
              className="overall-indicator"
              style={{ backgroundColor: getStatusColor(statusData.overall_status) }}
            />
            <span>Overall Status: <strong>{statusData.overall_status}</strong></span>
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={handleRestartConfirm}
        type="danger"
        title="Restart All Containers?"
        message="This will restart PostgreSQL, Redis, IB Gateway, and the API server. All connections will be interrupted for approximately 60 seconds. Are you sure you want to proceed?"
        confirmText="Restart Now"
        cancelText="Cancel"
      />
    </div>
  );
};

export default Status;

