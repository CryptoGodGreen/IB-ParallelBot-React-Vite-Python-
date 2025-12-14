"""
FastAPI REST API wrapper for Interactive Brokers Gateway.
Provides HTTPS endpoints for authentication and market data access.
"""
import asyncio
import os
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any
from datetime import datetime

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from ib_insync import IB, Contract, Stock, util
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global IB connection instance
ib_connection: Optional[IB] = None
current_credentials: Optional[Dict[str, str]] = None
connection_lock = asyncio.Lock()


class LoginRequest(BaseModel):
    """Authentication request model"""
    username: str = Field(..., description="IB username")
    password: str = Field(..., description="IB password")
    account_type: str = Field("paper", description="Account type: 'live' or 'paper'")


class LoginResponse(BaseModel):
    """Authentication response model"""
    success: bool
    message: str
    account_type: str
    connected: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage IB connection lifecycle"""
    logger.info("Starting FastAPI application...")
    yield
    # Cleanup on shutdown
    logger.info("Shutting down FastAPI application...")
    if ib_connection and ib_connection.isConnected():
        ib_connection.disconnect()


app = FastAPI(
    title="IB Gateway REST API",
    description="REST API wrapper for Interactive Brokers Gateway",
    version="1.0.0",
    lifespan=lifespan
)


def update_config_file(username: str, password: str, account_type: str):
    """Update IBC config.ini with new credentials"""
    config_path = "/opt/ibc/config.ini"

    try:
        with open(config_path, "r") as f:
            lines = f.readlines()

        # Update credentials and trading mode
        with open(config_path, "w") as f:
            for line in lines:
                if line.startswith("IbLoginId="):
                    f.write(f"IbLoginId={username}\n")
                elif line.startswith("IbPassword="):
                    f.write(f"IbPassword={password}\n")
                elif line.startswith("TradingMode="):
                    f.write(f"TradingMode={account_type}\n")
                elif line.startswith("AcceptNonBrokerageAccountWarning="):
                    f.write("AcceptNonBrokerageAccountWarning=yes\n")
                else:
                    f.write(line)

        logger.info(f"Updated config.ini with new credentials for {account_type} account")
        return True
    except Exception as e:
        logger.error(f"Failed to update config.ini: {e}")
        return False


async def connect_to_gateway(account_type: str = "paper") -> bool:
    """Connect to IB Gateway using ib_insync"""
    global ib_connection

    async with connection_lock:
        try:
            # Disconnect existing connection if any
            if ib_connection and ib_connection.isConnected():
                ib_connection.disconnect()

            # Create new IB instance
            ib_connection = IB()

            # Determine port based on account type
            port = 4002 if account_type == "paper" else 4001

            # Connect to gateway
            await ib_connection.connectAsync(
                host="127.0.0.1",
                port=port,
                clientId=1,
                timeout=20
            )

            logger.info(f"Successfully connected to IB Gateway on port {port}")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to IB Gateway: {e}")
            ib_connection = None
            return False


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "IB Gateway REST API",
        "status": "running",
        "connected": ib_connection.isConnected() if ib_connection else False,
        "timestamp": datetime.utcnow().isoformat()
    }


@app.post("/auth/login", response_model=LoginResponse)
async def login(credentials: LoginRequest):
    """
    Authenticate with IB Gateway using provided credentials.
    Updates config and establishes connection.
    """
    global current_credentials

    # Validate account type
    if credentials.account_type not in ["live", "paper"]:
        raise HTTPException(
            status_code=400,
            detail="account_type must be 'live' or 'paper'"
        )

    logger.info(f"Login attempt for {credentials.account_type} account")

    # Update config file
    config_updated = update_config_file(
        credentials.username,
        credentials.password,
        credentials.account_type
    )

    if not config_updated:
        raise HTTPException(
            status_code=500,
            detail="Failed to update gateway configuration"
        )

    # Note: In production, IBC needs to be restarted to pick up new credentials
    # For now, we'll just update the API connection
    # TODO: Implement gateway restart logic via unstoppable

    # Connect to gateway
    connected = await connect_to_gateway(credentials.account_type)

    if not connected:
        return LoginResponse(
            success=False,
            message="Failed to connect to IB Gateway. Ensure gateway is running.",
            account_type=credentials.account_type,
            connected=False
        )

    # Store credentials for reconnection
    current_credentials = {
        "username": credentials.username,
        "account_type": credentials.account_type
    }

    return LoginResponse(
        success=True,
        message=f"Successfully connected to {credentials.account_type} account",
        account_type=credentials.account_type,
        connected=True
    )


@app.get("/account/summary")
async def get_account_summary():
    """Get account summary information"""
    if not ib_connection or not ib_connection.isConnected():
        raise HTTPException(
            status_code=401,
            detail="Not connected to IB Gateway. Please login first."
        )

    try:
        summary = ib_connection.accountSummary()
        result = {}
        for item in summary:
            result[item.tag] = {
                "value": item.value,
                "currency": item.currency,
                "account": item.account
            }
        return {"account_summary": result}
    except Exception as e:
        logger.error(f"Error fetching account summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/account/positions")
async def get_positions():
    """Get current portfolio positions"""
    if not ib_connection or not ib_connection.isConnected():
        raise HTTPException(
            status_code=401,
            detail="Not connected to IB Gateway. Please login first."
        )

    try:
        positions = ib_connection.positions()
        result = []
        for pos in positions:
            result.append({
                "account": pos.account,
                "symbol": pos.contract.symbol,
                "secType": pos.contract.secType,
                "currency": pos.contract.currency,
                "position": pos.position,
                "avgCost": pos.avgCost
            })
        return {"positions": result}
    except Exception as e:
        logger.error(f"Error fetching positions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/market/quote/{symbol}")
async def get_quote(symbol: str, exchange: str = "SMART", currency: str = "USD"):
    """Get real-time market quote for a symbol"""
    if not ib_connection or not ib_connection.isConnected():
        raise HTTPException(
            status_code=401,
            detail="Not connected to IB Gateway. Please login first."
        )

    try:
        contract = Stock(symbol, exchange, currency)
        ib_connection.qualifyContracts(contract)

        # Request market data
        ticker = ib_connection.reqMktData(contract)
        await asyncio.sleep(2)  # Wait for data

        result = {
            "symbol": symbol,
            "exchange": exchange,
            "currency": currency,
            "bid": ticker.bid,
            "ask": ticker.ask,
            "last": ticker.last,
            "close": ticker.close,
            "volume": ticker.volume,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Cancel market data subscription
        ib_connection.cancelMktData(contract)

        return result
    except Exception as e:
        logger.error(f"Error fetching quote for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket endpoint for streaming market data"""
    await websocket.accept()

    if not ib_connection or not ib_connection.isConnected():
        await websocket.send_json({
            "error": "Not connected to IB Gateway. Please login first."
        })
        await websocket.close()
        return

    try:
        while True:
            # Wait for client message (symbol subscription request)
            data = await websocket.receive_json()
            symbol = data.get("symbol")
            action = data.get("action", "subscribe")

            if action == "subscribe" and symbol:
                contract = Stock(symbol, "SMART", "USD")
                ib_connection.qualifyContracts(contract)
                ticker = ib_connection.reqMktData(contract)

                # Send initial data
                await websocket.send_json({
                    "type": "quote",
                    "symbol": symbol,
                    "bid": ticker.bid,
                    "ask": ticker.ask,
                    "last": ticker.last,
                    "timestamp": datetime.utcnow().isoformat()
                })

            await asyncio.sleep(1)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()


@app.get("/health")
async def health_check():
    """Health check for load balancers"""
    connected = ib_connection.isConnected() if ib_connection else False
    return {
        "status": "healthy" if connected else "degraded",
        "ib_connected": connected,
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True
    )
