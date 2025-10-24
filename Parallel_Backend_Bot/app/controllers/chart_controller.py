from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List
import time
import logging

from app.db.models import UserChart
from app.schemas.chart_schema import ChartCreate, ChartUpdate
from app.schemas.user_schema import UserResponse

logger = logging.getLogger(__name__)

async def create_chart(db: AsyncSession, chart_data: ChartCreate, current_user: UserResponse) -> UserChart:
    """
    Creates and saves a new chart layout for the current user.
    """
    new_chart = UserChart(
        **chart_data.model_dump(),
        user_id=current_user.id
    )
    db.add(new_chart)
    await db.commit()
    await db.refresh(new_chart)
    return new_chart

async def get_user_charts(db: AsyncSession, current_user: UserResponse) -> List[UserChart]:
    """
    Retrieves all chart layouts for the current user.
    """
    result = await db.execute(
        select(UserChart).where(UserChart.user_id == current_user.id)
    )
    return result.scalars().all()

async def get_chart_by_id(db: AsyncSession, chart_id: int, current_user: UserResponse) -> UserChart:
    """
    Retrieves a single chart layout by its ID, ensuring it belongs to the current user.
    Optimized query with user_id filter for better index usage.
    """
    start_time = time.time()
    
    result = await db.execute(
        select(UserChart)
        .where(UserChart.id == chart_id)
        .where(UserChart.user_id == current_user.id)  # Use composite index
        .execution_options(synchronize_session=False)  # Skip session sync for read-only
    )
    db_chart = result.scalar_one_or_none()
    
    query_time = (time.time() - start_time) * 1000  # Convert to milliseconds
    logger.info(f"⚡ Chart query for ID {chart_id} took {query_time:.2f}ms")

    if not db_chart:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chart not found"
        )
    return db_chart

async def update_chart(
    db: AsyncSession, chart_id: int, chart_data: ChartUpdate, current_user: UserResponse
) -> UserChart:
    """
    Updates an existing chart layout, ensuring it belongs to the current user.
    When layout_data is provided, it completely replaces the existing data to prevent accumulation.
    """
    db_chart = await get_chart_by_id(db, chart_id, current_user) # Re-uses the fetch and auth logic

    update_data = chart_data.model_dump(exclude_unset=True)
    
    # Special handling for layout_data - completely replace to prevent accumulation
    if 'layout_data' in update_data:
        logger.info(f"🔄 Replacing layout_data for chart {chart_id} - clearing old drawings")
        logger.info(f"📊 New layout_data keys: {list(update_data['layout_data'].keys()) if isinstance(update_data['layout_data'], dict) else 'not a dict'}")
        
        # Completely replace layout_data to prevent accumulation of old drawings
        db_chart.layout_data = update_data['layout_data']
        # Remove from update_data to avoid double-setting
        del update_data['layout_data']
    
    # Update other fields normally
    for key, value in update_data.items():
        setattr(db_chart, key, value)
    
    await db.commit()
    await db.refresh(db_chart)
    return db_chart

async def delete_chart(db: AsyncSession, chart_id: int, current_user: UserResponse):
    """
    Deletes a chart layout and any associated bot instances, ensuring it belongs to the current user.
    """
    db_chart = await get_chart_by_id(db, chart_id, current_user) # Re-uses the fetch and auth logic

    # Import here to avoid circular imports
    from app.models.bot_models import BotInstance, BotLine, BotEvent
    from app.services.bot_service import bot_service
    
    # Find and stop any associated bot instances
    result = await db.execute(
        select(BotInstance).where(BotInstance.config_id == chart_id)
    )
    bot_instances = result.scalars().all()
    
    for bot_instance in bot_instances:
        logger.info(f"🤖 Stopping and deleting bot {bot_instance.id} for deleted config {chart_id}")
        
        # Use bot service to clean up the bot instance
        await bot_service.delete_bot_instance(bot_instance.id)
        
        # Delete associated bot lines and events from database
        lines_result = await db.execute(
            select(BotLine).where(BotLine.bot_id == bot_instance.id)
        )
        bot_lines = lines_result.scalars().all()
        for line in bot_lines:
            await db.delete(line)
        
        events_result = await db.execute(
            select(BotEvent).where(BotEvent.bot_id == bot_instance.id)
        )
        bot_events = events_result.scalars().all()
        for event in bot_events:
            await db.delete(event)
        
        # Delete the bot instance from database
        await db.delete(bot_instance)
    
    # Delete the chart
    await db.delete(db_chart)
    await db.commit()
    
    logger.info(f"🗑️ Deleted chart {chart_id} and {len(bot_instances)} associated bot instances")
    return {"detail": f"Chart deleted successfully along with {len(bot_instances)} bot instances"}
