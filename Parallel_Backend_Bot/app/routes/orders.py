from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
from app.utils.security import get_current_user
from app.schemas.user_schema import UserResponse
from app.utils.ib_client import ib_client
from ib_async import Stock, MarketOrder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])

class MarketBuyOrderRequest(BaseModel):
    symbol: str
    quantity: int = 1

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
