from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.db.models import UserChart
from app.schemas.chart_schema import ChartCreate, ChartUpdate
from app.schemas.user_schema import UserResponse

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
    """
    result = await db.execute(
        select(UserChart).where(UserChart.id == chart_id)
    )
    db_chart = result.scalar_one_or_none()

    if not db_chart or db_chart.user_id != current_user.id:
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
    """
    db_chart = await get_chart_by_id(db, chart_id, current_user) # Re-uses the fetch and auth logic

    update_data = chart_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_chart, key, value)
    
    await db.commit()
    await db.refresh(db_chart)
    return db_chart

async def delete_chart(db: AsyncSession, chart_id: int, current_user: UserResponse):
    """
    Deletes a chart layout, ensuring it belongs to the current user.
    """
    db_chart = await get_chart_by_id(db, chart_id, current_user) # Re-uses the fetch and auth logic

    await db.delete(db_chart)
    await db.commit()
    return {"detail": "Chart deleted successfully"}
