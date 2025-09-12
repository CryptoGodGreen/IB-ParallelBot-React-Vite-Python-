from fastapi import HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db.models import User, UserRole
from app.utils.security import hash_password, verify_password, create_access_token
from app.schemas.user_schema import UserCreate, UserLogin, ChangePassword, ResetPassword
from app.db.postgres import get_db

async def login(user: UserLogin, db: AsyncSession):
    result = await db.execute(select(User).where(User.email == user.email))
    db_user = result.scalar()
    if not db_user or not verify_password(user.password, db_user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": str(db_user.id), "role": db_user.role})
    return {"access_token": token, "token_type": "bearer"}


async def change_password(user_id: int, payload: ChangePassword, db: AsyncSession):
    result = await db.execute(select(User).where(User.id == user_id))
    db_user = result.scalar()
    if not db_user or not verify_password(payload.old_password, db_user.password):
        raise HTTPException(status_code=400, detail="Old password is incorrect")

    db_user.password = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password changed successfully"}


async def seed_admin(db: AsyncSession):
    result = await db.execute(select(User).where(User.role == UserRole.admin))
    if not result.scalar():
        admin = User(
            email="admin@system.com",
            password=hash_password("Admin@123"),
            role=UserRole.admin,
            brokerId="system"
        )
        db.add(admin)
        await db.commit()
        print("✅ Admin seeded: admin@system.com / Admin@123")
