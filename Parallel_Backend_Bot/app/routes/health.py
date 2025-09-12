from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.postgres import get_db
from app.controllers.health_controller import health_check

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("/health", summary="Check DB connection")
async def health(db: AsyncSession = Depends(get_db)):
    return await health_check(db)
