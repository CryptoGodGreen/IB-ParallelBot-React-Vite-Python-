from sqlalchemy import Column, Integer, String, Boolean, DECIMAL, DateTime, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class BotInstance(Base):
    __tablename__ = "bot_instances"
    
    id = Column(Integer, primary_key=True, index=True)
    config_id = Column(Integer, nullable=False)
    symbol = Column(String(10), nullable=False)
    name = Column(String(100))
    is_active = Column(Boolean, default=False)
    is_running = Column(Boolean, default=False)
    is_bought = Column(Boolean, default=False)
    current_price = Column(DECIMAL(10, 2), default=0.00)
    entry_price = Column(DECIMAL(10, 2), default=0.00)
    total_position = Column(Integer, default=0)
    shares_entered = Column(Integer, default=0)
    shares_exited = Column(Integer, default=0)
    open_shares = Column(Integer, default=0)
    position_size = Column(Integer, default=1000)
    max_position = Column(Integer, default=10000)
    
    # Order tracking fields
    entry_order_id = Column(String(50), nullable=True)
    entry_order_status = Column(String(20), default='PENDING')
    stop_loss_order_id = Column(String(50), nullable=True)
    stop_loss_price = Column(DECIMAL(10, 2), nullable=True)
    hard_stop_triggered = Column(Boolean, default=False)
    status = Column(String(20), default='ACTIVE')  # ACTIVE, COMPLETED, STOPPED, ERROR
    multi_buy = Column(String(20), default='disabled')  # Multi-buy mode (default disabled)
    # filled_exit_lines = Column(String(255), nullable=True)  # Comma-separated list of filled exit line IDs
    # TODO: Uncomment after running database migration to add filled_exit_lines column
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    lines = relationship("BotLine", back_populates="bot", cascade="all, delete-orphan")
    events = relationship("BotEvent", back_populates="bot", cascade="all, delete-orphan")

class BotLine(Base):
    __tablename__ = "bot_lines"
    
    id = Column(Integer, primary_key=True, index=True)
    bot_id = Column(Integer, ForeignKey("bot_instances.id"), nullable=False)
    line_type = Column(String(10), nullable=False)  # 'entry' or 'exit'
    price = Column(DECIMAL(10, 2), nullable=False)
    rank = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    bot = relationship("BotInstance", back_populates="lines")

class BotEvent(Base):
    __tablename__ = "bot_events"
    
    id = Column(Integer, primary_key=True, index=True)
    bot_id = Column(Integer, ForeignKey("bot_instances.id"), nullable=False)
    event_type = Column(String(50), nullable=False)
    event_data = Column(JSON)
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    bot = relationship("BotInstance", back_populates="events")
