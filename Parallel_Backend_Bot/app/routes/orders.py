from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging
import asyncio
import concurrent.futures
from app.utils.security import get_current_user
from app.schemas.user_schema import UserResponse
from app.utils.ib_client import ib_client
from app.config import settings
from ib_async import Stock, MarketOrder, LimitOrder, Order

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])

class MarketBuyOrderRequest(BaseModel):
    symbol: str
    quantity: int = 1

class MarketSellOrderRequest(BaseModel):
    symbol: str
    quantity: int = 1

class LimitOrderRequest(BaseModel):
    symbol: str
    quantity: int = 1
    limit_price: float

class LimitOrderCloseRequest(BaseModel):
    symbol: str

class OrderResponse(BaseModel):
    success: bool
    message: str
    order_id: Optional[int] = None

@router.post("/market-buy", response_model=OrderResponse)
async def place_market_buy_order(
    order_request: MarketBuyOrderRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Place a simple market buy order for testing purposes.
    """
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Qualify the stock contract
        contract = await ib_client.qualify_stock(order_request.symbol)
        if not contract:
            raise HTTPException(status_code=400, detail=f"Could not qualify symbol: {order_request.symbol}")
        
        # Create market buy order
        order = MarketOrder("BUY", order_request.quantity)
        
        # Place the order
        trade = await ib_client.place_order(contract, order)
        
        return OrderResponse(
            success=True,
            message=f"Market buy order placed for {order_request.quantity} shares of {order_request.symbol}",
            order_id=trade.order.orderId if trade.order else None
        )
        
    except Exception as e:
        logger.error(f"Error placing market buy order: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to place order: {str(e)}"
        )

@router.post("/market-sell", response_model=OrderResponse)
async def place_market_sell_order(
    order_request: MarketSellOrderRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Place a simple market sell order for testing purposes.
    """
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Qualify the stock contract
        contract = await ib_client.qualify_stock(order_request.symbol)
        if not contract:
            raise HTTPException(status_code=400, detail=f"Could not qualify symbol: {order_request.symbol}")
        
        # Create market sell order
        order = MarketOrder("SELL", order_request.quantity)
        
        # Place the order
        trade = await ib_client.place_order(contract, order)
        
        return OrderResponse(
            success=True,
            message=f"Market sell order placed for {order_request.quantity} shares of {order_request.symbol}",
            order_id=trade.order.orderId if trade.order else None
        )
        
    except Exception as e:
        logger.error(f"Error placing market sell order: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to place order: {str(e)}"
        )

@router.get("/open")
async def get_open_orders(
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Get all open orders from IB account.
    Returns orders from all clients, not just the current client ID.
    """
    logger.info("=" * 80)
    logger.info("🔍 GET /orders/open - Starting open orders request")
    logger.info(f"   Client ID: {settings.IB_CLIENT_ID}")
    logger.info(f"   IB Connected: {ib_client.ib.isConnected()}")
    
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            logger.error("❌ IBKR not connected")
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        logger.info("✅ IBKR is connected, ensuring connection...")
        # Get all open orders
        await ib_client.ensure_connected()
        logger.info("✅ Connection ensured")
        
        # Try to get all open orders (from all clients)
        # reqAllOpenOrders() requests orders from ALL clients (not just this client ID)
        # It works asynchronously - IBKR sends orders via events, so we need to wait
        open_orders = []
        initial_order_count = 0
        
        try:
            # Get initial order count (current client only) - use asyncio.to_thread to avoid blocking
            initial_orders = await asyncio.to_thread(ib_client.ib.openOrders)
            initial_order_count = len(initial_orders)
            logger.info(f"📊 Initial openOrders() count (current client): {initial_order_count}")
            
            # Set up event to wait for all orders to arrive
            orders_end_event = asyncio.Event()
            orders_received_count = 0
            original_order_ids = set()
            orders_from_events = {}  # Dictionary to store Trade objects from events: {order_id: Trade}
            
            for trade in initial_orders:
                if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                    original_order_ids.add(trade.order.orderId)
                    # Store initial orders too
                    orders_from_events[trade.order.orderId] = trade
            
            # Set up event handlers
            def on_open_order(trade):
                """Callback when an open order event is received"""
                nonlocal orders_received_count
                orders_received_count += 1
                if hasattr(trade, 'order'):
                    order_id = trade.order.orderId if hasattr(trade.order, 'orderId') else None
                    # Store the Trade object for later use
                    if order_id is not None:
                        orders_from_events[order_id] = trade
                    
                    symbol = trade.contract.symbol if hasattr(trade, 'contract') and hasattr(trade.contract, 'symbol') else 'N/A'
                    action = trade.order.action if hasattr(trade.order, 'action') else 'N/A'
                    status = trade.orderStatus.status if hasattr(trade, 'orderStatus') and hasattr(trade.orderStatus, 'status') else 'N/A'
                    if order_id not in original_order_ids:
                        logger.info(f"📨 Received NEW open order #{orders_received_count}: ID={order_id}, Symbol={symbol}, Action={action}, Status={status}")
                    else:
                        logger.debug(f"📨 Received open order event #{orders_received_count}: ID={order_id} (already known)")
            
            def on_open_order_end():
                """Callback when all open orders have been sent (openOrderEnd event)"""
                logger.info(f"✅ Received openOrderEndEvent - all orders sent (received {orders_received_count} order events, stored {len(orders_from_events)} Trade objects)")
                orders_end_event.set()
            
            # Subscribe to events
            ib_client.ib.openOrderEvent += on_open_order
            # Note: openOrderEndEvent may not exist in all versions, so we'll also use timeout
            try:
                ib_client.ib.openOrderEndEvent += on_open_order_end
                has_end_event = True
            except AttributeError:
                logger.debug("⚠️ openOrderEndEvent not available, will use timeout instead")
                has_end_event = False
            
            try:
                # Request all open orders from ALL clients
                # Use the async version to avoid event loop conflicts
                try:
                    # Try to use the async version directly if available
                    if hasattr(ib_client.ib, 'reqAllOpenOrdersAsync'):
                        await ib_client.ib.reqAllOpenOrdersAsync()
                        logger.info("📡 Requested all open orders from IBKR (reqAllOpenOrdersAsync)")
                    else:
                        # Fallback: Use a task to run the sync version in a thread
                        loop = asyncio.get_event_loop()
                        with concurrent.futures.ThreadPoolExecutor() as executor:
                            await loop.run_in_executor(executor, ib_client.ib.reqAllOpenOrders)
                        logger.info("📡 Requested all open orders from IBKR (reqAllOpenOrders via thread)")
                except AttributeError:
                    # If async version doesn't exist, use thread executor
                    loop = asyncio.get_event_loop()
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        await loop.run_in_executor(executor, ib_client.ib.reqAllOpenOrders)
                    logger.info("📡 Requested all open orders from IBKR (reqAllOpenOrders via thread)")
                
                # Wait for the end event with a timeout
                if has_end_event:
                    try:
                        await asyncio.wait_for(orders_end_event.wait(), timeout=5.0)
                        logger.info("✅ Received openOrderEndEvent - all orders have been sent")
                    except asyncio.TimeoutError:
                        logger.warning("⚠️ Timeout waiting for openOrderEndEvent (5s), checking current orders")
                else:
                    # If no end event, wait longer and poll multiple times
                    # Sometimes IBKR takes longer to send all orders
                    logger.info("⏳ Waiting for orders (no end event, will poll)...")
                    for i in range(5):  # Poll 5 times over 2.5 seconds
                        await asyncio.sleep(0.5)
                        try:
                            current_check = await asyncio.wait_for(
                                asyncio.to_thread(ib_client.ib.openOrders),
                                timeout=1.0
                            )
                            current_count = len(current_check)
                            if current_count > initial_order_count:
                                logger.info(f"📈 Found {current_count} orders after {(i+1)*0.5:.1f}s (initial: {initial_order_count})")
                        except (asyncio.TimeoutError, Exception) as e:
                            logger.debug(f"   Poll {i+1}/5: Error checking orders: {e}")
                
                # Get final list of orders (try a few more times)
                max_final_checks = 3
                final_count = 0
                for check_attempt in range(max_final_checks):
                    try:
                        open_orders = await asyncio.wait_for(
                            asyncio.to_thread(ib_client.ib.openOrders),
                            timeout=1.0
                        )
                        final_count = len(open_orders)
                        if final_count > 0 or check_attempt == max_final_checks - 1:
                            break
                    except (asyncio.TimeoutError, Exception) as e:
                        logger.debug(f"   Final check {check_attempt + 1}/{max_final_checks}: Error: {e}")
                    await asyncio.sleep(0.3)
                    logger.debug(f"   Retry {check_attempt + 1}/{max_final_checks}: Checking orders again...")
                
                new_orders = final_count - initial_order_count
                logger.info(f"✅ Final order count: {final_count} (initial: {initial_order_count}, new: {new_orders}, events received: {orders_received_count})")
                
                # Log all order IDs we found for debugging
                if final_count > 0:
                    logger.info("   Order IDs found:")
                    for trade in open_orders:
                        if hasattr(trade, 'order') and hasattr(trade.order, 'orderId'):
                            order_id = trade.order.orderId
                            symbol = trade.contract.symbol if hasattr(trade, 'contract') and hasattr(trade.contract, 'symbol') else 'N/A'
                            logger.info(f"      - Order ID: {order_id}, Symbol: {symbol}")
                
                logger.info(f"📦 Stored {len(orders_from_events)} Trade objects from openOrderEvent callbacks")
                
            finally:
                # Unsubscribe from events
                try:
                    ib_client.ib.openOrderEvent -= on_open_order
                    if has_end_event:
                        ib_client.ib.openOrderEndEvent -= on_open_order_end
                except Exception as e:
                    logger.debug(f"Error unsubscribing from events: {e}")
            
        except Exception as e:
            logger.warning(f"⚠️ reqAllOpenOrders() failed, falling back to openOrders(): {e}", exc_info=True)
            # Fallback to openOrders() which only gets orders from current client
            # Use asyncio.to_thread with timeout to avoid blocking
            try:
                open_orders = await asyncio.wait_for(
                    asyncio.to_thread(ib_client.ib.openOrders),
                    timeout=3.0
                )
                logger.info(f"✅ Got {len(open_orders)} open orders from openOrders() (current client only)")
            except asyncio.TimeoutError:
                logger.error("❌ Timeout getting openOrders() - returning empty list")
                open_orders = []
            except Exception as e2:
                logger.error(f"❌ Error getting openOrders(): {e2}")
                open_orders = []
        
        client_id = settings.IB_CLIENT_ID
        logger.info(f"Querying open orders - Client ID: {client_id}")
        logger.info(f"Found {len(open_orders)} open orders")
        
        # Debug: Log all orders found
        if len(open_orders) == 0:
            logger.debug("No open orders found")
        else:
            logger.info(f"✅ Successfully retrieved {len(open_orders)} open orders")
        
        # Also check fills and trades for debugging
        # Also cache all_trades here so we can use it to look up Order objects
        # Use asyncio.to_thread with timeout to avoid blocking
        all_trades = []
        fills = []
        try:
            # Wrap synchronous calls in asyncio.to_thread with timeout to avoid blocking
            fills = await asyncio.wait_for(
                asyncio.to_thread(ib_client.ib.fills),
                timeout=2.0
            )
            all_trades = await asyncio.wait_for(
                asyncio.to_thread(ib_client.ib.trades),
                timeout=2.0
            )
            logger.info(f"📊 Found {len(fills)} fills and {len(all_trades)} total trades (for Order lookup)")
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ Timeout getting fills/trades - continuing without trade lookup")
            all_trades = []
            fills = []
        except Exception as e:
            logger.warning(f"⚠️ Could not get fills/trades: {e}")
            all_trades = []  # Ensure it's initialized even if it fails
            fills = []
        
        # Log each open order for debugging
        for item in open_orders:
            try:
                # Check if it's a Trade object (has .order, .contract, .orderStatus)
                if hasattr(item, 'order') and hasattr(item, 'contract') and hasattr(item, 'orderStatus'):
                    trade = item
                    order_id = trade.order.orderId if hasattr(trade.order, 'orderId') else None
                    symbol = trade.contract.symbol if hasattr(trade.contract, 'symbol') else "N/A"
                    action = trade.order.action if hasattr(trade.order, 'action') else "N/A"
                    status = trade.orderStatus.status if hasattr(trade.orderStatus, 'status') else "N/A"
                    logger.info(f"  Open Order ID: {order_id}, Symbol: {symbol}, Action: {action}, Status: {status}")
                elif isinstance(item, Order) or (hasattr(item, 'orderId') and hasattr(item, 'totalQuantity')):
                    # It's an Order object (like LimitOrder)
                    order_id = getattr(item, 'orderId', None)
                    order_type = type(item).__name__
                    logger.info(f"  Open Order ID: {order_id}, Type: {order_type} (Order object, no Trade yet)")
                else:
                    # Unknown type
                    logger.warning(f"  Unexpected order object type: {type(item)}")
            except Exception as e:
                logger.error(f"  Error logging order: {e}")
        
        # Check recent fills for debugging (if available) - use cached fills from above
        try:
            if fills and len(fills) > 0:
                logger.debug(f"Found {len(fills)} fills in account")
                for fill in fills[-5:]:  # Check last 5 fills
                    exec_order_id = fill.execution.orderId if hasattr(fill.execution, 'orderId') else None
                    if exec_order_id:
                        logger.debug(f"  Recent fill for Order ID: {exec_order_id}")
        except Exception as e:
            logger.debug(f"Could not check fills: {e}")
        
        # Format the orders for response
        logger.info(f"📦 Processing {len(open_orders)} raw orders from IBKR...")
        orders = []
        skipped_count = 0
        included_count = 0
        
        for item_idx, item in enumerate(open_orders, 1):
            try:
                # Check if it's a Trade object (has .order, .contract, .orderStatus)
                if hasattr(item, 'order') and hasattr(item, 'contract') and hasattr(item, 'orderStatus'):
                    # It's a Trade object
                    trade = item
                    contract = trade.contract
                    order = trade.order
                    order_status = trade.orderStatus
                elif isinstance(item, Order) or (hasattr(item, 'orderId') and hasattr(item, 'totalQuantity')):
                    # It's an Order object (like LimitOrder, MarketOrder, etc.) - try to find the corresponding Trade
                    order_id = getattr(item, 'orderId', None)
                    order_type_name = type(item).__name__
                    
                    logger.info(f"📋 Received Order object (type: {order_type_name}) - orderId: {order_id}")
                    
                    # Try to find this order in the trades() list (use cached all_trades only, no blocking calls)
                    trade = None
                    contract = None
                    order = item
                    order_status = None
                    
                    # First, try to find Trade from events cache (this includes orders with orderId=0)
                    if order_id is not None and order_id in orders_from_events:
                        trade = orders_from_events[order_id]
                        logger.info(f"   ✅ Found Trade for order {order_id} in events cache")
                    
                    # If not found in events, try to find Trade by orderId in cached trades
                    if not trade and order_id and order_id != 0:
                        try:
                            # Only check cached trades - don't fetch fresh to avoid blocking
                            for t in all_trades:
                                if hasattr(t, 'order') and hasattr(t.order, 'orderId') and t.order.orderId == order_id:
                                    trade = t
                                    logger.info(f"   ✅ Found Trade for order {order_id} in cached trades list")
                                    break
                        except Exception as e:
                            logger.warning(f"   ⚠️ Error looking up Trade for order {order_id}: {e}")
                    
                    # Also try to match by comparing Order objects directly (for orderId=0 cases)
                    # Compare key attributes to find matching Trade
                    if not trade:
                        try:
                            item_total_qty = getattr(item, 'totalQuantity', None)
                            item_action = getattr(item, 'action', None)
                            item_order_type = getattr(item, 'orderType', None)
                            item_lmt_price = getattr(item, 'lmtPrice', None)
                            
                            for stored_order_id, stored_trade in orders_from_events.items():
                                if hasattr(stored_trade, 'order'):
                                    stored_order = stored_trade.order
                                    # Compare key attributes
                                    stored_total_qty = getattr(stored_order, 'totalQuantity', None)
                                    stored_action = getattr(stored_order, 'action', None)
                                    stored_order_type = getattr(stored_order, 'orderType', None)
                                    stored_lmt_price = getattr(stored_order, 'lmtPrice', None)
                                    
                                    # Match if key attributes match
                                    if (item_total_qty == stored_total_qty and
                                        item_action == stored_action and
                                        item_order_type == stored_order_type):
                                        # Check limit price if available (allow small floating point differences)
                                        if item_lmt_price is None and stored_lmt_price is None:
                                            trade = stored_trade
                                            logger.info(f"   ✅ Found Trade for order {order_id} by matching Order attributes (matched stored order {stored_order_id})")
                                            break
                                        elif item_lmt_price is not None and stored_lmt_price is not None:
                                            if abs(item_lmt_price - stored_lmt_price) < 0.01:
                                                trade = stored_trade
                                                logger.info(f"   ✅ Found Trade for order {order_id} by matching Order attributes (matched stored order {stored_order_id})")
                                                break
                        except Exception as e:
                            logger.debug(f"   Error matching Order by attributes: {e}")
                    
                    if trade:
                        # Found Trade - use its contract and status
                        contract = trade.contract
                        order = trade.order
                        order_status = trade.orderStatus
                        logger.info(f"   ✅ Successfully resolved Order {order_id} to Trade object")
                    else:
                        # No Trade found - try to get contract info from Order object itself
                        logger.info(f"   🔧 Order {order_id} has no Trade object, trying to extract info from Order itself...")
                        
                        # Check if Order has contract attribute (some Order objects might have it)
                        if hasattr(item, 'contract') and item.contract:
                            contract = item.contract
                            logger.info(f"   ✅ Found contract in Order object")
                        
                        # Check if Order has conId - we might be able to look up contract from cached trades
                        elif hasattr(item, 'conId') and item.conId:
                            con_id = item.conId
                            logger.info(f"   🔍 Order has conId={con_id}, attempting to look up contract from cached trades...")
                            try:
                                for t in all_trades:
                                    if hasattr(t, 'contract') and hasattr(t.contract, 'conId') and t.contract.conId == con_id:
                                        contract = t.contract
                                        logger.info(f"   ✅ Found contract by conId={con_id} in cached trades")
                                        break
                            except Exception as e:
                                logger.debug(f"   Error looking up contract by conId: {e}")
                        
                        # If still no contract, we'll try to display with minimal info
                        # Note: Order objects from openOrders() when orderId=0 might not have contract info
                        # This is expected for orders from other clients or system orders
                        if not contract:
                            logger.warning(f"   ⚠️ Cannot determine contract for order {order_id} - will display with minimal info")
                            # We'll handle this in the response formatting below - use fallback values
                        
                        # Try to get order status from fills or create default
                        if not order_status:
                            total_qty = getattr(item, 'totalQuantity', 0) if hasattr(item, 'totalQuantity') else 0
                            filled_qty = getattr(item, 'filledQuantity', 0) if hasattr(item, 'filledQuantity') else 0
                            # Check fills for this order (if orderId is valid)
                            if order_id and order_id != 0 and fills:
                                try:
                                    for fill in fills:
                                        if hasattr(fill, 'execution') and hasattr(fill.execution, 'orderId'):
                                            if fill.execution.orderId == order_id:
                                                order_status = type('obj', (object,), {
                                                    'status': 'Filled',
                                                    'filled': getattr(fill.execution, 'shares', filled_qty),
                                                    'remaining': 0
                                                })()
                                                logger.info(f"   ✅ Found fill status for order {order_id}")
                                                break
                                except Exception as e:
                                    logger.debug(f"   Error checking fills: {e}")
                            
                            # Create default status if still not found
                            if not order_status:
                                order_status = type('obj', (object,), {
                                    'status': 'Submitted',
                                    'filled': filled_qty,
                                    'remaining': max(0, total_qty - filled_qty)
                                })()
                        
                        logger.info(f"   ✅ Processing Order object directly for order {order_id}")
                else:
                    logger.warning(f"   ⚠️ Skipping unexpected order object type: {type(item)}")
                    skipped_count += 1
                    continue
                
                # Get contract details - handle case where contract might be None
                if contract:
                    symbol = contract.symbol if hasattr(contract, 'symbol') else "N/A"
                    sec_type = contract.secType if hasattr(contract, 'secType') else "N/A"
                    exchange = contract.exchange if hasattr(contract, 'exchange') else "N/A"
                    currency = contract.currency if hasattr(contract, 'currency') else "N/A"
                else:
                    # No contract available - try to extract what we can from order
                    # Some orders might have symbol in order attributes (unlikely but possible)
                    symbol = getattr(item, 'symbol', None) or "Unknown"
                    sec_type = getattr(item, 'secType', None) or "UNKNOWN"
                    exchange = getattr(item, 'exchange', None) or "N/A"
                    currency = getattr(item, 'currency', None) or "USD"
                    logger.warning(f"   ⚠️ Using fallback contract info: symbol={symbol}, secType={sec_type}")
                
                # Get order details
                action = order.action if hasattr(order, 'action') else "N/A"
                total_quantity = order.totalQuantity if hasattr(order, 'totalQuantity') else 0
                order_type = order.orderType if hasattr(order, 'orderType') else "N/A"
                lmt_price = order.lmtPrice if hasattr(order, 'lmtPrice') else None
                aux_price = order.auxPrice if hasattr(order, 'auxPrice') else None
                order_id = order.orderId if hasattr(order, 'orderId') else None
                
                # Get status
                status = order_status.status if hasattr(order_status, 'status') else "Unknown"
                filled = order_status.filled if hasattr(order_status, 'filled') else 0
                remaining = order_status.remaining if hasattr(order_status, 'remaining') else total_quantity
                
                # Log order details BEFORE filtering for debugging
                logger.info(f"🔍 [{item_idx}/{len(open_orders)}] Processing order: ID={order_id}, Symbol={symbol}, Status='{status}', Filled={filled}, Remaining={remaining}, Total={total_quantity}, Action={action}")
                
                # Only include orders that are actually open (not fully filled or cancelled)
                # Be very lenient - include all orders that are not explicitly filled/cancelled
                status_lower = status.lower() if status else ""
                
                # Skip ONLY if status is clearly filled/cancelled AND remaining is 0
                # This ensures we include all pending/submitted/pre-submitted orders
                if status_lower == 'filled' and remaining == 0:
                    logger.info(f"   ⏭️ SKIPPING: Fully filled order {order_id} (status='{status}', remaining=0)")
                    skipped_count += 1
                    continue
                elif status_lower in ['cancelled', 'canceled'] and remaining == 0:
                    logger.info(f"   ⏭️ SKIPPING: Cancelled order {order_id} (status='{status}', remaining=0)")
                    skipped_count += 1
                    continue
                
                # Include ALL other orders (Submitted, PreSubmitted, PendingSubmit, PendingCancel, ApiPending, etc.)
                # Even if remaining is 0, as long as status is not filled/cancelled
                logger.info(f"   ✅ INCLUDING: Order {order_id} (status='{status}', remaining={remaining}, filled={filled})")
                included_count += 1
                
                # Format contract display name
                if sec_type == "OPT":
                    # For options, include strike and right
                    if contract:
                        strike = contract.strike if hasattr(contract, 'strike') else 0
                        right = contract.right if hasattr(contract, 'right') else ""
                        expiry = contract.lastTradeDateOrContractMonth if hasattr(contract, 'lastTradeDateOrContractMonth') else ""
                    else:
                        # Try to get from order attributes (fallback)
                        strike = getattr(item, 'strike', 0) or 0
                        right = getattr(item, 'right', "") or ""
                        expiry = getattr(item, 'expiry', "") or getattr(item, 'lastTradeDateOrContractMonth', "") or ""
                    contract_display = f"{symbol} {expiry} {strike} {right}" if (expiry or strike or right) else symbol
                else:
                    contract_display = symbol
                
                orders.append({
                    "order_id": order_id,
                    "contract_display": contract_display,
                    "symbol": symbol,
                    "sec_type": sec_type,
                    "exchange": exchange,
                    "currency": currency,
                    "action": action,
                    "total_quantity": total_quantity,
                    "filled": filled,
                    "remaining": remaining,
                    "order_type": order_type,
                    "limit_price": float(lmt_price) if lmt_price else None,
                    "aux_price": float(aux_price) if aux_price else None,
                    "status": status,
                })
                logger.info(f"   ✓ Added order to response: ID={order_id}, Symbol={symbol}, Status={status}, Remaining={remaining}")
            except Exception as e:
                logger.error(f"❌ Error processing order {item_idx} in list: {e}", exc_info=True)
                skipped_count += 1
                continue
        
        logger.info("=" * 80)
        logger.info(f"📊 Order Processing Summary:")
        logger.info(f"   Raw orders from IBKR: {len(open_orders)}")
        logger.info(f"   Included in response: {included_count}")
        logger.info(f"   Skipped: {skipped_count}")
        logger.info(f"   Final orders array length: {len(orders)}")
        logger.info("=" * 80)
        logger.info(f"📊 GET /orders/open - Returning {len(orders)} orders")
        if len(orders) > 0:
            for i, order in enumerate(orders, 1):
                logger.info(f"   Order {i}: ID={order.get('order_id')}, Symbol={order.get('symbol')}, Action={order.get('action')}, Status={order.get('status')}, Remaining={order.get('remaining')}")
        logger.info("=" * 80)
        
        return {"orders": orders, "count": len(orders)}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting open orders: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get open orders: {str(e)}"
        )

@router.get("/positions")
async def get_positions(
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Get all positions (holdings) from IB account.
    """
    logger.info("🔍 GET /orders/positions - Starting positions request")
    
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            logger.error("❌ IBKR not connected")
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        await ib_client.ensure_connected()
        
        # Get positions using ib_client
        positions = await ib_client.get_positions()
        logger.info(f"📊 Got {len(positions)} positions from IBKR")
        
        # Get portfolio for additional info (average cost, market value, etc.)
        portfolio = await ib_client.get_portfolio()
        logger.info(f"📊 Got {len(portfolio)} portfolio items from IBKR")
        
        # Create a mapping of portfolio items by contract for quick lookup
        portfolio_map = {}
        for item in portfolio:
            try:
                contract = item.contract
                key = f"{contract.symbol}_{contract.secType}_{contract.currency}"
                if contract.secType == "OPT":
                    key += f"_{contract.lastTradeDateOrContractMonth}_{contract.strike}_{contract.right}"
                portfolio_map[key] = item
            except Exception as e:
                logger.debug(f"Error processing portfolio item: {e}")
                continue
        
        # Format positions for response
        formatted_positions = []
        for pos in positions:
            try:
                contract = pos.contract
                symbol = contract.symbol if hasattr(contract, 'symbol') else "N/A"
                sec_type = contract.secType if hasattr(contract, 'secType') else "STK"
                exchange = contract.exchange if hasattr(contract, 'exchange') else "N/A"
                currency = contract.currency if hasattr(contract, 'currency') else "USD"
                
                position_size = pos.position if hasattr(pos, 'position') else 0
                avg_cost = pos.avgCost if hasattr(pos, 'avgCost') else 0.0
                
                # Try to get additional info from portfolio
                portfolio_key = f"{symbol}_{sec_type}_{currency}"
                if sec_type == "OPT":
                    expiry = contract.lastTradeDateOrContractMonth if hasattr(contract, 'lastTradeDateOrContractMonth') else ""
                    strike = contract.strike if hasattr(contract, 'strike') else 0
                    right = contract.right if hasattr(contract, 'right') else ""
                    portfolio_key += f"_{expiry}_{strike}_{right}"
                
                portfolio_item = portfolio_map.get(portfolio_key)
                market_price = portfolio_item.marketPrice if portfolio_item and hasattr(portfolio_item, 'marketPrice') else avg_cost
                market_value = portfolio_item.marketValue if portfolio_item and hasattr(portfolio_item, 'marketValue') else (position_size * market_price)
                unrealized_pnl = portfolio_item.unrealizedPNL if portfolio_item and hasattr(portfolio_item, 'unrealizedPNL') else 0.0
                realized_pnl = portfolio_item.realizedPNL if portfolio_item and hasattr(portfolio_item, 'realizedPNL') else 0.0
                
                # Format contract display name
                if sec_type == "OPT":
                    expiry_display = expiry if expiry else "N/A"
                    strike_display = strike if strike else 0
                    right_display = right if right else ""
                    contract_display = f"{symbol} {expiry_display} {strike_display} {right_display}"
                else:
                    contract_display = symbol
                
                formatted_positions.append({
                    "symbol": symbol,
                    "contract_display": contract_display,
                    "sec_type": sec_type,
                    "exchange": exchange,
                    "currency": currency,
                    "position": position_size,
                    "avg_cost": float(avg_cost) if avg_cost else 0.0,
                    "market_price": float(market_price) if market_price else 0.0,
                    "market_value": float(market_value) if market_value else 0.0,
                    "unrealized_pnl": float(unrealized_pnl) if unrealized_pnl else 0.0,
                    "realized_pnl": float(realized_pnl) if realized_pnl else 0.0,
                })
                
                logger.debug(f"   Position: {contract_display}, Size: {position_size}, Avg Cost: ${avg_cost:.2f}, Market Price: ${market_price:.2f}")
                
            except Exception as e:
                logger.error(f"Error processing position: {e}", exc_info=True)
                continue
        
        logger.info(f"✅ Returning {len(formatted_positions)} positions")
        return {"positions": formatted_positions, "count": len(formatted_positions)}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting positions: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get positions: {str(e)}"
        )

@router.post("/{order_id}/cancel", response_model=OrderResponse)
async def cancel_order(
    order_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Cancel an open order by its ID.
    """
    try:
        logger.info(f"🔴 Request to cancel order {order_id}")
        
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        await ib_client.ensure_connected()
        
        # Cancel the order using ib_client
        success = await ib_client.cancel_order(order_id)
        
        if success:
            logger.info(f"✅ Successfully cancelled order {order_id}")
            return OrderResponse(
                success=True,
                message=f"Order {order_id} cancelled successfully",
                order_id=order_id
            )
        else:
            logger.warning(f"⚠️ Order {order_id} not found or could not be cancelled")
            raise HTTPException(
                status_code=404,
                detail=f"Order {order_id} not found or could not be cancelled"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error cancelling order {order_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel order: {str(e)}"
        )

@router.post("/limit-close-all", response_model=OrderResponse)
async def close_all_limit_orders(
    request: LimitOrderCloseRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """Cancel all open limit orders for a given symbol."""
    symbol = request.symbol.upper()
    logger.info(f"🔴 Request to cancel all limit orders for {symbol}")

    try:
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")

        await ib_client.ensure_connected()

        try:
            open_orders_payload = await get_open_orders(current_user=current_user)
            open_orders = open_orders_payload.get("orders", [])
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Could not retrieve open orders via helper: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve open orders")

        target_orders = []
        for order in open_orders:
            try:
                order_symbol = (order.get('symbol') or '').strip().upper()
                if order_symbol != symbol:
                    continue

                order_type = (order.get('order_type') or '').upper()
                if 'LMT' not in order_type:
                    continue

                order_status = (order.get('status') or '').upper()
                if order_status in ['FILLED', 'CANCELLED']:
                    continue

                order_id = order.get('order_id')
                if order_id is None:
                    continue

                target_orders.append(order_id)
            except Exception as e:
                logger.debug(f"Error processing order entry: {e}")
                continue

        if not target_orders:
            logger.info(f"No limit orders found to cancel for {symbol}")
            return OrderResponse(success=True, message=f"No limit orders found for {symbol}")

        logger.info(f"Found {len(target_orders)} limit orders for {symbol}: {target_orders}")

        cancelled = 0
        failures = []
        for order_id in target_orders:
            try:
                success = await ib_client.cancel_order(order_id)
                if success:
                    cancelled += 1
                else:
                    failures.append(order_id)
            except Exception as e:
                logger.error(f"❌ Error cancelling order {order_id}: {e}")
                failures.append(order_id)

        message = f"Cancelled {cancelled} limit order(s) for {symbol}."
        if failures:
            message += f" Failed to cancel: {', '.join(str(i) for i in failures)}."

        logger.info(message)
        return OrderResponse(success=bool(cancelled), message=message)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error closing limit orders for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to close limit orders: {str(e)}")

@router.post("/limit-buy", response_model=OrderResponse)
async def place_limit_buy_order(
    order_request: LimitOrderRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Place a limit buy order for testing purposes.
    """
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Qualify the stock contract
        contract = await ib_client.qualify_stock(order_request.symbol)
        if not contract:
            raise HTTPException(status_code=400, detail=f"Could not qualify symbol: {order_request.symbol}")
        
        # Create limit buy order
        order = LimitOrder("BUY", order_request.quantity, order_request.limit_price)
        
        # Place the order
        trade = await ib_client.place_order(contract, order)
        
        order_id = trade.order.orderId if trade.order else None
        client_id = settings.IB_CLIENT_ID
        logger.info(f"Limit buy order placed: order_id={order_id}, symbol={order_request.symbol}, quantity={order_request.quantity}, price={order_request.limit_price}, client_id={client_id}")
        
        # Verify order is in openOrders after a brief moment
        # Note: This might not work if the order fills immediately or is rejected
        try:
            open_orders_check = await asyncio.wait_for(
                asyncio.to_thread(ib_client.ib.openOrders),
                timeout=2.0
            )
            order_found = False
            for item in open_orders_check:
                try:
                    if hasattr(item, 'order') and hasattr(item.order, 'orderId'):
                        if item.order.orderId == order_id:
                            order_found = True
                            break
                except Exception:
                    continue
            logger.info(f"Order {order_id} found in openOrders() immediately after placement: {order_found}")
            if not order_found:
                logger.warning(f"Order {order_id} not found in openOrders() - might be filled, rejected, or need reqAllOpenOrders()")
        except asyncio.TimeoutError:
            logger.warning(f"Timeout verifying order {order_id} in openOrders()")
        except Exception as e:
            logger.warning(f"Could not verify order {order_id} in openOrders(): {e}")
        
        return OrderResponse(
            success=True,
            message=f"Limit buy order placed for {order_request.quantity} shares of {order_request.symbol} at ${order_request.limit_price:.2f}",
            order_id=order_id
        )
        
    except Exception as e:
        logger.error(f"Error placing limit buy order: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to place order: {str(e)}"
        )

@router.post("/limit-sell", response_model=OrderResponse)
async def place_limit_sell_order(
    order_request: LimitOrderRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Place a limit sell order for testing purposes.
    """
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Qualify the stock contract
        contract = await ib_client.qualify_stock(order_request.symbol)
        if not contract:
            raise HTTPException(status_code=400, detail=f"Could not qualify symbol: {order_request.symbol}")
        
        # Create limit sell order
        order = LimitOrder("SELL", order_request.quantity, order_request.limit_price)
        
        # Place the order
        trade = await ib_client.place_order(contract, order)
        
        order_id = trade.order.orderId if trade.order else None
        client_id = settings.IB_CLIENT_ID
        logger.info(f"Limit sell order placed: order_id={order_id}, symbol={order_request.symbol}, quantity={order_request.quantity}, price={order_request.limit_price}, client_id={client_id}")
        
        return OrderResponse(
            success=True,
            message=f"Limit sell order placed for {order_request.quantity} shares of {order_request.symbol} at ${order_request.limit_price:.2f}",
            order_id=order_id
        )
        
    except Exception as e:
        logger.error(f"Error placing limit sell order: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to place order: {str(e)}"
        )
