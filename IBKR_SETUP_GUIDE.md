# 🚀 IBKR Setup Guide

## Quick Start

Your backend is now configured to fetch real-time data directly from Interactive Brokers (IBKR). Follow these steps to get started:

---

## ✅ Step 1: Download and Install TWS or IB Gateway

You need either:
- **TWS (Trader Workstation)** - Full trading platform with GUI
- **IB Gateway** - Lightweight API-only version (recommended for data only)

**Download:** https://www.interactivebrokers.com/en/trading/tws.php

---

## ✅ Step 2: Configure API Settings

Once TWS/Gateway is running:

### In TWS:
1. Go to: `File → Global Configuration → API → Settings`
2. **Enable these settings:**
   - ✅ **Enable ActiveX and Socket Clients**
   - ✅ **Read-Only API** (if you only need data, not trading)
3. **Configure ports:**
   - **Paper Trading:** Port `7497` (recommended for testing)
   - **Live Trading:** Port `7496`
4. **Trusted IPs:** Add `127.0.0.1`
5. **Click OK and restart TWS/Gateway**

### In IB Gateway:
1. Click **Configure → Settings → API → Settings**
2. Same settings as above

---

## ✅ Step 3: Verify Backend Configuration

Your backend is configured with these settings (in `docker-compose.yml` or `.env`):

```env
IB_HOST=127.0.0.1
IB_PORT=7497          # Paper trading port
IB_CLIENT_ID=42
IB_CONNECT_TIMEOUT=6
```

If you're using **live trading**, change `IB_PORT` to `7496`.

---

## ✅ Step 4: Start the Backend

```bash
cd Parallel_Backend_Bot
docker-compose up -d
```

**Check the logs:**
```bash
docker logs fastapi-app -f
```

**Look for:**
- ✅ `✅ Connected to IBKR.` - Connection successful!
- ⚠️ `⚠️ IBKR connection failed on startup` - TWS/Gateway not running or API not enabled

---

## ✅ Step 5: Test IBKR Connection

### Check connection status:
```bash
curl http://localhost:8000/udf/ibkr-status
```

**Expected response when connected:**
```json
{
  "connected": true,
  "message": "✅ IBKR connected",
  "host": "127.0.0.1",
  "port": 7497,
  "client_id": 42
}
```

**Expected response when NOT connected:**
```json
{
  "connected": false,
  "message": "❌ IBKR not connected. Start TWS/Gateway with API enabled.",
  "host": null,
  "port": null,
  "client_id": null
}
```

---

## ✅ Step 6: Test Data Fetching

Once IBKR is connected, test fetching data:

```bash
# Test fetching AAPL data
curl "http://localhost:8000/udf/history?symbol=AAPL&from_timestamp=1696800000&to_timestamp=1728336000&resolution=D"
```

**Expected response:**
```json
{
  "s": "ok",
  "t": [1696800000, 1696886400, ...],
  "o": [175.23, 176.45, ...],
  "h": [177.89, 178.12, ...],
  "l": [174.56, 175.34, ...],
  "c": [176.78, 177.23, ...],
  "v": [45678900, 52341200, ...]
}
```

---

## ✅ Step 7: View Chart in Frontend

```bash
cd Frontend
npm run dev
```

Open browser: http://localhost:5173

Click on a stock symbol (e.g., AAPL) and the chart should load with real IBKR data!

---

## 🔧 Troubleshooting

### Problem: "Connection refused"

**Symptoms:**
```
API connection failed: ConnectionRefusedError(111, 'Connection refused')
IB Connect failed: [Errno 111] Connection refused
```

**Solutions:**
1. ✅ Make sure TWS/IB Gateway is **running**
2. ✅ Check that API is **enabled** in settings
3. ✅ Verify port number (7497 for paper, 7496 for live)
4. ✅ Check firewall settings

### Problem: "No data received from IBKR"

**Solutions:**
1. ✅ Check if symbol is valid (e.g., AAPL, not APPL)
2. ✅ Verify you have market data subscriptions in your IBKR account
3. ✅ Check if market is open or use historical data
4. ✅ Try a different symbol

### Problem: "Read-only API" error

**Solutions:**
1. ✅ Enable "Read-Only API" in TWS settings if you only need data
2. ✅ Or disable it if you need full trading access

### Problem: Backend can't connect from Docker

**Solutions:**
1. ✅ Use `host.docker.internal` instead of `127.0.0.1` in `docker-compose.yml`:
   ```yaml
   environment:
     - IB_HOST=host.docker.internal
   ```
2. ✅ Or use `network_mode: "host"` in docker-compose

---

## 📊 How It Works

```
1. Frontend requests chart data
   ↓
2. Backend checks if IBKR is connected
   ↓
3. Backend fetches historical bars from IBKR
   ↓
4. Backend converts to UDF format
   ↓
5. Frontend displays chart with real data
```

**Key Features:**
- ✅ **Real-time data** from IBKR
- ✅ **No database required** for historical bars
- ✅ **Direct API calls** to IBKR
- ✅ **Automatic reconnection** if connection drops
- ✅ **Helpful error messages** when IBKR is not connected

---

## 🎯 Next Steps

1. **Set up IB Gateway** for headless operation (no GUI)
2. **Configure auto-start** for IB Gateway on system boot
3. **Add real-time streaming** for live price updates
4. **Implement caching** to reduce IBKR API calls
5. **Add more symbols** to the symbol list

---

## 📚 Resources

- **IBKR API Documentation:** https://interactivebrokers.github.io/tws-api/
- **TWS Download:** https://www.interactivebrokers.com/en/trading/tws.php
- **API Settings Guide:** https://interactivebrokers.github.io/tws-api/initial_setup.html
- **ib_insync Documentation:** https://ib-insync.readthedocs.io/

---

## 🆘 Need Help?

1. Check backend logs: `docker logs fastapi-app -f`
2. Check IBKR connection: `curl http://localhost:8000/udf/ibkr-status`
3. Verify TWS/Gateway is running and API is enabled
4. Test with a simple symbol like AAPL first

---

**Happy Trading! 📈**
