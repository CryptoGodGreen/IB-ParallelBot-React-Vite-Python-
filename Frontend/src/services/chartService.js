const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ChartService {
  // Centralized error handler for API responses
  async handleApiResponse(response) {
    if (response.status === 401) {
      console.error('🔒 Unauthorized - token expired or invalid');
      this.clearInvalidToken();
      throw new Error('Authentication failed. Please log in again.');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', response.status, response.statusText, errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response;
  }

  // Get all charts for the current user
  async getCharts() {
    try {
      const token = this.getAuthToken();
      console.log('🔑 Using auth token:', token ? 'Token present' : 'No token');
      
      const response = await fetch(`${API_BASE_URL}/charts/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      await this.handleApiResponse(response);
      return await response.json();
    } catch (error) {
      console.error('Error fetching charts:', error);
      throw error;
    }
  }

  // Get a specific chart by ID
  async getChart(chartId) {
    try {
      const token = this.getAuthToken();
      console.log('🔑 Using auth token for getChart:', token ? 'Token present' : 'No token');
      console.log('🔗 Making request to:', `${API_BASE_URL}/charts/${chartId}`);
      console.log('🔗 Request headers:', {
        'Authorization': `Bearer ${token ? token.substring(0, 20) + '...' : 'No token'}`
      });
      
      const response = await fetch(`${API_BASE_URL}/charts/${chartId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log('📡 Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        console.error('❌ API Error:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Error details:', errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching chart:', error);
      throw error;
    }
  }

  // Create a new chart
  async createChart(chartData) {
    try {
      console.log('📤 Creating chart with data:', chartData);
      const response = await fetch(`${API_BASE_URL}/charts/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`,
        },
        body: JSON.stringify(chartData),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Chart creation failed:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error creating chart:', error);
      throw error;
    }
  }

  // Update an existing chart
  async updateChart(chartId, chartData) {
    try {
      const response = await fetch(`${API_BASE_URL}/charts/${chartId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`,
        },
        body: JSON.stringify(chartData),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error updating chart:', error);
      throw error;
    }
  }

  // Delete a chart
  async deleteChart(chartId) {
    try {
      const response = await fetch(`${API_BASE_URL}/charts/${chartId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting chart:', error);
      throw error;
    }
  }

  // Save drawings to a chart
  async saveDrawings(chartId, drawings) {
    try {
      const chartData = {
        layout_data: {
          drawings: drawings,
          timestamp: Date.now()
        }
      };
      
      return await this.updateChart(chartId, chartData);
    } catch (error) {
      console.error('Error saving drawings:', error);
      throw error;
    }
  }

  // Load drawings from a chart
  async loadDrawings(chartId) {
    try {
      const chart = await this.getChart(chartId);
      return chart.layout_data?.drawings || [];
    } catch (error) {
      console.error('Error loading drawings:', error);
      throw error;
    }
  }

  // Test authentication by making a simple API call
  async testAuth() {
    try {
      const token = this.getAuthToken();
      console.log('🧪 Testing authentication...');
      
      if (!token) {
        console.error('🧪 Auth test failed: No token found');
        this.clearInvalidToken();
        return false;
      }
      
      const response = await fetch(`${API_BASE_URL}/charts/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log('🧪 Auth test response:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('🧪 Auth test successful, got charts:', data.length);
        return true;
      } else {
        const errorText = await response.text();
        console.error('🧪 Auth test failed:', errorText);
        
        if (response.status === 401) {
          console.log('🔧 Token is invalid/expired, clearing it...');
          this.clearInvalidToken();
        }
        
        return false;
      }
    } catch (error) {
      console.error('🧪 Auth test error:', error);
      return false;
    }
  }

  // Clear invalid token and redirect to login
  clearInvalidToken() {
    console.log('🧹 Clearing invalid token from localStorage...');
    localStorage.removeItem('token');
    console.log('🧹 Token cleared. Please log in again.');
    
    // Show alert to user
    alert('Your session has expired. Please log in again.');
    
    // Redirect to login page
    if (window.location.pathname !== '/login') {
      console.log('🔄 Redirecting to login page...');
      window.location.href = '/login';
    }
  }

  // Check if token is expired and handle accordingly
  checkTokenExpiration() {
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.error('❌ NO TOKEN FOUND! You need to log in.');
      this.clearInvalidToken();
      return false;
    }
    
    try {
      // Try to decode JWT token to check if it's valid
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('❌ Invalid JWT format - should have 3 parts separated by dots');
        this.clearInvalidToken();
        return false;
      }
      
      const payload = JSON.parse(atob(parts[1]));
      const isExpired = Date.now() > payload.exp * 1000;
      
      if (isExpired) {
        console.error('❌ TOKEN IS EXPIRED! You need to log in again.');
        this.clearInvalidToken();
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Token format invalid:', error);
      this.clearInvalidToken();
      return false;
    }
  }

  // Helper method to get auth token (implement based on your auth system)
  getAuthToken() {
    // Check token expiration first
    if (!this.checkTokenExpiration()) {
      return '';
    }
    
    // This should return the JWT token from localStorage or your auth context
    const token = localStorage.getItem('token') || '';
    console.log('🔑 Retrieved token from localStorage:', token ? `${token.substring(0, 20)}...` : 'No token found');
    
    return token;
  }

  // Place a market buy order
  async placeMarketBuyOrder(symbol, quantity = 1) {
    try {
      const token = this.getAuthToken();
      console.log('🛒 Placing market buy order:', { symbol, quantity });
      
      const response = await fetch(`${API_BASE_URL}/orders/market-buy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: symbol,
          quantity: quantity
        })
      });
      
      if (!response.ok) {
        console.error('❌ Order API Error:', response.status, response.statusText);
        const errorData = await response.json();
        console.error('Error details:', errorData);
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Order placed successfully:', result);
      return result;
    } catch (error) {
      console.error('Error placing market buy order:', error);
      throw error;
    }
  }

  // Place a market sell order
  async placeMarketSellOrder(symbol, quantity = 1) {
    try {
      console.log('🔍 ChartService.placeMarketSellOrder called with:', { symbol, quantity });
      console.log('🔍 ChartService instance:', this);
      console.log('🔍 ChartService getAuthToken method:', typeof this.getAuthToken);
      
      const token = this.getAuthToken();
      console.log('🛒 Placing market sell order:', { symbol, quantity });
      console.log('🔑 Auth token retrieved:', token ? `${token.substring(0, 20)}...` : 'No token');
      
      const response = await fetch(`${API_BASE_URL}/orders/market-sell`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: symbol,
          quantity: quantity
        })
      });
      
      if (!response.ok) {
        console.error('❌ Order API Error:', response.status, response.statusText);
        const errorData = await response.json();
        console.error('Error details:', errorData);
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Sell order placed successfully:', result);
      return result;
    } catch (error) {
      console.error('Error placing market sell order:', error);
      throw error;
    }
  }

  // Get IB connection status
  async getIBStatus() {
    try {
      const token = this.getAuthToken();
      console.log('🔗 Checking IB connection status...');
      
      const response = await fetch(`${API_BASE_URL}/udf/ibkr-status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        console.error('❌ IB Status API Error:', response.status, response.statusText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ IB status fetched:', result);
      return result;
    } catch (error) {
      console.error('Error fetching IB status:', error);
      throw error;
    }
  }

  // Get real-time market data for a symbol
  async getMarketData(symbol) {
    try {
      const token = this.getAuthToken();
      console.log('📊 Fetching real-time market data for:', symbol);
      
      // For now, return mock data until WebSocket is properly implemented
      return {
        symbol: symbol.toUpperCase(),
        last: 263.45,
        bid: 263.40,
        ask: 263.50,
        volume: 1500000,
        time: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching market data:', error);
      throw error;
    }
  }

  // Get real positions from IB account
  async getPositions() {
    try {
      const token = this.getAuthToken();
      console.log('📊 Fetching real positions from IB...');
      
      const response = await fetch(`${API_BASE_URL}/udf/positions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        console.error('❌ Positions API Error:', response.status, response.statusText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Real positions fetched:', result);
      return result;
    } catch (error) {
      console.error('Error fetching positions:', error);
      throw error;
    }
  }

}

export default new ChartService();
