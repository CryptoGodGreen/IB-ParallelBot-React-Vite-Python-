from sqlalchemy import Column, Integer, String, Float, DateTime, BigInteger, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from datetime import datetime

Base = declarative_base()

class MarketData(Base):
    """Store raw market data from IB"""
    __tablename__ = "market_data"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    price = Column(Float, nullable=False)
    volume = Column(BigInteger, nullable=False, default=0)
    bid = Column(Float, nullable=True)
    ask = Column(Float, nullable=True)
    bid_size = Column(Integer, nullable=True)
    ask_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=func.now())
    
    # Composite index for efficient queries
    __table_args__ = (
        Index('idx_symbol_timestamp', 'symbol', 'timestamp'),
    )

class CandlestickData(Base):
    """Store aggregated candlestick data"""
    __tablename__ = "candlestick_data"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    resolution = Column(String(10), nullable=False, index=True)  # D, 60, 5, etc. (TradingView format)
    timestamp = Column(DateTime, nullable=False, index=True)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Composite index for efficient queries
    __table_args__ = (
        Index('idx_symbol_resolution_timestamp', 'symbol', 'resolution', 'timestamp'),
    )

class SymbolInfo(Base):
    """Store symbol information for UDF"""
    __tablename__ = "symbol_info"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, unique=True, index=True)
    ticker = Column(String(20), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String(200), nullable=True)
    exchange = Column(String(20), nullable=False, default="SMART")
    currency = Column(String(10), nullable=False, default="USD")
    min_tick = Column(Float, nullable=False, default=0.01)
    min_size = Column(Integer, nullable=False, default=1)
    pricescale = Column(Integer, nullable=False, default=100)
    session = Column(String(20), nullable=False, default="0930-1600")
    timezone = Column(String(50), nullable=False, default="America/New_York")
    has_intraday = Column(String(10), nullable=False, default="true")
    has_daily = Column(String(10), nullable=False, default="true")
    has_weekly_and_monthly = Column(String(10), nullable=False, default="true")
    data_status = Column(String(20), nullable=False, default="streaming")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
