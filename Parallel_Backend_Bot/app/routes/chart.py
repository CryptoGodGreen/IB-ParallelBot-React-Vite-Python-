from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.postgres import get_db
from app.controllers import chart_controller
from app.schemas.chart_schema import ChartCreate, ChartUpdate, ChartResponse
from app.schemas.user_schema import UserResponse
from app.utils.security import get_current_user

router = APIRouter(prefix="/charts", tags=["Charts"])

@router.post("/", response_model=ChartResponse, status_code=status.HTTP_201_CREATED)
async def create_new_chart(
    chart_data: ChartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Create a new chart layout for the authenticated user.
    The `layout_data` should be a JSON object containing coordinates and settings.
    """
    return await chart_controller.create_chart(db=db, chart_data=chart_data, current_user=current_user)

@router.get("/", response_model=List[ChartResponse])
async def get_all_user_charts(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Retrieve all saved chart layouts for the authenticated user.
    """
    return await chart_controller.get_user_charts(db=db, current_user=current_user)

@router.get("/{chart_id}", response_model=ChartResponse)
async def get_single_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Retrieve a specific chart layout by its ID.
    """
    return await chart_controller.get_chart_by_id(db=db, chart_id=chart_id, current_user=current_user)

@router.put("/{chart_id}", response_model=ChartResponse)
async def update_existing_chart(
    chart_id: int,
    chart_data: ChartUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Update a specific chart layout by its ID.
    """
    return await chart_controller.update_chart(db=db, chart_id=chart_id, chart_data=chart_data, current_user=current_user)

@router.delete("/{chart_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_chart(
    chart_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Delete a specific chart layout by its ID.
    """
    await chart_controller.delete_chart(db=db, chart_id=chart_id, current_user=current_user)
    return
