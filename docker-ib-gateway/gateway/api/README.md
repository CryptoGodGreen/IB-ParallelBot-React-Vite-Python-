# IB Gateway REST API

FastAPI-based REST API wrapper for Interactive Brokers Gateway, designed for deployment on AWS App Runner with HTTPS support.

## Features

- **REST API Authentication**: Dynamic login with IB credentials
- **Account Management**: Access account summary, positions, and balance
- **Market Data**: Real-time quotes and market data
- **WebSocket Streaming**: Live market data streaming
- **Health Checks**: Built-in health endpoints for load balancers
- **Automatic Reconnection**: Handles connection failures gracefully

## API Endpoints

### Health & Status

#### `GET /`
Root endpoint with service status.

**Response:**
```json
{
  "service": "IB Gateway REST API",
  "status": "running",
  "connected": true,
  "timestamp": "2025-10-16T10:30:00.000000"
}
```

#### `GET /health`
Health check endpoint for AWS App Runner / load balancers.

**Response:**
```json
{
  "status": "healthy",
  "ib_connected": true,
  "timestamp": "2025-10-16T10:30:00.000000"
}
```

---

### Authentication

#### `POST /auth/login`
Authenticate with IB Gateway using credentials. Updates gateway configuration and establishes connection.

**Request Body:**
```json
{
  "username": "your_ib_username",
  "password": "your_ib_password",
  "account_type": "paper"
}
```

**Parameters:**
- `username` (string, required): IB username
- `password` (string, required): IB password
- `account_type` (string, required): `"paper"` or `"live"`

**Response:**
```json
{
  "success": true,
  "message": "Successfully connected to paper account",
  "account_type": "paper",
  "connected": true
}
```

**Example cURL:**
```bash
curl -X POST https://your-app.region.awsapprunner.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password",
    "account_type": "paper"
  }'
```

---

### Account Data

#### `GET /account/summary`
Get comprehensive account summary information.

**Response:**
```json
{
  "account_summary": {
    "NetLiquidation": {
      "value": "100000.00",
      "currency": "USD",
      "account": "DU123456"
    },
    "TotalCashValue": {
      "value": "95000.00",
      "currency": "USD",
      "account": "DU123456"
    },
    "BuyingPower": {
      "value": "200000.00",
      "currency": "USD",
      "account": "DU123456"
    }
  }
}
```

**Example cURL:**
```bash
curl https://your-app.region.awsapprunner.com/account/summary
```

#### `GET /account/positions`
Get current portfolio positions.

**Response:**
```json
{
  "positions": [
    {
      "account": "DU123456",
      "symbol": "AAPL",
      "secType": "STK",
      "currency": "USD",
      "position": 100.0,
      "avgCost": 150.50
    },
    {
      "account": "DU123456",
      "symbol": "TSLA",
      "secType": "STK",
      "currency": "USD",
      "position": 50.0,
      "avgCost": 200.25
    }
  ]
}
```

**Example cURL:**
```bash
curl https://your-app.region.awsapprunner.com/account/positions
```

---

### Market Data

#### `GET /market/quote/{symbol}`
Get real-time market quote for a symbol.

**Path Parameters:**
- `symbol` (string, required): Stock symbol (e.g., "AAPL", "TSLA")

**Query Parameters:**
- `exchange` (string, optional, default: "SMART"): Exchange
- `currency` (string, optional, default: "USD"): Currency

**Response:**
```json
{
  "symbol": "AAPL",
  "exchange": "SMART",
  "currency": "USD",
  "bid": 175.50,
  "ask": 175.52,
  "last": 175.51,
  "close": 175.00,
  "volume": 50000000,
  "timestamp": "2025-10-16T10:30:00.000000"
}
```

**Example cURL:**
```bash
curl "https://your-app.region.awsapprunner.com/market/quote/AAPL?exchange=SMART&currency=USD"
```

---

### WebSocket Streaming

#### `WS /ws/stream`
WebSocket endpoint for streaming real-time market data.

**Connection:**
```javascript
const ws = new WebSocket('wss://your-app.region.awsapprunner.com/ws/stream');

ws.onopen = () => {
  // Subscribe to a symbol
  ws.send(JSON.stringify({
    action: 'subscribe',
    symbol: 'AAPL'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  // {
  //   "type": "quote",
  //   "symbol": "AAPL",
  //   "bid": 175.50,
  //   "ask": 175.52,
  //   "last": 175.51,
  //   "timestamp": "2025-10-16T10:30:00.000000"
  // }
};
```

**Python Example:**
```python
import websockets
import json
import asyncio

async def stream_quotes():
    uri = "wss://your-app.region.awsapprunner.com/ws/stream"
    async with websockets.connect(uri) as websocket:
        # Subscribe to AAPL
        await websocket.send(json.dumps({
            "action": "subscribe",
            "symbol": "AAPL"
        }))

        # Receive quotes
        while True:
            quote = await websocket.recv()
            print(json.loads(quote))

asyncio.run(stream_quotes())
```

---

## Deployment on AWS App Runner

### 1. Build the Docker Image

```bash
# Build stable channel
./build.sh stable

# Or build latest channel
./build.sh latest
```

### 2. Push to Container Registry

```bash
# Push to Quay.io (configured in build.sh)
./build.sh stable --push

# Or push to AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag quay.io/hartza-capital/ib-gateway:stable <account-id>.dkr.ecr.us-east-1.amazonaws.com/ib-gateway:stable
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/ib-gateway:stable
```

### 3. Create App Runner Service

**AWS Console:**
1. Go to AWS App Runner
2. Create Service
3. Source: Container registry
4. Image: `<your-registry>/ib-gateway:stable`
5. Port: `8000`
6. Health check path: `/health`

**AWS CLI:**
```bash
aws apprunner create-service \
  --service-name ib-gateway-api \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/ib-gateway:stable",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8000",
        "RuntimeEnvironmentVariables": {
          "VNC_SERVER_PASSWORD": "your-vnc-password"
        }
      }
    },
    "AutoDeploymentsEnabled": true
  }' \
  --instance-configuration '{
    "Cpu": "1 vCPU",
    "Memory": "2 GB"
  }' \
  --health-check-configuration '{
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 30,
    "Timeout": 10,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  }'
```

### 4. Access Your API

App Runner provides an automatic HTTPS endpoint:
```
https://your-app-id.region.awsapprunner.com
```

---

## Local Testing

### Using Docker Compose

```bash
# Start services
docker-compose up

# API will be available at:
# http://localhost:8000
# Interactive docs: http://localhost:8000/docs
```

### Testing Authentication

```bash
# Login to paper account
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password",
    "account_type": "paper"
  }'

# Get account summary
curl http://localhost:8000/account/summary

# Get positions
curl http://localhost:8000/account/positions

# Get quote
curl http://localhost:8000/market/quote/AAPL
```

---

## Interactive API Documentation

FastAPI automatically generates interactive API documentation:

- **Swagger UI**: `https://your-app.com/docs`
- **ReDoc**: `https://your-app.com/redoc`

These provide:
- Full endpoint documentation
- Request/response schemas
- Try-it-out functionality
- Authentication testing

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AWS App Runner                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Docker Container                     │  │
│  │                                                    │  │
│  │  ┌─────────────┐         ┌──────────────────┐   │  │
│  │  │  FastAPI    │◄────────┤  IB Gateway      │   │  │
│  │  │  (Port 8000)│         │  (Port 4001/4002)│   │  │
│  │  │             │  ib_insync                    │  │
│  │  │  REST/WS    │         │  TCP Socket API   │   │  │
│  │  └──────▲──────┘         └──────────────────┘   │  │
│  │         │                                         │  │
│  │    HTTPS/WSS                                      │  │
│  └──────────┼─────────────────────────────────────┬─┘  │
│             │                                      │    │
└─────────────┼──────────────────────────────────────┼────┘
              │                                      │
              │                                      │
     ┌────────▼────────┐                    ┌───────▼───────┐
     │   API Clients   │                    │  VNC Client   │
     │  (Your Apps)    │                    │  (Port 5900)  │
     └─────────────────┘                    └───────────────┘
```

---

## Security Considerations

1. **Credentials**: Never hardcode credentials in the image. Pass via API or environment variables.
2. **HTTPS**: App Runner automatically provides TLS/SSL encryption.
3. **Authentication**: Consider adding API key authentication for production deployments.
4. **Rate Limiting**: Implement rate limiting for API endpoints in production.
5. **VNC Access**: VNC port (5900) should NOT be exposed publicly in production.

---

## Troubleshooting

### Connection Refused
- Ensure IB Gateway is running (check `/health` endpoint)
- Verify credentials are correct
- Check if account type matches (paper vs live)

### Authentication Failed
- Verify IB username and password
- Ensure 2FA is properly configured
- Check IB account is active and funded

### No Market Data
- Verify market data subscriptions in IB account
- Check trading hours
- Ensure contract is valid (symbol, exchange, currency)

---

## License

See main repository for license information.
