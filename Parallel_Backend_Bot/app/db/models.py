from sqlalchemy.orm import declarative_base
from sqlalchemy import (
    Column, Integer, String, DateTime, Enum, Numeric, Boolean, ForeignKey, func, JSON
)
from sqlalchemy.orm import relationship
import enum

Base = declarative_base()

class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False)
    brokerId = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    charts = relationship("UserChart", back_populates="user", cascade="all, delete-orphan")


class UserChart(Base):
    __tablename__ = "user_charts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String, index=True, nullable=False)
    interval = Column(String, nullable=False)
    rth = Column(Boolean, default=True)
    
    # layout_data will store line coordinates, TP/SL settings, etc.
    layout_data = Column(JSON, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="charts")
