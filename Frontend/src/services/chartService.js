const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ChartService {
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
      
      if (!response.ok) {
        console.error('❌ API Error:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Error details:', errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
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
    
    // Optionally redirect to login page
    if (window.location.pathname !== '/login') {
      console.log('🔄 Redirecting to login page...');
      window.location.href = '/login';
    }
  }

  // Helper method to get auth token (implement based on your auth system)
  getAuthToken() {
    // This should return the JWT token from localStorage or your auth context
    const token = localStorage.getItem('token') || '';
    console.log('🔑 Retrieved token from localStorage:', token ? `${token.substring(0, 20)}...` : 'No token found');
    console.log('🔑 Full localStorage keys:', Object.keys(localStorage));
    
    // Validate token format
    if (token) {
      try {
        // Try to decode JWT token to check if it's valid
        const parts = token.split('.');
        if (parts.length !== 3) {
          console.error('❌ Invalid JWT format - should have 3 parts separated by dots');
          return '';
        }
        
        const payload = JSON.parse(atob(parts[1]));
        console.log('🔑 Token payload:', payload);
        console.log('🔑 Token expires at:', new Date(payload.exp * 1000));
        console.log('🔑 Current time:', new Date());
        console.log('🔑 Token is expired:', Date.now() > payload.exp * 1000);
        
        if (Date.now() > payload.exp * 1000) {
          console.error('❌ TOKEN IS EXPIRED! You need to log in again.');
          console.log('💡 Solution: Go to login page and log in again');
        }
      } catch (error) {
        console.error('❌ Token format invalid:', error);
        console.log('💡 Solution: Clear localStorage and log in again');
      }
    } else {
      console.error('❌ NO TOKEN FOUND! You need to log in.');
      console.log('💡 Solution: Go to login page and log in');
    }
    
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
}

export default new ChartService();
