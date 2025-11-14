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
                status=bot.status if bot.status is not None else 'ACTIVE',
                multi_buy=bot.multi_buy if bot.multi_buy is not None else 'disabled',
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
    """Get bot status - optimized with timeout protection"""
    import asyncio
    import time
    start_time = time.time()
    
    try:
        # Get bot from database
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        
        async with AsyncSessionLocal() as session:
            try:
                result = await asyncio.wait_for(
                    session.execute(
                        select(BotInstance).where(BotInstance.id == bot_id)
                    ),
                    timeout=3.0  # 3 second timeout
                )
                bot = result.scalar_one_or_none()
            
                if not bot:
                    raise HTTPException(status_code=404, detail="Bot not found")
                
                elapsed = time.time() - start_time
                if elapsed > 1.0:
                    logger.warning(f"⚠️ /bots/status/{bot_id} query took {elapsed:.2f}s")
                
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
            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                logger.error(f"❌ /bots/status/{bot_id} query TIMEOUT after {elapsed:.2f}s")
                raise HTTPException(status_code=504, detail=f"Database query timeout after {elapsed:.2f}s")
            except HTTPException:
                raise
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Error getting bot status {bot_id} after {elapsed:.2f}s: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Failed to get bot status: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ /bots/status/{bot_id} error after {elapsed:.2f}s: {e}", exc_info=True)
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
    """List all bots - optimized with timeout protection"""
    import asyncio
    import time
    start_time = time.time()
    
    try:
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        
        async with AsyncSessionLocal() as session:
            try:
                # Use timeout to prevent hanging on slow queries
                result = await asyncio.wait_for(
                    session.execute(select(BotInstance).order_by(BotInstance.id.desc())),
                    timeout=5.0  # 5 second timeout for query
                )
                bots = result.scalars().all()
                
                elapsed = time.time() - start_time
                if elapsed > 2.0:
                    logger.warning(f"⚠️ /bots/list query took {elapsed:.2f}s ({len(bots)} bots)")
                
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
            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                logger.error(f"❌ /bots/list query TIMEOUT after {elapsed:.2f}s")
                raise HTTPException(status_code=504, detail=f"Database query timeout after {elapsed:.2f}s")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Error listing bots after {elapsed:.2f}s: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Failed to list bots: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ /bots/list error after {elapsed:.2f}s: {e}", exc_info=True)
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
    """Get trade history and current orders for a specific bot"""
    try:
        from app.db.postgres import AsyncSessionLocal
        from sqlalchemy import select
        from app.models.bot_models import BotEvent, BotInstance, BotLine
        
        async with AsyncSessionLocal() as session:
            # Get bot instance
            bot_result = await session.execute(
                select(BotInstance).where(BotInstance.id == bot_id)
            )
            bot = bot_result.scalar_one_or_none()
            
            if not bot:
                raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")
            
            # Get bot events for the specific bot
            result = await session.execute(
                select(BotEvent)
                .where(BotEvent.bot_id == bot_id)
                .order_by(BotEvent.timestamp.desc())
            )
            events = result.scalars().all()
            
            # Get bot lines (for exit orders)
            lines_result = await session.execute(
                select(BotLine)
                .where(BotLine.bot_id == bot_id)
                .where(BotLine.line_type == 'exit')
                .where(BotLine.is_active == True)
            )
            exit_lines = lines_result.scalars().all()
            
            # Track order IDs we've already included to avoid duplicates
            included_order_ids = set()
            # Track exit orders by (order_id, line_id) combination to avoid duplicates for same line
            included_exit_orders = {}  # {(order_id, line_id): trade_history_entry}
            # Track if we've found any individual entry order events (to skip summary spot_position_opened)
            # Pre-scan events to check for individual entry orders (since events are in reverse chronological order)
            has_individual_entry_orders = any(
                event.event_type in ("spot_entry_market_order", "spot_entry_limit_order")
                and (event.event_data or {}).get("order_status", "").upper() == "FILLED"
                for event in events
            )
            
            # Transform events into trade history format
            trade_history = []
            
            # First, add current pending orders from bot instance state
            # Check for pending entry order
            if bot.entry_order_id and bot.entry_order_status == 'PENDING':
                trade_history.append({
                    "side": "BUY",
                    "filled": "Pending",
                    "target": "Entry",
                    "filled_at": None,
                    "shares_filled": bot.position_size or 0,
                    "price": float(bot.current_price) if bot.current_price else 0.0,
                    "order_id": bot.entry_order_id,
                    "event_type": "entry_order_pending"
                })
                included_order_ids.add(bot.entry_order_id)
            
            # Check for stop loss order
            if bot.stop_loss_order_id and bot.is_bought:
                trade_history.append({
                    "side": "SELL",
                    "filled": "Pending",
                    "target": "Stop Loss",
                    "filled_at": None,
                    "shares_filled": bot.open_shares or 0,
                    "price": float(bot.stop_loss_price) if bot.stop_loss_price else 0.0,
                    "order_id": bot.stop_loss_order_id,
                    "event_type": "stop_loss_order_active"
                })
                included_order_ids.add(bot.stop_loss_order_id)
            
            # Add exit line orders (if they have order IDs stored in events)
            # We'll get these from events below, but also check if there are exit lines without events
            for line in exit_lines:
                # Check if this line has a pending order in events
                line_has_order = False
                for event in events:
                    if event.event_type == "exit_order_created":
                        event_data = event.event_data or {}
                        if event_data.get("line_price") == float(line.price):
                            line_has_order = True
                            break
                
                # If exit line exists but no order event, it might be waiting or the order hasn't been created yet
                # We'll rely on events for this
            
            # Now process events
            for event in events:
                event_data = event.event_data or {}
                order_id = event_data.get("order_id")
                
                # Skip if we've already included this order from current state
                if order_id and order_id in included_order_ids:
                    continue
                
                # Map event types to trade history format
                if event.event_type == "spot_entry_market_order" or event.event_type == "spot_entry_limit_order":
                    # Individual entry order (for multi-buy mode or single-buy mode)
                    # Only add if order_status is FILLED
                    order_status = event_data.get("order_status", "").upper()
                    if order_status == "FILLED":
                        has_individual_entry_orders = True  # Mark that we have individual entry orders
                        order_sequence = event_data.get("order_sequence")
                        # For multi-buy mode, show "Entry 1" and "Entry 2", otherwise just "Entry"
                        if order_sequence:
                            target_label = f"Entry {order_sequence}"
                        else:
                            target_label = "Entry"
                        trade_history.append({
                            "side": "BUY",
                            "filled": "Yes",
                            "target": target_label,
                            "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                            "shares_filled": event_data.get("shares_bought", 0),
                            "price": event_data.get("line_price", event_data.get("entry_price", 0)),
                            "order_id": order_id,
                            "event_type": event.event_type
                        })
                        if order_id:
                            included_order_ids.add(order_id)
                elif event.event_type == "spot_position_opened":
                    # Only add summary spot_position_opened if we don't have individual entry order events
                    # (spot_position_opened is a summary event, and we prefer individual entry order events)
                    if not has_individual_entry_orders and (not order_id or order_id not in included_order_ids):
                        trade_history.append({
                            "side": "BUY",
                            "filled": "Yes",
                            "target": "Entry",
                            "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                            "shares_filled": event_data.get("shares_bought", 0),
                            "price": event_data.get("entry_price", 0),
                            "order_id": order_id,
                            "event_type": event.event_type
                        })
                        if order_id:
                            included_order_ids.add(order_id)
                elif event.event_type == "options_position_opened":
                    # Options entry (PUT/CALL)
                    trade_history.append({
                        "side": "BUY",
                        "filled": "Yes",
                        "target": f"Entry (Option: {event_data.get('strike', 'N/A')} {event_data.get('expiry', 'N/A')})",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("contracts", 0),  # Contracts for options
                        "price": event_data.get("option_price", 0),
                        "order_id": order_id,
                        "event_type": event.event_type
                    })
                    if order_id:
                        included_order_ids.add(order_id)
                elif event.event_type == "spot_exit_limit_order":
                    # Individual exit limit order (can be filled or pending)
                    order_status = event_data.get("order_status", "").upper()
                    line_id = event_data.get("line_id", "")
                    # For multi-exit mode, show line identifier if available
                    if line_id:
                        target_label = f"Exit ({line_id})"
                    else:
                        target_label = "Exit"
                    
                    # Create unique key for this exit order (order_id + line_id to handle same line updates)
                    exit_key = (order_id, line_id) if order_id else None
                    
                    if order_status == "FILLED":
                        # Exit order filled - always include filled orders
                        if exit_key not in included_exit_orders:
                            trade_entry = {
                                "side": "SELL",
                                "filled": "Yes",
                                "target": target_label,
                                "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                                "shares_filled": event_data.get("shares_to_sell", 0),
                                "price": event_data.get("line_price", 0),
                                "order_id": order_id,
                                "event_type": event.event_type
                            }
                            trade_history.append(trade_entry)
                            included_exit_orders[exit_key] = trade_entry
                            if order_id:
                                included_order_ids.add(order_id)
                    elif order_status == "CANCELLED":
                        # Exit order cancelled - show as CANCELLED
                        if exit_key not in included_exit_orders:
                            trade_entry = {
                                "side": "SELL",
                                "filled": "Cancelled",
                                "target": target_label,
                                "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                                "shares_filled": event_data.get("shares_to_sell", 0),
                                "price": event_data.get("line_price", 0),
                                "order_id": order_id,
                                "event_type": event.event_type
                            }
                            trade_history.append(trade_entry)
                            included_exit_orders[exit_key] = trade_entry
                            if order_id:
                                included_order_ids.add(order_id)
                        else:
                            # Update existing order to CANCELLED status
                            existing_entry = included_exit_orders[exit_key]
                            existing_entry["filled"] = "Cancelled"
                            existing_entry["filled_at"] = event.timestamp.isoformat() if event.timestamp else None
                    else:
                        # Exit order pending - only keep the most recent pending order for each (order_id, line_id)
                        if exit_key and exit_key not in included_exit_orders:
                            trade_entry = {
                                "side": "SELL",
                                "filled": "Pending",
                                "target": target_label,
                                "filled_at": None,
                                "shares_filled": event_data.get("shares_to_sell", 0),
                                "price": event_data.get("line_price", 0),
                                "order_id": order_id,
                                "event_type": event.event_type
                            }
                            trade_history.append(trade_entry)
                            included_exit_orders[exit_key] = trade_entry
                            if order_id:
                                included_order_ids.add(order_id)
                        elif exit_key and exit_key in included_exit_orders:
                            # Update existing pending order with more recent data (events are sorted by timestamp desc)
                            existing_entry = included_exit_orders[exit_key]
                            # Only update if current status is Pending (don't overwrite FILLED or CANCELLED)
                            if existing_entry.get("filled") == "Pending":
                                # Update with more recent pending order data
                                existing_entry["shares_filled"] = event_data.get("shares_to_sell", 0)
                                existing_entry["price"] = event_data.get("line_price", 0)
                                existing_entry["order_id"] = order_id
                elif event.event_type == "spot_position_partial_exit":
                    # Legacy event type - prefer spot_exit_limit_order if available
                    # Only add if we don't already have the exit order from spot_exit_limit_order
                    if order_id not in included_order_ids:
                        trade_history.append({
                            "side": "SELL",
                            "filled": "Yes",
                            "target": "Exit",
                            "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                            "shares_filled": event_data.get("shares_sold", 0),
                            "price": event_data.get("exit_price", 0),
                            "order_id": order_id,
                            "event_type": event.event_type
                        })
                        if order_id:
                            included_order_ids.add(order_id)
                elif event.event_type == "options_position_partial_exit":
                    # Options exit
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Yes",
                        "target": "Exit (Option)",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("contracts_sold", 0),  # Contracts for options
                        "price": event_data.get("exit_price", 0),
                        "order_id": order_id,
                        "event_type": event.event_type
                    })
                    if order_id:
                        included_order_ids.add(order_id)
                elif event.event_type == "hard_stop_out_sell":
                    trade_history.append({
                        "side": "SELL",
                        "filled": "Yes",
                        "target": "Hard Stop",
                        "filled_at": event.timestamp.isoformat() if event.timestamp else None,
                        "shares_filled": event_data.get("shares_sold", 0),
                        "price": event_data.get("current_price", 0),
                        "order_id": order_id,
                        "event_type": event.event_type
                    })
                    if order_id:
                        included_order_ids.add(order_id)
                elif event.event_type == "exit_order_created":
                    # Only add if not already included
                    if not order_id or order_id not in included_order_ids:
                        trade_history.append({
                            "side": "SELL",
                            "filled": "Pending",
                            "target": "Exit",
                            "filled_at": None,
                            "shares_filled": event_data.get("shares_to_sell", 0),
                            "price": event_data.get("line_price", 0),
                            "order_id": order_id,
                            "event_type": event.event_type
                        })
                        if order_id:
                            included_order_ids.add(order_id)
                elif event.event_type == "stop_loss_order_placed":
                    # Only add if not already included (from current state)
                    if not order_id or order_id not in included_order_ids:
                        trade_history.append({
                            "side": "SELL",
                            "filled": "Pending",
                            "target": "Stop Loss",
                            "filled_at": None,
                            "shares_filled": event_data.get("quantity", 0),
                            "price": event_data.get("stop_loss_price", 0),
                            "order_id": order_id,
                            "event_type": event.event_type
                        })
                        if order_id:
                            included_order_ids.add(order_id)
            
            # Sort by timestamp (pending orders first, then by time)
            trade_history.sort(key=lambda x: (
                0 if x["filled"] == "Pending" else 1,  # Pending orders first
                x.get("filled_at") or ""  # Then by timestamp
            ), reverse=True)
            
            return trade_history
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trade history for bot {bot_id}: {e}", exc_info=True)
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
