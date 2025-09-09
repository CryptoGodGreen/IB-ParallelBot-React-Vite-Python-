from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    role: str = "user"
    brokerId: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(UserBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True

class ChangePassword(BaseModel):
    old_password: str
    new_password: str

class ResetPassword(BaseModel):
    email: EmailStr
    new_password: str
