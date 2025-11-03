from sqlalchemy import Column, Integer, String, Boolean, DECIMAL, DateTime, func
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class BotConfiguration(Base):
    """Global bot configuration settings for stop loss and trading parameters"""
    __tablename__ = "bot_configurations"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Email updates
    email_updates = Column(Boolean, default=True)
    
    # Default trade size
    default_trade_size = Column(DECIMAL(10, 2), default=10000.00)
    
    # 5-minute interval settings
    stop_loss_5m = Column(DECIMAL(5, 2), default=5.0)  # Soft stop percentage
    stop_loss_minutes_5m = Column(Integer, default=5)  # Timer duration in minutes
    hard_stop_5m = Column(DECIMAL(5, 2), default=5.0)  # Hard stop percentage
    
    # 15-minute interval settings
    stop_loss_15m = Column(DECIMAL(5, 2), default=5.0)  # Soft stop percentage
    stop_loss_minutes_15m = Column(Integer, default=5)  # Timer duration in minutes
    hard_stop_15m = Column(DECIMAL(5, 2), default=5.0)  # Hard stop percentage
    
    # 1-hour interval settings
    stop_loss_1h = Column(DECIMAL(5, 2), default=5.0)  # Soft stop percentage
    stop_loss_minutes_1h = Column(Integer, default=5)  # Timer duration in minutes
    hard_stop_1h = Column(DECIMAL(5, 2), default=5.0)  # Hard stop percentage
    
    # Symbols list (stored as comma-separated string)
    symbols = Column(String, default="AAPL,SPY,TSLA,MSFT,GOOGL,EUR,CAD")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

