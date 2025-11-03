from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

from app.utils.security import get_current_user
from app.schemas.user_schema import UserResponse
from app.services.bot_service import bot_service
from app.models.bot_models import BotInstance, BotLine, BotEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bots", tags=["Bots"])

# Pydantic models
class BotCreateRequest(BaseModel):
    config_id: int
    symbol: str
    name: str
    position_size: int = 1000
    max_position: int = 10000

class BotLineRequest(BaseModel):
    line_type: str  # 'entry' or 'exit'
    price: float
    rank: int = 0

class BotResponse(BaseModel):
    id: int
    config_id: int
    symbol: str
    name: str
    is_active: bool
    is_running: bool
    is_bought: bool
    current_price: float
    entry_price: float
    total_position: int
    shares_entered: int
    shares_exited: int
    open_shares: int
    position_size: int
    max_position: int
    status: str  # Add status field
    multi_buy: str  # Multi-buy mode
    created_at: str
    updated_at: str

class BotStatusResponse(BaseModel):
    success: bool
    message: str
    bot: Optional[BotResponse] = None

class CancelOrdersResponse(BaseModel):
    success: bool
    message: str
    cancelled_orders: List[str] = []
    errors: List[str] = []

# Bot management endpoints
@router.post("/create", response_model=BotStatusResponse)
async def create_bot(
    request: BotCreateRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """Create a new bot instance"""
    try:
        bot = await bot_service.create_bot(request.dict())
        
        return BotStatusResponse(
            success=True,
            message=f"Bot created successfully for {request.symbol}",
            bot=BotResponse(
                id=bot.id,
                config_id=bot.config_id,
                symbol=bot.symbol,
                name=bot.name,
                is_active=bot.is_active if bot.is_active is not None else False,
                is_running=bot.is_running if bot.is_running is not None else False,
                is_bought=bot.is_bought if bot.is_bought is not None else False,
                current_price=float(bot.current_price) if bot.current_price is not None else 0.0,
                entry_price=float(bot.entry_price) if bot.entry_price is not None else 0.0,
                total_position=bot.total_position or 0,
                shares_entered=bot.shares_entered or 0,
                shares_exited=bot.shares_exited or 0,
                open_shares=bot.open_shares or 0,
                position_size=bot.position_size or 0,
                max_position=bot.max_position or 0,
                created_at=bot.created_at.isoformat(),
                updated_at=bot.updated_at.isoformat()
            )
        )
        
    except Exception as e:
        logger.error(f"Error creating bot: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create bot: {str(e)}")

@router.post("/{bot_id}/start", response_model=BotStatusResponse)
async def start_bot(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Start a bot instance"""
    try:
        success = await bot_service.start_bot(bot_id)
        
        if success:
            return BotStatusResponse(
                success=True,
                message=f"Bot {bot_id} started successfully"
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to start bot")
            
    except Exception as e:
        logger.error(f"Error starting bot {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start bot: {str(e)}")

@router.post("/{bot_id}/stop", response_model=BotStatusResponse)
async def stop_bot(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Stop a bot instance"""
    try:
        success = await bot_service.stop_bot(bot_id)
        
        if success:
            return BotStatusResponse(
                success=True,
                message=f"Bot {bot_id} stopped successfully"
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to stop bot")
            
    except Exception as e:
        logger.error(f"Error stopping bot {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop bot: {str(e)}")

@router.get("/status/{bot_id}", response_model=BotResponse)
async def get_bot_status(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Get bot status"""
    try:
        # Get bot from database
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(BotInstance).where(BotInstance.id == bot_id)
            )
            bot = result.scalar_one_or_none()
            
            if not bot:
                raise HTTPException(status_code=404, detail="Bot not found")
            
            return BotResponse(
                id=bot.id,
                config_id=bot.config_id,
                symbol=bot.symbol,
                name=bot.name,
                is_active=bot.is_active if bot.is_active is not None else False,
                is_running=bot.is_running if bot.is_running is not None else False,
                is_bought=bot.is_bought if bot.is_bought is not None else False,
                current_price=float(bot.current_price) if bot.current_price is not None else 0.0,
                entry_price=float(bot.entry_price) if bot.entry_price is not None else 0.0,
                total_position=bot.total_position or 0,
                shares_entered=bot.shares_entered or 0,
                shares_exited=bot.shares_exited or 0,
                open_shares=bot.open_shares or 0,
                position_size=bot.position_size or 0,
                max_position=bot.max_position or 0,
                status=bot.status or 'ACTIVE',
                multi_buy=bot.multi_buy or 'disabled',
                created_at=bot.created_at.isoformat(),
                updated_at=bot.updated_at.isoformat()
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting bot status {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get bot status: {str(e)}")

@router.get("/debug/{bot_id}")
async def get_bot_debug_status(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Get detailed debug status including in-memory state"""
    try:
        from app.services.bot_service import bot_service
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        from app.models.bot_models import BotInstance
        
        # Get from database
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(BotInstance).where(BotInstance.id == bot_id)
            )
            bot = result.scalar_one_or_none()
            
            if not bot:
                raise HTTPException(status_code=404, detail="Bot not found")
        
        # Get in-memory state
        bot_state = bot_service.active_bots.get(bot_id, {})
        multi_buy_tracker = bot_state.get('multi_buy_tracker', {})
        
        return {
            "database": {
                "id": bot.id,
                "config_id": bot.config_id,
                "symbol": bot.symbol,
                "is_bought": bot.is_bought,
                "shares_entered": bot.shares_entered,
                "shares_exited": bot.shares_exited,
                "open_shares": bot.open_shares,
                "position_size": bot.position_size,
                "entry_price": float(bot.entry_price) if bot.entry_price else 0,
                "multi_buy": bot.multi_buy,
                "status": bot.status,
            },
            "in_memory": {
                "is_bought": bot_state.get('is_bought', False),
                "shares_entered": bot_state.get('shares_entered', 0),
                "shares_exited": bot_state.get('shares_exited', 0),
                "open_shares": bot_state.get('open_shares', 0),
                "position_size": bot_state.get('position_size', 0),
                "entry_price": bot_state.get('entry_price', 0),
                "multi_buy": bot_state.get('multi_buy', 'disabled'),
                "current_price": bot_state.get('current_price', 0),
                "multi_buy_tracker": multi_buy_tracker,
                "entry_lines_count": len(bot_state.get('entry_lines', [])),
                "exit_lines_count": len(bot_state.get('exit_lines', [])),
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting bot debug status {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get bot debug status: {str(e)}")

@router.get("/list", response_model=List[BotResponse])
async def list_bots(
    current_user: UserResponse = Depends(get_current_user)
):
    """List all bots"""
    try:
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(BotInstance))
            bots = result.scalars().all()
            
            return [
                BotResponse(
                    id=bot.id,
                    config_id=bot.config_id,
                    symbol=bot.symbol,
                    name=bot.name,
                    is_active=bot.is_active if bot.is_active is not None else False,
                    is_running=bot.is_running if bot.is_running is not None else False,
                    is_bought=bot.is_bought if bot.is_bought is not None else False,
                    current_price=float(bot.current_price) if bot.current_price is not None else 0.0,
                    entry_price=float(bot.entry_price) if bot.entry_price is not None else 0.0,
                    total_position=bot.total_position or 0,
                    shares_entered=bot.shares_entered or 0,
                    shares_exited=bot.shares_exited or 0,
                    open_shares=bot.open_shares or 0,
                    position_size=bot.position_size or 0,
                    max_position=bot.max_position or 0,
                    status=bot.status or 'ACTIVE',  # Add status field with default
                    multi_buy=bot.multi_buy or 'disabled',  # Add multi_buy field
                    created_at=bot.created_at.isoformat(),
                    updated_at=bot.updated_at.isoformat()
                )
                for bot in bots
            ]
            
    except Exception as e:
        logger.error(f"Error listing bots: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list bots: {str(e)}")

@router.post("/{bot_id}/lines", response_model=BotStatusResponse)
async def add_bot_line(
    bot_id: int,
    request: BotLineRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """Add a line to a bot"""
    try:
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        
        async with AsyncSessionLocal() as session:
            # Check if bot exists
            result = await session.execute(
                select(BotInstance).where(BotInstance.id == bot_id)
            )
            bot = result.scalar_one_or_none()
            
            if not bot:
                raise HTTPException(status_code=404, detail="Bot not found")
            
            # Create line
            line = BotLine(
                bot_id=bot_id,
                line_type=request.line_type,
                price=request.price,
                rank=request.rank
            )
            
            session.add(line)
            await session.commit()
            
            # Reload bot state if active
            if bot_id in bot_service.active_bots:
                await bot_service._load_bot_state(bot_id)
            
            return BotStatusResponse(
                success=True,
                message=f"Line added to bot {bot_id}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding line to bot {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add line: {str(e)}")

@router.post("/{bot_id}/cancel-orders", response_model=CancelOrdersResponse)
async def cancel_all_orders(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Cancel all pending orders for a bot"""
    try:
        result = await bot_service.cancel_all_pending_orders(bot_id)
        return CancelOrdersResponse(**result)
        
    except Exception as e:
        logger.error(f"Error cancelling orders for bot {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel orders: {str(e)}")

@router.get("/{bot_id}/trade-history", response_model=List[dict])
async def get_bot_trade_history(
    bot_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Get trade history for a specific bot"""
    try:
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        from app.models.bot_models import BotEvent
        
        async with AsyncSessionLocal() as session:
            # Get bot events for the specific bot
            result = await session.execute(
                select(BotEvent)
                .where(BotEvent.bot_id == bot_id)
                .order_by(BotEvent.timestamp.desc())
            )
            events = result.scalars().all()
            
            # Transform events into trade history format
            trade_history = []
            for event in events:
                event_data = event.event_data or {}
                
                # Map event types to trade history format
                if event.event_type == "spot_position_opened":
                    trade_history.append({
                        "side": "BUY",
                        "filled": "Yes",
                        "target": "Entry",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("shares_bought", 0),
                        "price": event_data.get("entry_price", 0),
                        "order_id": event_data.get("order_id"),
                        "event_type": event.event_type
                    })
                elif event.event_type == "spot_position_partial_exit":
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Yes",
                        "target": "Exit",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("shares_sold", 0),
                        "price": event_data.get("exit_price", 0),
                        "order_id": event_data.get("order_id"),
                        "event_type": event.event_type
                    })
                elif event.event_type == "hard_stop_out_sell":
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Yes",
                        "target": "Hard Stop",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("shares_sold", 0),
                        "price": event_data.get("current_price", 0),
                        "order_id": event_data.get("order_id"),
                        "event_type": event.event_type
                    })
                elif event.event_type == "exit_order_created":
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Pending",
                        "target": "Exit",
                        "filled_at": None,
                        "shares_filled": event_data.get("shares_to_sell", 0),
                        "price": event_data.get("line_price", 0),
                        "order_id": event_data.get("order_id"),
                        "event_type": event.event_type
                    })
                elif event.event_type == "stop_loss_order_placed":
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Pending",
                        "target": "Stop Loss",
                        "filled_at": None,
                        "shares_filled": event_data.get("quantity", 0),
                        "price": event_data.get("stop_loss_price", 0),
                        "order_id": event_data.get("order_id"),
                        "event_type": event.event_type
                    })
            
            return trade_history
            
    except Exception as e:
        logger.error(f"Error getting trade history for bot {bot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get trade history: {str(e)}")

@router.get("/service/status")
async def get_service_status(
    current_user: UserResponse = Depends(get_current_user)
):
    """Get bot service status"""
    return {
        "running": bot_service._running,
        "active_bots": len(bot_service.active_bots),
        "bots": list(bot_service.active_bots.keys())
    }
