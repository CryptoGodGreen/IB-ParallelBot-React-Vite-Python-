from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
from decimal import Decimal

from app.utils.security import get_current_user
from app.schemas.user_schema import UserResponse
from app.models.bot_config import BotConfiguration
from app.db.postgres import AsyncSessionLocal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bot-config", tags=["Bot Configuration"])

class BotConfigResponse(BaseModel):
    id: Optional[int] = None
    email_updates: bool = True
    default_trade_size: float = 10000.0
    stop_loss_5m: float = 5.0
    stop_loss_minutes_5m: int = 5
    hard_stop_5m: float = 5.0
    stop_loss_15m: float = 5.0
    stop_loss_minutes_15m: int = 5
    hard_stop_15m: float = 5.0
    stop_loss_1h: float = 5.0
    stop_loss_minutes_1h: int = 5
    hard_stop_1h: float = 5.0
    symbols: str = "AAPL,SPY,TSLA,MSFT,GOOGL,EUR,CAD"

class BotConfigUpdate(BaseModel):
    email_updates: Optional[bool] = None
    default_trade_size: Optional[float] = None
    stop_loss_5m: Optional[float] = None
    stop_loss_minutes_5m: Optional[int] = None
    hard_stop_5m: Optional[float] = None
    stop_loss_15m: Optional[float] = None
    stop_loss_minutes_15m: Optional[int] = None
    hard_stop_15m: Optional[float] = None
    stop_loss_1h: Optional[float] = None
    stop_loss_minutes_1h: Optional[int] = None
    hard_stop_1h: Optional[float] = None
    symbols: Optional[str] = None

@router.get("", response_model=BotConfigResponse)
async def get_bot_config(
    current_user: UserResponse = Depends(get_current_user)
):
    """Get the current bot configuration"""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(BotConfiguration).order_by(BotConfiguration.id.desc()).limit(1)
            )
            config = result.scalar_one_or_none()
            
            if not config:
                # Return default configuration
                return BotConfigResponse()
            
            return BotConfigResponse(
                id=config.id,
                email_updates=config.email_updates,
                default_trade_size=float(config.default_trade_size) if config.default_trade_size else 10000.0,
                stop_loss_5m=float(config.stop_loss_5m) if config.stop_loss_5m else 5.0,
                stop_loss_minutes_5m=config.stop_loss_minutes_5m or 5,
                hard_stop_5m=float(config.hard_stop_5m) if config.hard_stop_5m else 5.0,
                stop_loss_15m=float(config.stop_loss_15m) if config.stop_loss_15m else 5.0,
                stop_loss_minutes_15m=config.stop_loss_minutes_15m or 5,
                hard_stop_15m=float(config.hard_stop_15m) if config.hard_stop_15m else 5.0,
                stop_loss_1h=float(config.stop_loss_1h) if config.stop_loss_1h else 5.0,
                stop_loss_minutes_1h=config.stop_loss_minutes_1h or 5,
                hard_stop_1h=float(config.hard_stop_1h) if config.hard_stop_1h else 5.0,
                symbols=config.symbols or "AAPL,SPY,TSLA,MSFT,GOOGL,EUR,CAD"
            )
    except Exception as e:
        logger.error(f"Error getting bot configuration: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get bot configuration: {str(e)}")

@router.put("", response_model=BotConfigResponse)
async def update_bot_config(
    config_data: BotConfigUpdate,
    current_user: UserResponse = Depends(get_current_user)
):
    """Update the bot configuration"""
    try:
        from datetime import datetime
        from sqlalchemy import update as sql_update
        
        async with AsyncSessionLocal() as session:
            # Get existing config or create new
            result = await session.execute(
                select(BotConfiguration).order_by(BotConfiguration.id.desc()).limit(1)
            )
            config = result.scalar_one_or_none()
            
            update_values = {
                'updated_at': datetime.now()
            }
            
            # Only update fields that are provided
            if config_data.email_updates is not None:
                update_values['email_updates'] = config_data.email_updates
            if config_data.default_trade_size is not None:
                update_values['default_trade_size'] = Decimal(str(config_data.default_trade_size))
            if config_data.stop_loss_5m is not None:
                update_values['stop_loss_5m'] = Decimal(str(config_data.stop_loss_5m))
            if config_data.stop_loss_minutes_5m is not None:
                update_values['stop_loss_minutes_5m'] = config_data.stop_loss_minutes_5m
            if config_data.hard_stop_5m is not None:
                update_values['hard_stop_5m'] = Decimal(str(config_data.hard_stop_5m))
            if config_data.stop_loss_15m is not None:
                update_values['stop_loss_15m'] = Decimal(str(config_data.stop_loss_15m))
            if config_data.stop_loss_minutes_15m is not None:
                update_values['stop_loss_minutes_15m'] = config_data.stop_loss_minutes_15m
            if config_data.hard_stop_15m is not None:
                update_values['hard_stop_15m'] = Decimal(str(config_data.hard_stop_15m))
            if config_data.stop_loss_1h is not None:
                update_values['stop_loss_1h'] = Decimal(str(config_data.stop_loss_1h))
            if config_data.stop_loss_minutes_1h is not None:
                update_values['stop_loss_minutes_1h'] = config_data.stop_loss_minutes_1h
            if config_data.hard_stop_1h is not None:
                update_values['hard_stop_1h'] = Decimal(str(config_data.hard_stop_1h))
            if config_data.symbols is not None:
                update_values['symbols'] = config_data.symbols
            
            if config:
                # Update existing
                await session.execute(
                    sql_update(BotConfiguration)
                    .where(BotConfiguration.id == config.id)
                    .values(**update_values)
                )
                await session.commit()
                
                # Fetch updated config
                result = await session.execute(
                    select(BotConfiguration).where(BotConfiguration.id == config.id)
                )
                updated_config = result.scalar_one()
            else:
                # Create new config
                new_config = BotConfiguration(**update_values)
                session.add(new_config)
                await session.commit()
                await session.refresh(new_config)
                updated_config = new_config
            
            return BotConfigResponse(
                id=updated_config.id,
                email_updates=updated_config.email_updates,
                default_trade_size=float(updated_config.default_trade_size) if updated_config.default_trade_size else 10000.0,
                stop_loss_5m=float(updated_config.stop_loss_5m) if updated_config.stop_loss_5m else 5.0,
                stop_loss_minutes_5m=updated_config.stop_loss_minutes_5m or 5,
                hard_stop_5m=float(updated_config.hard_stop_5m) if updated_config.hard_stop_5m else 5.0,
                stop_loss_15m=float(updated_config.stop_loss_15m) if updated_config.stop_loss_15m else 5.0,
                stop_loss_minutes_15m=updated_config.stop_loss_minutes_15m or 5,
                hard_stop_15m=float(updated_config.hard_stop_15m) if updated_config.hard_stop_15m else 5.0,
                stop_loss_1h=float(updated_config.stop_loss_1h) if updated_config.stop_loss_1h else 5.0,
                stop_loss_minutes_1h=updated_config.stop_loss_minutes_1h or 5,
                hard_stop_1h=float(updated_config.hard_stop_1h) if updated_config.hard_stop_1h else 5.0,
                symbols=updated_config.symbols or "AAPL,SPY,TSLA,MSFT,GOOGL,EUR,CAD"
            )
    except Exception as e:
        logger.error(f"Error updating bot configuration: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update bot configuration: {str(e)}")

