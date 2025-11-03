from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging
from app.utils.security import get_current_user
from app.schemas.user_schema import UserResponse
from app.utils.ib_client import ib_client
from app.config import settings
from ib_async import Stock, MarketOrder, LimitOrder

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
    """
    try:
        # Ensure IBKR connection
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Get all open orders
        await ib_client.ensure_connected()
        
        # Get open orders - this returns orders placed by this client
        # Note: reqAllOpenOrders() can cause event loop conflicts, so we use openOrders() directly
        open_orders = ib_client.ib.openOrders()
        
        client_id = settings.IB_CLIENT_ID
        logger.info(f"Querying open orders - Client ID: {client_id}")
        logger.info(f"Found {len(open_orders)} open orders from openOrders()")
        
        # Also check fills and trades for debugging
        fills = ib_client.ib.fills()
        all_trades = ib_client.ib.trades()
        logger.info(f"Found {len(fills)} fills and {len(all_trades)} total trades")
        
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
                else:
                    # It might be an Order object directly
                    logger.warning(f"  Unexpected order object type: {type(item)}, attributes: {dir(item)}")
            except Exception as e:
                logger.error(f"  Error logging order: {e}")
        
        # Check if order 8897 (or recent orders) are in fills
        for fill in fills[-10:]:  # Check last 10 fills
            exec_order_id = fill.execution.orderId if hasattr(fill.execution, 'orderId') else None
            if exec_order_id:
                logger.info(f"  Fill for Order ID: {exec_order_id}")
        
        # Format the orders for response
        orders = []
        for item in open_orders:
            try:
                # Check if it's a Trade object (has .order, .contract, .orderStatus)
                if hasattr(item, 'order') and hasattr(item, 'contract') and hasattr(item, 'orderStatus'):
                    # It's a Trade object
                    trade = item
                    contract = trade.contract
                    order = trade.order
                    order_status = trade.orderStatus
                elif hasattr(item, 'orderId'):
                    # It's an Order object directly - we need contract and status from elsewhere
                    logger.warning(f"Received Order object directly (not Trade) - orderId: {getattr(item, 'orderId', 'N/A')}")
                    # Skip this for now as we need contract info
                    continue
                else:
                    logger.warning(f"Skipping unexpected order object type: {type(item)}")
                    continue
                
                # Get contract details
                symbol = contract.symbol if hasattr(contract, 'symbol') else "N/A"
                sec_type = contract.secType if hasattr(contract, 'secType') else "N/A"
                exchange = contract.exchange if hasattr(contract, 'exchange') else "N/A"
                currency = contract.currency if hasattr(contract, 'currency') else "N/A"
                
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
                
                # Format contract display name
                if sec_type == "OPT":
                    # For options, include strike and right
                    strike = contract.strike if hasattr(contract, 'strike') else 0
                    right = contract.right if hasattr(contract, 'right') else ""
                    expiry = contract.lastTradeDateOrContractMonth if hasattr(contract, 'lastTradeDateOrContractMonth') else ""
                    contract_display = f"{symbol} {expiry} {strike} {right}"
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
            except Exception as e:
                logger.error(f"Error processing order in list: {e}")
                continue
        
        return {"orders": orders, "count": len(orders)}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting open orders: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get open orders: {str(e)}"
        )

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
            open_orders_check = ib_client.ib.openOrders()
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
