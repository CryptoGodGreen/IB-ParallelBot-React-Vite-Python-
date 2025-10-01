// src/services/alphaVantageService.js
const API_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
const BASE_URL = "https://www.alphavantage.co/query";

if (!API_KEY) {
  throw new Error("Alpha Vantage API key is missing. Add VITE_ALPHA_VANTAGE_API_KEY to your .env file.");
}

const cache = new Map(); // simple in-memory cache

const fetchData = async (symbol, interval = "daily") => {
  const cacheKey = `${symbol}-${interval}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const url =
    interval === "daily"
      ? `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${API_KEY}`
      : `${BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${interval}&apikey=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data["Error Message"]) throw new Error("Invalid symbol");
  if (data["Note"] || data["Information"]) throw new Error("API rate limit exceeded");

  let timeSeries;
  if (interval === "daily") {
    timeSeries = data["Time Series (Daily)"];
  } else {
    timeSeries = data[`Time Series (${interval})`];
  }

  if (!timeSeries) throw new Error("Unexpected API response format");

  const formattedData = Object.entries(timeSeries).map(([timestamp, values]) => ({
    time:
      interval === "daily"
        ? Math.floor(new Date(timestamp).getTime() / 1000) // normalize daily -> Unix
        : Math.floor(new Date(timestamp).getTime() / 1000),
    open: parseFloat(values["1. open"]),
    high: parseFloat(values["2. high"]),
    low: parseFloat(values["3. low"]),
    close: parseFloat(values["4. close"]),
  }));

  formattedData.sort((a, b) => a.time - b.time); // oldest → newest

  cache.set(cacheKey, formattedData); // cache result
  return formattedData;
};

export const fetchDailyData = (symbol) => fetchData(symbol, "daily");
export const fetchIntradayData = (symbol, interval = "15min") =>
  fetchData(symbol, interval);
