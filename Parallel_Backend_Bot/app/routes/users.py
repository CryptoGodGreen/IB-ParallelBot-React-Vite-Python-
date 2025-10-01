from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.postgres import get_db
from app.schemas.user_schema import UserCreate, UserLogin, ChangePassword, ResetPassword, UserResponse
from app.controllers import user_controller
from app.utils.security import get_current_user

router = APIRouter(prefix="/users", tags=["Users"])

@router.post("/login")
async def login(user: UserLogin, db: AsyncSession = Depends(get_db)):
    return await user_controller.login(user, db)

@router.post("/reset-password")
async def reset_password(payload: ResetPassword, db: AsyncSession = Depends(get_db)):
    return await user_controller.reset_password(payload, db)

@router.post("/change-password")
async def change_password(payload: ChangePassword, current_user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await user_controller.change_password(current_user.id, payload, db)

@router.get("/me", response_model=UserResponse, summary="Get current user profile")
async def read_users_me(current_user: UserResponse = Depends(get_current_user)):
    return current_user
