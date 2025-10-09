import logging
from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.utils.ib_client import ib_client
from app.models.market_data import CandlestickData, SymbolInfo

logger = logging.getLogger(__name__)

class MarketDataService:
    """Service for fetching and storing market data from IBKR"""
    
    @staticmethod
    async def fetch_and_store_historical_data(
        db: AsyncSession,
        symbol: str,
        duration: str = "1 Y",  # 1 year of data
        bar_size: str = "1 day",
        resolution: str = "D"
    ) -> int:
        """
        Fetch historical data from IBKR and store in database
        
        Args:
            db: Database session
            symbol: Stock symbol (e.g., "AAPL")
            duration: Duration string for IBKR (e.g., "1 Y", "6 M", "1 W")
            bar_size: Bar size for IBKR (e.g., "1 day", "1 hour", "5 mins")
            resolution: Resolution for storage (e.g., "D", "60", "5")
        
        Returns:
            Number of bars stored
        """
        try:
            logger.info(f"Fetching historical data for {symbol} from IBKR...")
            
            # Fetch data from IBKR
            bars = await ib_client.history_bars(
                symbol=symbol,
                duration=duration,
                barSize=bar_size,
                rth=True  # Regular trading hours only
            )
            
            if not bars:
                logger.warning(f"No historical data received for {symbol}")
                return 0
            
            logger.info(f"Received {len(bars)} bars for {symbol}")
            
            # Store bars in database
            stored_count = 0
            for bar in bars:
                try:
                    # Convert bar date to datetime
                    if isinstance(bar.date, str):
                        bar_time = datetime.fromisoformat(bar.date)
                    else:
                        bar_time = bar.date
                    
                    # Check if bar already exists
                    existing_query = select(CandlestickData).where(
                        and_(
                            CandlestickData.symbol == symbol.upper(),
                            CandlestickData.resolution == resolution,
                            CandlestickData.timestamp == bar_time
                        )
                    )
                    result = await db.execute(existing_query)
                    existing_bar = result.scalar_one_or_none()
                    
                    if existing_bar:
                        # Update existing bar
                        existing_bar.open = float(bar.open)
                        existing_bar.high = float(bar.high)
                        existing_bar.low = float(bar.low)
                        existing_bar.close = float(bar.close)
                        existing_bar.volume = float(bar.volume) if bar.volume else 0
                    else:
                        # Create new bar
                        candlestick = CandlestickData(
                            symbol=symbol.upper(),
                            resolution=resolution,
                            timestamp=bar_time,
                            open=float(bar.open),
                            high=float(bar.high),
                            low=float(bar.low),
                            close=float(bar.close),
                            volume=float(bar.volume) if bar.volume else 0
                        )
                        db.add(candlestick)
                    
                    stored_count += 1
                    
                except Exception as e:
                    logger.error(f"Error storing bar for {symbol} at {bar.date}: {e}")
                    continue
            
            # Commit all bars
            await db.commit()
            logger.info(f"Successfully stored {stored_count} bars for {symbol}")
            return stored_count
            
        except Exception as e:
            logger.error(f"Error fetching historical data for {symbol}: {e}")
            await db.rollback()
            raise
    
    @staticmethod
    async def get_historical_bars(
        db: AsyncSession,
        symbol: str,
        from_timestamp: int,
        to_timestamp: int,
        resolution: str = "D"
    ) -> List[CandlestickData]:
        """
        Get historical bars from database
        
        Args:
            db: Database session
            symbol: Stock symbol
            from_timestamp: Start timestamp (Unix seconds)
            to_timestamp: End timestamp (Unix seconds)
            resolution: Resolution (e.g., "D", "60", "5")
        
        Returns:
            List of CandlestickData objects
        """
        try:
            from_datetime = datetime.fromtimestamp(from_timestamp)
            to_datetime = datetime.fromtimestamp(to_timestamp)
            
            query = select(CandlestickData).where(
                and_(
                    CandlestickData.symbol == symbol.upper(),
                    CandlestickData.resolution == resolution,
                    CandlestickData.timestamp >= from_datetime,
                    CandlestickData.timestamp <= to_datetime
                )
            ).order_by(CandlestickData.timestamp.asc())
            
            result = await db.execute(query)
            bars = result.scalars().all()
            
            logger.info(f"Retrieved {len(bars)} bars for {symbol} from database")
            return bars
            
        except Exception as e:
            logger.error(f"Error retrieving historical bars for {symbol}: {e}")
            return []
    
    @staticmethod
    async def ensure_symbol_info(db: AsyncSession, symbol: str) -> Optional[SymbolInfo]:
        """
        Ensure symbol info exists in database, fetch from IBKR if not
        
        Args:
            db: Database session
            symbol: Stock symbol
        
        Returns:
            SymbolInfo object or None
        """
        try:
            # Check if symbol exists
            query = select(SymbolInfo).where(SymbolInfo.symbol == symbol.upper())
            result = await db.execute(query)
            symbol_info = result.scalar_one_or_none()
            
            if symbol_info:
                return symbol_info
            
            # Fetch from IBKR
            logger.info(f"Fetching symbol info for {symbol} from IBKR...")
            contract = await ib_client.qualify_stock(symbol)
            
            if not contract:
                logger.warning(f"Could not qualify contract for {symbol}")
                return None
            
            # Get contract specs
            specs = ib_client.get_specs(symbol)
            
            # Create symbol info
            symbol_info = SymbolInfo(
                symbol=symbol.upper(),
                ticker=symbol.upper(),
                name=f"{symbol.upper()} Stock",
                description=f"{symbol.upper()} Common Stock",
                exchange="SMART",
                currency="USD",
                min_tick=specs.get("min_tick", 0.01) if specs else 0.01,
                min_size=specs.get("min_size", 1) if specs else 1,
                pricescale=100,
                has_intraday=True,
                has_daily=True,
                has_weekly_and_monthly=True,
                data_status="streaming",
                session="0930-1600",
                timezone="America/New_York"
            )
            
            db.add(symbol_info)
            await db.commit()
            await db.refresh(symbol_info)
            
            logger.info(f"Created symbol info for {symbol}")
            return symbol_info
            
        except Exception as e:
            logger.error(f"Error ensuring symbol info for {symbol}: {e}")
            await db.rollback()
            return None

market_data_service = MarketDataService()
