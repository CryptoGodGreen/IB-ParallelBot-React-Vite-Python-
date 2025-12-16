import asyncio
import logging
import time
from typing import Dict, Optional, List
from datetime import datetime
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

    async def history_bars(self, symbol: str, duration: str, barSize: str, rth: bool, endDateTime=None):
        await self.ensure_connected()
        c = await self.qualify_stock(symbol)
        if not c: return []
        
        # If endDateTime is provided, use it; otherwise use empty string (current time)
        # endDateTime should be a datetime object or None
        # ib_async expects endDateTime as a datetime object or empty string
        end_dt_str = ""
        if endDateTime:
            if isinstance(endDateTime, datetime):
                end_dt_str = endDateTime
            else:
                # Convert to datetime if it's a string
                end_dt_str = datetime.fromisoformat(str(endDateTime))
        
        logger.info(f"🔍 IBKR history_bars call: symbol={symbol}, duration={duration}, barSize={barSize}, rth={rth}, endDateTime={end_dt_str}")
        
        bars = await self.ib.reqHistoricalDataAsync(
            c, endDateTime=end_dt_str, durationStr=duration, barSizeSetting=barSize,
            whatToShow="TRADES", useRTH=rth, formatDate=2, keepUpToDate=False
        )
        
        logger.info(f"🔍 IBKR returned {len(bars) if bars else 0} bars")
        if bars and len(bars) > 0:
            logger.info(f"🔍 First bar date: {bars[0].date}, Last bar date: {bars[-1].date}")
        
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
    
    async def get_account_equity(self) -> Optional[float]:
        """
        Get account Net Liquidation Value (equity) in base currency.
        Returns None if unable to retrieve.
        """
        try:
            await self.ensure_connected()
            # Wrap synchronous call in thread with timeout to prevent blocking
            account_summary = await asyncio.wait_for(
                asyncio.to_thread(self.ib.accountSummary),
                timeout=3.0
            )
            
            # Look for NetLiquidation value
            for summary in account_summary:
                if summary.tag == 'NetLiquidation':
                    try:
                        equity = float(summary.value)
                        logger.info(f"📊 Account equity (NetLiquidation): {equity}")
                        return equity
                    except (ValueError, AttributeError):
                        continue
            
            logger.warning("⚠️ Could not find NetLiquidation in account summary")
            return None
        except asyncio.TimeoutError:
            logger.error("⏱️ Timeout getting account equity (accountSummary took > 3s)")
            return None
        except Exception as e:
            logger.error(f"Error getting account equity: {e}")
            return None
    
    async def get_account_cash(self) -> Optional[float]:
        """
        Get available cash balance in base currency.
        Returns None if unable to retrieve.
        """
        try:
            await self.ensure_connected()
            # Wrap synchronous call in thread with timeout to prevent blocking
            account_summary = await asyncio.wait_for(
                asyncio.to_thread(self.ib.accountSummary),
                timeout=3.0
            )
            
            # Look for available cash (try different tags)
            cash_tags = ['CashBalance', 'AvailableFunds', 'TotalCashValue', 'BuyingPower']
            for tag in cash_tags:
                for summary in account_summary:
                    if summary.tag == tag:
                        try:
                            cash = float(summary.value)
                            logger.info(f"📊 Account cash ({tag}): {cash}")
                            return cash
                        except (ValueError, AttributeError):
                            continue
            
            logger.warning("⚠️ Could not find cash balance in account summary")
            return None
        except asyncio.TimeoutError:
            logger.error("⏱️ Timeout getting account cash (accountSummary took > 3s)")
            return None
        except Exception as e:
            logger.error(f"Error getting account cash: {e}")
            return None
    
    async def check_sufficient_cash(self, required_amount: float) -> tuple:
        """
        Check if account has sufficient cash for a purchase.
        Returns (has_sufficient_cash, available_cash)
        """
        cash = await self.get_account_cash()
        if cash is None:
            # If we can't get cash, assume we can't verify
            return (False, None)
        
        has_sufficient = cash >= required_amount
        return (has_sufficient, cash)
    
    async def get_account_type_info(self) -> dict:
        """
        Get account type information (margin vs cash).
        Returns dict with account type and relevant values.
        """
        try:
            await self.ensure_connected()
            # Wrap synchronous call in thread with timeout to prevent blocking
            account_summary = await asyncio.wait_for(
                asyncio.to_thread(self.ib.accountSummary),
                timeout=3.0
            )
            
            info = {
                'account_type': None,
                'equity': None,
                'cash': None,
                'buying_power': None
            }
            
            for summary in account_summary:
                tag = summary.tag
                try:
                    value = float(summary.value)
                    if tag == 'NetLiquidation':
                        info['equity'] = value
                    elif tag == 'CashBalance' or tag == 'TotalCashValue':
                        info['cash'] = value
                    elif tag == 'BuyingPower':
                        info['buying_power'] = value
                    elif tag == 'AccountType':
                        info['account_type'] = summary.value
                except (ValueError, AttributeError):
                    continue
            
            # Determine account type from available info
            if info['buying_power'] and info['buying_power'] > (info['cash'] or 0):
                info['account_type'] = 'MARGIN'
            elif info['cash']:
                info['account_type'] = 'CASH'
            
            return info
        except asyncio.TimeoutError:
            logger.error("⏱️ Timeout getting account type info (accountSummary took > 3s)")
            return {}
        except Exception as e:
            logger.error(f"Error getting account type info: {e}")
            return {}
    
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
            # First check the cached open orders
            cached_trade = self._open_order_cache.get(order_id)
            if cached_trade:
                try:
                    # Get contract and order from cached trade
                    contract = cached_trade.contract
                    order = cached_trade.order
                    if hasattr(order, 'lmtPrice'):
                        old_price = order.lmtPrice
                        logger.info(f"🔧 Modifying cached order {order_id} from ${old_price} to ${new_price}")
                        order.lmtPrice = new_price
                        trade = self.ib.placeOrder(contract, order)
                        if trade:
                            # Await order submission to verify success
                            status = await self.await_order_submission(trade, timeout=3.0)
                            normalized_status = (status or 'UNKNOWN').strip().upper()
                            if normalized_status in {'CANCELLED', 'INACTIVE', 'APICANCELLED', 'REJECTED', 'ERROR'}:
                                logger.error(f"❌ Order {order_id} modification rejected with status {normalized_status}")
                                return False
                            logger.info(f"✅ Modified cached order {order_id} price to ${new_price} (status: {normalized_status})")
                            return True
                        else:
                            logger.warning(f"⚠️ placeOrder returned None for order {order_id}")
                            return False
                except Exception as e:
                    logger.warning(f"⚠️ Error modifying cached order {order_id}: {e}", exc_info=True)
            
            # Get all open orders from current client
            open_orders = self.ib.openOrders()
            logger.info(f"🔧 Searching {len(open_orders)} open orders for order {order_id}")
            
            # Find the order by ID
            for trade in open_orders:
                try:
                    if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                        if trade.order.orderId == order_id:
                            # Modify the order
                            if hasattr(trade.order, 'lmtPrice'):
                                old_price = trade.order.lmtPrice
                                logger.info(f"🔧 Modifying order {order_id} from ${old_price} to ${new_price}")
                                trade.order.lmtPrice = new_price
                                modified_trade = self.ib.placeOrder(trade.contract, trade.order)
                                if modified_trade:
                                    # Await order submission to verify success
                                    status = await self.await_order_submission(modified_trade, timeout=3.0)
                                    normalized_status = (status or 'UNKNOWN').strip().upper()
                                    if normalized_status in {'CANCELLED', 'INACTIVE', 'APICANCELLED', 'REJECTED', 'ERROR'}:
                                        logger.error(f"❌ Order {order_id} modification rejected with status {normalized_status}")
                                        return False
                                    logger.info(f"✅ Modified order {order_id} price to ${new_price} (status: {normalized_status})")
                                    return True
                                else:
                                    logger.warning(f"⚠️ placeOrder returned None for order {order_id}")
                                    return False
                            else:
                                logger.warning(f"⚠️ Order {order_id} does not have lmtPrice attribute (might not be a limit order)")
                                return False
                except AttributeError:
                    continue
            
            # If not found, request all open orders (across all client IDs)
            logger.info(f"🔧 Order {order_id} not found in current openOrders(); requesting all open orders")
            try:
                await asyncio.wait_for(asyncio.to_thread(self.ib.reqAllOpenOrders), timeout=3.0)
                await asyncio.sleep(0.3)  # Allow events to populate
            except Exception as e:
                logger.warning(f"⚠️ Could not reqAllOpenOrders(): {e}")
            
            # Try again after reqAllOpenOrders
            open_orders = self.ib.openOrders()
            logger.info(f"🔧 After reqAllOpenOrders(), searching {len(open_orders)} open orders for order {order_id}")
            
            for trade in open_orders:
                try:
                    if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                        if trade.order.orderId == order_id:
                            # Modify the order
                            if hasattr(trade.order, 'lmtPrice'):
                                old_price = trade.order.lmtPrice
                                logger.info(f"🔧 Modifying order {order_id} from ${old_price} to ${new_price}")
                                trade.order.lmtPrice = new_price
                                modified_trade = self.ib.placeOrder(trade.contract, trade.order)
                                if modified_trade:
                                    # Await order submission to verify success
                                    status = await self.await_order_submission(modified_trade, timeout=3.0)
                                    normalized_status = (status or 'UNKNOWN').strip().upper()
                                    if normalized_status in {'CANCELLED', 'INACTIVE', 'APICANCELLED', 'REJECTED', 'ERROR'}:
                                        logger.error(f"❌ Order {order_id} modification rejected with status {normalized_status}")
                                        return False
                                    logger.info(f"✅ Modified order {order_id} price to ${new_price} (status: {normalized_status})")
                                    return True
                                else:
                                    logger.warning(f"⚠️ placeOrder returned None for order {order_id}")
                                    return False
                            else:
                                logger.warning(f"⚠️ Order {order_id} does not have lmtPrice attribute (might not be a limit order)")
                                return False
                except AttributeError:
                    continue
            
            logger.warning(f"⚠️ Order {order_id} not found for modification in any open orders")
            return False
        except Exception as e:
            logger.error(f"❌ Error modifying order {order_id}: {e}", exc_info=True)
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
            # Error 201: Minimum equity requirement for margin accounts
            if errorCode == 201 and "2500" in errorString:
                logger.error(f"❌ IBKR Error {errorCode}: Minimum equity requirement not met")
                logger.error(f"   Your account needs at least $2500 CAD (or equivalent) to place orders in a margin account")
                logger.error(f"   Solutions: 1) Deposit funds to reach $2500 minimum, 2) Switch to cash account, 3) Use paper trading account")
            else:
                logger.error(f"IBKR Error: reqId={reqId}, code={errorCode}, msg='{errorString}'")

    def on_disconnected(self):
        logger.warning("Event: IBKR Client has disconnected.")
        self._connected = False
        # The ensure_connected logic will handle reconnection on the next call.


# Singleton instance
ib_client = IBClient.instance()
