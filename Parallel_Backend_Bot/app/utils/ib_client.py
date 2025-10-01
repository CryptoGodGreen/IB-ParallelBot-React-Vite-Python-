import asyncio
import logging
from typing import Dict, Optional, List
from ib_async import IB, Stock, Contract, ContractDetails, MarketOrder, LimitOrder, StopLimitOrder, Ticker
from app.config import settings

logger = logging.getLogger(__name__)

class IBClient:
    """
    Singleton-style connection manager for ib_insync with:
    - connect/reconnect
    - contract qualification + caching
    - helper to request snapshot/stream market data
    """
    _instance = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.ib = IB()
        self._connected = False
        self._contract_cache: Dict[str, Contract] = {}
        self._details_cache: Dict[str, ContractDetails] = {}
        self._connect_task = None
        
        # Event handlers
        self.ib.errorEvent += self.on_error
        self.ib.disconnectedEvent += self.on_disconnected

    @classmethod
    def instance(cls) -> "IBClient":
        if not cls._instance:
            cls._instance = IBClient()
        return cls._instance

    async def connect(self):
        if self._connected or self.ib.isConnected():
            return
        try:
            logger.info("Attempting to connect to IBKR @ %s:%s", settings.IB_HOST, settings.IB_PORT)
            await self.ib.connectAsync(
                settings.IB_HOST, 
                settings.IB_PORT, 
                clientId=settings.IB_CLIENT_ID,
                timeout=settings.IB_CONNECT_TIMEOUT
            )
            self._connected = True
            logger.info("✅ Connected to IBKR.")
        except Exception as e:
            logger.error("IB Connect failed: %s", e)
            raise

    async def ensure_connected(self):
        if self._connected and self.ib.isConnected():
            return
            
        async with self._lock:
            if self._connected and self.ib.isConnected():
                return

            self._connected = False # Force reconnect state
            backoff = settings.IB_RECONNECT_BACKOFF_SECONDS
            while not self.ib.isConnected():
                try:
                    await self.connect()
                    return
                except Exception:
                    logger.warning("Reconnect failed. Retrying in %.1fs...", backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 1.5, 30)
    
    async def disconnect(self):
        if self.ib.isConnected():
            logger.info("Disconnecting from IBKR...")
            self.ib.disconnect()
            self._connected = False

    async def qualify_stock(self, symbol: str) -> Optional[Contract]:
        """
        Returns a qualified Stock contract; caches conId and details.
        """
        await self.ensure_connected()
        key = symbol.upper()
        if key in self._contract_cache:
            return self._contract_cache[key]

        try:
            contract = Stock(key, "SMART", "USD")
            details_list = await self.ib.reqContractDetailsAsync(contract)
            if not details_list:
                logger.error(f"No contract details found for {key}")
                return None
            
            d: ContractDetails = details_list[0]
            q = d.contract
            self._contract_cache[key] = q
            self._details_cache[key] = d
            logger.info(f"Qualified and cached contract for {symbol}")
            return q
        except Exception as e:
            logger.error(f"Error qualifying stock {symbol}: {e}")
            return None

    def get_specs(self, symbol: str):
        d = self._details_cache.get(symbol.upper())
        if not d:
            return None
        min_tick = getattr(d, "minTick", 0.01)
        min_size = getattr(d, "minSize", 1)
        return {"min_tick": float(min_tick or 0.01), "min_size": int(min_size or 1)}

    async def get_live_tickers(self, contracts: List[Contract]) -> List[Ticker]:
        """Requests streaming market data for a list of contracts."""
        await self.ensure_connected()
        tickers = []
        for contract in contracts:
            ticker = self.ib.reqMktData(contract, "", False, False)
            tickers.append(ticker)
        
        # Give some time for the initial data to arrive
        await asyncio.sleep(2) 
        return tickers

    async def history_bars(self, symbol: str, duration: str, barSize: str, rth: bool):
        await self.ensure_connected()
        c = await self.qualify_stock(symbol)
        if not c: return []
        bars = await self.ib.reqHistoricalDataAsync(
            c, endDateTime="", durationStr=duration, barSizeSetting=barSize,
            whatToShow="TRADES", useRTH=rth, formatDate=2, keepUpToDate=False
        )
        return bars

    async def place_order(self, contract: Contract, order):
        await self.ensure_connected()
        trade = self.ib.placeOrder(contract, order)
        return trade
    
    # --- Event Handlers ---
    def on_error(self, reqId, errorCode, errorString, contract=None):
        # Ignore informational messages about connectivity
        if errorCode not in [2104, 2106, 2158]:
             logger.error(f"IBKR Error: reqId={reqId}, code={errorCode}, msg='{errorString}'")

    def on_disconnected(self):
        logger.warning("Event: IBKR Client has disconnected.")
        self._connected = False
        # The ensure_connected logic will handle reconnection on the next call.


# Singleton instance
ib_client = IBClient.instance()
