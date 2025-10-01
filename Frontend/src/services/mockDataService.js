// src/services/dummyDataService.js
import chartData from '../data/chartData.json';
import { SYMBOLS } from '../data/symbols';

/**
 * Simulates fetching stock data with dummy data
 * @param {string} symbol - Stock symbol
 * @returns {Promise<Array>} Array of candlestick data
 */
export async function fetchDummyData(symbol) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 800));

  // Check if symbol exists in our list
  const symbolExists = SYMBOLS.find(s => s.symbol === symbol.toUpperCase());
  
  if (!symbolExists) {
    throw new Error(`Symbol ${symbol} not found in dummy data`);
  }

  try {
    const timeSeries = chartData['Time Series (Daily)'];
    
    if (!timeSeries) {
      throw new Error('No time series data available');
    }

    // Convert to chart format
    const chartFormattedData = Object.entries(timeSeries)
      .map(([date, values]) => ({
        time: date, // YYYY-MM-DD format for daily data
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume']),
      }))
      .sort((a, b) => new Date(a.time) - new Date(b.time)); // Sort chronologically

    // Validate data
    const isValid = chartFormattedData.every(
      item => 
        item.time &&
        !isNaN(item.open) &&
        !isNaN(item.high) &&
        !isNaN(item.low) &&
        !isNaN(item.close)
    );

    if (!isValid) {
      throw new Error('Invalid data format detected');
    }

    return chartFormattedData;
  } catch (error) {
    console.error('Error processing dummy data:', error);
    throw error;
  }
}

/**
 * Get symbol info from symbols list
 * @param {string} symbol - Stock symbol
 * @returns {Object|null} Symbol info or null
 */
export function getSymbolInfo(symbol) {
  return SYMBOLS.find(s => s.symbol === symbol.toUpperCase()) || null;
}

/**
 * Get random price movement for demo purposes
 * @param {number} basePrice - Base price
 * @returns {number} Modified price
 */
export function getRandomPrice(basePrice) {
  const change = (Math.random() - 0.5) * 10; // ±5 range
  return basePrice + change;
}