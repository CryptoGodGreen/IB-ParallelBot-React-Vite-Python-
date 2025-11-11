import asyncio
import logging
import time
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
        self._open_order_cache: Dict[int, any] = {}
        self._order_status_cache: Dict[int, str] = {}
        self._connect_task = None
        
        # Event handlers
        self.ib.errorEvent += self.on_error
        self.ib.disconnectedEvent += self.on_disconnected
        self.ib.openOrderEvent += self._on_open_order_event
        try:
            self.ib.orderStatusEvent += self._on_order_status_event
        except AttributeError:
            logger.debug("orderStatusEvent not available on IB client")

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

    def _on_open_order_event(self, trade):
        try:
            order = getattr(trade, 'order', None)
            if order and hasattr(order, 'orderId'):
                order_id = order.orderId
                self._open_order_cache[order_id] = trade
                status = None
                order_status = getattr(trade, 'orderStatus', None)
                if order_status and hasattr(order_status, 'status'):
                    status = order_status.status
                if status:
                    self._order_status_cache[order_id] = status
        except Exception as e:
            logger.debug(f"Error handling openOrderEvent: {e}")

    def _on_order_status_event(
        self,
        orderId,
        status,
        filled,
        remaining,
        avgFillPrice,
        permId,
        parentId,
        lastFillPrice,
        clientId,
        whyHeld,
        mktCapPrice,
    ):
        try:
            if orderId is None:
                return
            if status:
                self._order_status_cache[orderId] = status
                if orderId in self._open_order_cache:
                    trade = self._open_order_cache[orderId]
                    order_status = getattr(trade, 'orderStatus', None)
                    if order_status is not None:
                        order_status.status = status
                normalized = status.upper()
                if normalized in {'FILLED', 'CANCELLED', 'INACTIVE', 'REJECTED', 'APICANCELLED', 'NOTFOUND'}:
                    self._open_order_cache.pop(orderId, None)
        except Exception as e:
            logger.debug(f"Error handling orderStatusEvent: {e}")

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
    
    async def await_order_submission(self, trade, timeout: float = 5.0) -> str:
        """Wait for an order to leave Pending state and return its status."""
        await self.ensure_connected()
        start = time.time()
        last_status = trade.orderStatus.status or "Unknown"
        while time.time() - start < timeout:
            status = trade.orderStatus.status or last_status
            if status not in ("PendingSubmit", "ApiPending"):
                return status
            last_status = status
            await asyncio.sleep(0.1)
        logger.warning(f"⚠️ Order {trade.order.orderId} did not leave pending state within {timeout}s (status={last_status})")
        return trade.orderStatus.status or last_status

    async def get_positions(self):
        """Get all positions from IB account"""
        await self.ensure_connected()
        positions = self.ib.positions()
        return positions
    
    async def get_portfolio(self):
        """Get portfolio data including average cost"""
        await self.ensure_connected()
        portfolio = self.ib.portfolio()
        return portfolio
    
    async def get_option_chain(self, symbol: str) -> Optional[dict]:
        """
        Get option chain (expiration dates and strikes) from IBKR using reqSecDefOptParams
        Returns: {
            'expiration_dates': [timestamp1, timestamp2, ...],
            'strikes': [strike1, strike2, ...]
        }
        """
        await self.ensure_connected()
        try:
            # First qualify the stock contract
            stock_contract = await self.qualify_stock(symbol)
            if not stock_contract:
                logger.error(f"Could not qualify stock {symbol} for option chain")
                return None
            
            # Request option chain parameters
            secDefOptParams = await self.ib.reqSecDefOptParamsAsync(
                stock_contract.symbol,
                "",
                stock_contract.secType,
                stock_contract.conId
            )
            
            if not secDefOptParams:
                logger.error(f"No option chain data returned for {symbol}")
                return None
            
            # Get the first (usually only) option chain
            if len(secDefOptParams) == 0:
                logger.error(f"Empty option chain for {symbol}")
                return None
            
            chain = secDefOptParams[0]
            
            # Extract expiration dates and strikes
            expiration_dates = chain.expirations if hasattr(chain, 'expirations') else []
            strikes = chain.strikes if hasattr(chain, 'strikes') else []
            
            # Log first few expiration dates to see their format
            if expiration_dates:
                logger.info(f"✅ Got option chain for {symbol}: {len(expiration_dates)} expirations, {len(strikes)} strikes")
                logger.info(f"🔍 Sample expiration dates (first 3): {expiration_dates[:3]}, types: {[type(d).__name__ for d in expiration_dates[:3]]}")
            else:
                logger.warning(f"⚠️ No expiration dates found for {symbol}")
            
            return {
                'expiration_dates': expiration_dates,
                'strikes': strikes
            }
            
        except Exception as e:
            logger.error(f"Error getting option chain for {symbol}: {e}", exc_info=True)
            return None
    
    async def get_order_status(self, order_id: int) -> str:
        """Get the status of an order by its ID"""
        await self.ensure_connected()
        try:
            # First check the current openOrders cache
            open_orders = self.ib.openOrders()
            logger.info(f"🔍 Checking order {order_id} status. Open orders: {len(open_orders)}")

            for order in open_orders:
                try:
                    if order.order.orderId == order_id:
                        status = order.orderStatus.status or "Unknown"
                        logger.info(f"🔍 Found order {order_id} in open orders: {status}")
                        return status
                except AttributeError:
                    continue

            # If not found, request all open orders (across all client IDs)
            logger.debug(f"🔍 Order {order_id} not found in cached openOrders(); requesting all open orders from IBKR")
            try:
                await asyncio.wait_for(asyncio.to_thread(self.ib.reqAllOpenOrders), timeout=3.0)
                await asyncio.sleep(0.2)  # allow events to populate
            except Exception as e:
                logger.warning(f"⚠️ Could not reqAllOpenOrders(): {e}")

            open_orders = self.ib.openOrders()
            logger.info(f"🔍 After reqAllOpenOrders(), open orders: {len(open_orders)}")
            for order in open_orders:
                try:
                    if order.order.orderId == order_id:
                        status = order.orderStatus.status or "Unknown"
                        logger.info(f"🔍 Found order {order_id} after reqAllOpenOrders(): {status}")
                        return status
                except AttributeError:
                    continue

            cached_trade = self._open_order_cache.get(order_id)
            if cached_trade:
                order_status = getattr(cached_trade, 'orderStatus', None)
                status = getattr(order_status, 'status', None) or self._order_status_cache.get(order_id)
                if status:
                    logger.info(f"🔍 Found order {order_id} in cached open order events: {status}")
                    return status

            cached_status = self._order_status_cache.get(order_id)
            if cached_status:
                logger.info(f"🔍 Returning cached status for order {order_id}: {cached_status}")
                return cached_status

            # Finally check fills to see if it completed
            fills = self.ib.fills()
            logger.info(f"🔍 Checking fills for order {order_id}. Total fills: {len(fills)}")
            for fill in fills:
                try:
                    if fill.execution.orderId == order_id:
                        logger.info(f"🔍 Found order {order_id} in fills: Filled")
                        return "Filled"
                except AttributeError:
                    continue

            logger.info(f"🔍 Order {order_id} not found in open orders or fills (treating as NotFound)")
            return "NotFound"
        except Exception as e:
            logger.error(f"Error getting order status for {order_id}: {e}")
            return "Error"
    
    async def modify_order(self, order_id: int, new_price: float) -> bool:
        """Modify an existing order's price"""
        await self.ensure_connected()
        try:
            # Get all open orders
            open_orders = self.ib.openOrders()
            
            # Find the order by ID
            for order in open_orders:
                if order.order.orderId == order_id:
                    # Modify the order
                    order.order.lmtPrice = new_price
                    self.ib.placeOrder(order.contract, order.order)
                    logger.info(f"Modified order {order_id} price to {new_price}")
                    return True
            
            logger.warning(f"Order {order_id} not found for modification")
            return False
        except Exception as e:
            logger.error(f"Error modifying order {order_id}: {e}")
            return False
    
    async def cancel_order(self, order_id: int) -> bool:
        """Cancel an order by its ID"""
        await self.ensure_connected()
        try:
            # First, try to find the order in openOrders() as Trade objects
            open_orders = self.ib.openOrders()
            
            for trade in open_orders:
                # Check if it's a Trade object
                if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                    if trade.order.orderId == order_id:
                        # Cancel the order
                        self.ib.cancelOrder(trade.order)
                        logger.info(f"✅ Cancelled order {order_id} (from Trade object)")
                        return True
                # Check if it's an Order object directly
                elif hasattr(trade, 'orderId'):
                    if trade.orderId == order_id:
                        # Cancel the order
                        self.ib.cancelOrder(trade)
                        logger.info(f"✅ Cancelled order {order_id} (from Order object)")
                        return True
            
            # If not found in openOrders, try to find in trades() and cancel
            logger.debug(f"Order {order_id} not found in openOrders(), checking trades()...")
            all_trades = self.ib.trades()
            for trade in all_trades:
                if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                    if trade.order.orderId == order_id:
                        # Cancel the order
                        self.ib.cancelOrder(trade.order)
                        logger.info(f"✅ Cancelled order {order_id} (from trades() list)")
                        return True
            
            logger.warning(f"Order {order_id} not found in open orders or trades")
            return False
            
        except Exception as e:
            logger.error(f"Error cancelling order {order_id}: {e}", exc_info=True)
            return False
    
    async def get_contract(self, symbol: str) -> Optional[Contract]:
        """Alias for qualify_stock for backward compatibility"""
        return await self.qualify_stock(symbol)
    
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
