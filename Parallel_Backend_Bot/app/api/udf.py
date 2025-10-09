from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any
import logging
import time

from app.db.postgres import AsyncSessionLocal
from app.models.market_data import SymbolInfo, CandlestickData

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/udf", tags=["UDF"])

# Supported resolutions
SUPPORTED_RESOLUTIONS = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '480', '720', 'D', '1D', '3D', 'W', '1W', 'M', '1M']

# Simple in-memory cache for historical data
_history_cache = {}
CACHE_TTL = 300  # 5 minutes


@router.get("/ibkr-status")
async def ibkr_connection_status():
    """Check IBKR connection status"""
    from app.utils.ib_client import ib_client
    
    is_connected = ib_client.ib.isConnected()
    
    return {
        "connected": is_connected,
        "message": "✅ IBKR connected" if is_connected else "❌ IBKR not connected. Start TWS/Gateway with API enabled.",
        "host": ib_client.ib.client.host if is_connected else None,
        "port": ib_client.ib.client.port if is_connected else None,
        "client_id": ib_client.ib.client.clientId if is_connected else None
    }

async def get_db() -> AsyncSession:
    """Dependency to get database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

@router.get("/config")
async def get_config():
    """UDF Configuration endpoint"""
    return {
        "exchanges": [
            {
                "value": "SMART",
                "name": "SMART",
                "desc": "SMART Exchange"
            }
        ],
        "symbols_types": [
            {
                "value": "stock",
                "name": "Stock"
            }
        ],
        "supported_resolutions": SUPPORTED_RESOLUTIONS,
        "supports_search": True,
        "supports_group_request": False,
        "supports_marks": False,
        "supports_timescale_marks": False,
        "supports_time": True
    }

@router.get("/symbols")
async def get_symbols(db: AsyncSession = Depends(get_db)):
    """Get all available symbols"""
    try:
        query = select(SymbolInfo)
        result = await db.execute(query)
        symbols = result.scalars().all()
        
        # Convert to UDF format
        symbol_data = {}
        for symbol in symbols:
            for key in ['symbol', 'ticker', 'name', 'description', 'exchange', 'currency', 
                       'min_tick', 'min_size', 'pricescale', 'session', 'timezone', 
                       'has_intraday', 'has_daily', 'has_weekly_and_monthly', 'data_status']:
                if key not in symbol_data:
                    symbol_data[key] = []
                symbol_data[key].append(getattr(symbol, key))
        
        # Convert single values to scalars
        for key in symbol_data:
            if len(set(symbol_data[key])) == 1:
                symbol_data[key] = symbol_data[key][0]
        
        return symbol_data
    except Exception as e:
        logger.error(f"Error getting symbols: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving symbols")

@router.get("/symbol")
async def get_symbol(
    symbol: str = Query(..., description="Symbol to get info for"),
    db: AsyncSession = Depends(get_db)
):
    """Get symbol information"""
    try:
        query = select(SymbolInfo).where(SymbolInfo.symbol == symbol.upper())
        result = await db.execute(query)
        symbol_info = result.scalar_one_or_none()
        
        if not symbol_info:
            # Return default symbol info if not found
            return {
                "name": symbol.upper(),
                "ticker": symbol.upper(),
                "description": f"{symbol.upper()} Stock",
                "type": "stock",
                "session": "0930-1600",
                "timezone": "America/New_York",
                "exchange": "SMART",
                "minmov": 1,
                "pricescale": 100,
                "has_intraday": True,
                "has_seconds": False,
                "has_daily": True,
                "has_weekly_and_monthly": True,
                "supported_resolutions": SUPPORTED_RESOLUTIONS,
                "volume_precision": 0,
                "data_status": "streaming",
                "format": "price",
                "pointvalue": 1,
                "currency_code": "USD",
                "original_name": symbol.upper(),
                "visible_plots_set": "ohlcv",
                "unit_id": "USD"
            }
        
        return {
            "name": symbol_info.symbol,
            "ticker": symbol_info.ticker,
            "description": symbol_info.description,
            "type": "stock",
            "session": symbol_info.session,
            "timezone": symbol_info.timezone,
            "exchange": symbol_info.exchange,
            "minmov": symbol_info.min_size,
            "pricescale": symbol_info.pricescale,
            "has_intraday": symbol_info.has_intraday == "true",
            "has_seconds": False,
            "has_daily": symbol_info.has_daily == "true",
            "has_weekly_and_monthly": symbol_info.has_weekly_and_monthly == "true",
            "supported_resolutions": SUPPORTED_RESOLUTIONS,
            "volume_precision": 0,
            "data_status": symbol_info.data_status,
            "format": "price",
            "pointvalue": 1,
            "currency_code": symbol_info.currency,
            "original_name": symbol_info.symbol,
            "visible_plots_set": "ohlcv",
            "unit_id": symbol_info.currency
        }
    except Exception as e:
        logger.error(f"Error getting symbol {symbol}: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving symbol")

@router.get("/search")
async def search_symbols(
    query: str = Query(..., description="Search query"),
    limit: int = Query(50, description="Maximum number of results"),
    type: Optional[str] = Query(None, description="Symbol type filter"),
    exchange: Optional[str] = Query(None, description="Exchange filter"),
    db: AsyncSession = Depends(get_db)
):
    """Search for symbols"""
    try:
        search_query = select(SymbolInfo)
        
        # Apply filters
        if type:
            search_query = search_query.where(SymbolInfo.exchange == type)
        if exchange:
            search_query = search_query.where(SymbolInfo.exchange == exchange)
        
        # Apply search term
        search_term = query.upper()
        search_query = search_query.where(
            SymbolInfo.symbol.contains(search_term) |
            SymbolInfo.name.contains(search_term) |
            SymbolInfo.description.contains(search_term)
        )
        
        # Limit results
        search_query = search_query.limit(limit)
        
        result = await db.execute(search_query)
        symbols = result.scalars().all()
        
        return [
            {
                "symbol": symbol.symbol,
                "full_name": symbol.name,
                "description": symbol.description,
                "exchange": symbol.exchange,
                "ticker": symbol.ticker,
                "type": "stock"
            }
            for symbol in symbols
        ]
    except Exception as e:
        logger.error(f"Error searching symbols: {e}")
        raise HTTPException(status_code=500, detail="Error searching symbols")

@router.get("/history")
async def get_history(
    symbol: str = Query(..., description="Symbol"),
    from_timestamp: int = Query(..., description="From timestamp"),
    to_timestamp: int = Query(..., description="To timestamp"),
    resolution: str = Query(..., description="Resolution"),
    db: AsyncSession = Depends(get_db)
):
    logger.info(f"Getting history for {symbol} from {from_timestamp} to {to_timestamp} at {resolution}")
    """Get historical data directly from IBKR"""
    try:
        from app.utils.ib_client import ib_client
        
        # Check if IBKR is connected
        if not ib_client.ib.isConnected():
            logger.error("❌ IBKR is not connected. Cannot fetch historical data.")
            return {
                "s": "error",
                "errmsg": "IBKR not connected. Please start TWS/IB Gateway with API enabled (port 7497 for paper trading)."
            }
        
        # Map TradingView resolution to IBKR bar size
        resolution_map = {
            '1': '1 min',
            '3': '3 mins',
            '5': '5 mins',
            '15': '15 mins',
            '30': '30 mins',
            '60': '1 hour',
            '120': '2 hours',
            '240': '4 hours',
            'D': '1 day',
            'W': '1 week',
            'M': '1 month'
        }
        
        bar_size = resolution_map.get(resolution, '1 day')
        
        # Calculate duration based on time range and resolution
        time_diff = to_timestamp - from_timestamp
        days_diff = time_diff / 86400  # Convert seconds to days
        
        # Return ONLY what was requested (with small buffer) to enable pagination
        # This ensures TradingView will request more data when panning
        if resolution == '1':
            # 1-minute bars: return exactly what's requested (max 2 days)
            if days_diff <= 0.5:
                duration = "1 D"
            elif days_diff <= 2:
                duration = "2 D"
            else:
                duration = "1 W"
        elif resolution in ['3', '5', '15', '30']:
            # Intraday bars
            if days_diff <= 2:
                duration = "2 D"
            elif days_diff <= 7:
                duration = "1 W"
            else:
                duration = "1 M"
        elif resolution in ['60', '120', '240']:
            # Hourly bars
            if days_diff <= 7:
                duration = "1 W"
            elif days_diff <= 30:
                duration = "1 M"
            else:
                duration = "3 M"
        else:
            # Daily/Weekly/Monthly
            if days_diff <= 30:
                duration = "1 M"
            elif days_diff <= 90:
                duration = "3 M"
            elif days_diff <= 180:
                duration = "6 M"
            else:
                duration = "1 Y"
        
        logger.info(f"Fetching history for {symbol} from IBKR: from={from_timestamp}, to={to_timestamp}, days={days_diff:.1f}, duration={duration}, bar_size={bar_size}")
        
        # Check cache first
        cache_key = f"{symbol}_{resolution}_{duration}_{bar_size}"
        current_time = time.time()
        
        if cache_key in _history_cache:
            cached_data, cache_time = _history_cache[cache_key]
            if current_time - cache_time < CACHE_TTL:
                logger.info(f"📦 Using cached data for {symbol} (age: {current_time - cache_time:.1f}s)")
                bars = cached_data
            else:
                logger.info(f"🔄 Cache expired for {symbol}, fetching fresh data")
                bars = await ib_client.history_bars(
                    symbol=symbol,
                    duration=duration,
                    barSize=bar_size,
                    rth=True
                )
                _history_cache[cache_key] = (bars, current_time)
        else:
            logger.info(f"🆕 No cache for {symbol}, fetching from IBKR")
            bars = await ib_client.history_bars(
                symbol=symbol,
                duration=duration,
                barSize=bar_size,
                rth=True
            )
            _history_cache[cache_key] = (bars, current_time)
        
        if not bars:
            logger.warning(f"No data received from IBKR for {symbol}")
            return {"s": "no_data"}
        
        # Debug: Log the first bar to see its structure
        if len(bars) > 0:
            logger.info(f"First bar: date={bars[0].date}, type={type(bars[0].date)}, open={bars[0].open}")
        
        # Convert to UDF format
        result = {
            "s": "ok",
            "t": [],
            "o": [],
            "h": [],
            "l": [],
            "c": [],
            "v": []
        }
        
        for bar in bars:
            # Convert bar date to timestamp
            try:
                # Check datetime FIRST because datetime is a subclass of date
                if isinstance(bar.date, datetime):
                    # Already a datetime object
                    bar_time = bar.date
                elif isinstance(bar.date, str):
                    # String date
                    bar_time = datetime.fromisoformat(bar.date)
                elif isinstance(bar.date, date):
                    # It's a date object (not datetime), convert to datetime at midnight
                    bar_time = datetime.combine(bar.date, datetime.min.time())
                else:
                    logger.error(f"Unknown date type: {type(bar.date)} for {bar.date}")
                    continue
                
                bar_timestamp = int(bar_time.timestamp())
            except Exception as e:
                logger.error(f"Error converting bar date {bar.date} (type: {type(bar.date)}): {e}")
                import traceback
                logger.error(traceback.format_exc())
                continue
            
            # Filter bars within requested range
            if from_timestamp <= bar_timestamp <= to_timestamp:
                result["t"].append(bar_timestamp)
                result["o"].append(float(bar.open))
                result["h"].append(float(bar.high))
                result["l"].append(float(bar.low))
                result["c"].append(float(bar.close))
                result["v"].append(int(bar.volume) if bar.volume else 0)
        
        logger.info(f"Returning {len(result['t'])} bars for {symbol} from IBKR")
        
        if len(result["t"]) == 0:
            return {"s": "no_data"}
        
        return result
                
    except Exception as e:
        logger.error(f"Error getting history for {symbol}: {e}")
        return {"s": "error", "errmsg": str(e)}

@router.post("/symbols")
async def add_symbol(
    symbol_data: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    """Add a new symbol to the database"""
    try:
        symbol_info = SymbolInfo(
            symbol=symbol_data['symbol'].upper(),
            ticker=symbol_data.get('ticker', symbol_data['symbol']),
            name=symbol_data.get('name', symbol_data['symbol']),
            description=symbol_data.get('description', ''),
            exchange=symbol_data.get('exchange', 'SMART'),
            currency=symbol_data.get('currency', 'USD'),
            min_tick=symbol_data.get('min_tick', 0.01),
            min_size=symbol_data.get('min_size', 1),
            pricescale=symbol_data.get('pricescale', 100)
        )
        
        db.add(symbol_info)
        await db.commit()
        
        return {"status": "success", "message": f"Symbol {symbol_data['symbol']} added successfully"}
    except Exception as e:
        logger.error(f"Error adding symbol: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail="Error adding symbol")

