from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any
import logging
import time

from app.db.postgres import AsyncSessionLocal
from app.models.market_data import SymbolInfo, CandlestickData
from app.utils.ib_client import ib_client
from app.utils.ib_interface import ib_interface

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
    is_connected = ib_client.ib.isConnected()
    
    return {
        "connected": is_connected,
        "message": "✅ IBKR connected" if is_connected else "❌ IBKR not connected. Start TWS/Gateway with API enabled.",
        "host": ib_client.ib.client.host if is_connected else None,
        "port": ib_client.ib.client.port if is_connected else None,
        "client_id": ib_client.ib.client.clientId if is_connected else None
    }

@router.get("/positions")
async def get_positions():
    """Get all positions from IB account"""
    try:
        if not ib_client.ib.isConnected():
            raise HTTPException(status_code=503, detail="IBKR not connected")
        
        # Get portfolio data instead of positions for better data including average cost
        portfolio = await ib_client.get_portfolio()
        
        # Debug: Log available attributes on Portfolio object
        if portfolio:
            logger.info(f"Portfolio object attributes: {dir(portfolio[0])}")
            logger.info(f"Portfolio object: {portfolio[0]}")
        
        # Convert IB portfolio to a more usable format
        formatted_positions = []
        for item in portfolio:
            # Portfolio items have different structure than positions
            # Try different possible attribute names for average cost
            avg_price = (
                getattr(item, 'averageCost', None) or 
                getattr(item, 'avgCost', None) or 
                getattr(item, 'cost', None) or 
                getattr(item, 'average_cost', None) or
                0.0
            )
            
            market_price = (
                getattr(item, 'marketPrice', None) or 
                getattr(item, 'market_price', None) or 
                getattr(item, 'price', None) or
                0.0
            )
            
            # Only include items with non-zero position
            position_qty = getattr(item, 'position', 0) or getattr(item, 'qty', 0) or 0
            if position_qty != 0:
                formatted_positions.append({
                    "symbol": item.contract.symbol,
                    "qty": position_qty,
                    "avgPrice": avg_price,
                    "marketPrice": market_price,
                    "marketValue": getattr(item, 'marketValue', 0.0),
                    "unrealizedPnL": getattr(item, 'unrealizedPNL', 0.0),
                    "realizedPnL": getattr(item, 'realizedPNL', 0.0),
                    "contract": {
                        "symbol": item.contract.symbol,
                        "secType": item.contract.secType,
                        "exchange": item.contract.exchange,
                        "currency": item.contract.currency
                    }
                })
        
        return formatted_positions
        
    except Exception as e:
        logger.error(f"Error fetching positions: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching positions: {str(e)}")

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

@router.get("/test-logs")
async def test_logs():
    """Test endpoint to verify logging is working"""
    logger.info("🧪 TEST_LOG: This is a test log message")
    print("🧪 PRINT_TEST: This is a print statement")
    return {"status": "test_logs_working", "timestamp": datetime.now().isoformat()}

@router.get("/history")
async def get_history(
    symbol: str = Query(..., description="Symbol"),
    from_timestamp: int = Query(..., description="From timestamp"),
    to_timestamp: int = Query(..., description="To timestamp"),
    resolution: str = Query(..., description="Resolution"),
    db: AsyncSession = Depends(get_db)
):
    # Add immediate test log to verify logging is working
    logger.info(f"🚀 HISTORY_ENDPOINT_CALLED: {symbol} at {datetime.now().isoformat()}")
    
    logger.info(f"Getting history for {symbol} from {from_timestamp} to {to_timestamp} at {resolution}")
    
    # Convert timestamps to readable format for debugging - ALWAYS show this regardless of IBKR connection
    from_time_readable = datetime.fromtimestamp(from_timestamp).isoformat()
    to_time_readable = datetime.fromtimestamp(to_timestamp).isoformat()
    current_time_readable = datetime.now().isoformat()
    
    logger.info(f"📊 REQUEST_TIMESTAMP_INFO:")
    logger.info(f"📊   Current time: {current_time_readable}")
    logger.info(f"📊   Request from: {from_timestamp} = {from_time_readable}")
    logger.info(f"📊   Request to:   {to_timestamp} = {to_time_readable}")
    logger.info(f"📊   Time range:  {to_timestamp - from_timestamp} seconds = {(to_timestamp - from_timestamp)/60:.1f} minutes")
    
    """Get historical data directly from IBKR"""
    try:
        from app.utils.ib_client import ib_client
        
        # Check IBKR connection status and log it
        ibkr_connected = ib_client.ib.isConnected()
        logger.info(f"🔌 IBKR_CONNECTION_STATUS: {ibkr_connected}")
        
        if not ibkr_connected:
            logger.error("❌ IBKR is not connected. Cannot fetch historical data.")
            logger.info(f"📊 RESPONSE_TIMESTAMP_INFO for {symbol} ({resolution}): IBKR not connected - returning error")
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
        
        # Calculate duration based on how far back we need to go from to_timestamp
        # IBKR returns data going back from endDateTime by the duration
        # So we need duration to cover from_timestamp to to_timestamp
        time_diff = to_timestamp - from_timestamp
        days_diff = time_diff / 86400  # Convert seconds to days
        
        # Calculate how many days back from to_timestamp we need to go
        # Add a small buffer (10%) to ensure we get enough data
        days_back = days_diff * 1.1
        
        # Determine duration based on how far back we need to go
        # IBKR duration options: "1 D", "2 D", "1 W", "1 M", "3 M", "6 M", "1 Y"
        if resolution == '1':
            # 1-minute bars: limited by IBKR
            if days_back <= 1:
                duration = "1 D"
            elif days_back <= 2:
                duration = "2 D"
            else:
                duration = "1 W"  # Max for 1-min bars
        elif resolution in ['3', '5', '15', '30']:
            # Intraday bars: IBKR can provide up to 3 months for 5-min bars
            if days_back <= 2:
                duration = "2 D"
            elif days_back <= 7:
                duration = "1 W"
            elif days_back <= 30:
                duration = "1 M"
            elif days_back <= 90:
                duration = "3 M"
            else:
                duration = "3 M"  # Max for intraday bars
        elif resolution in ['60', '120', '240']:
            # Hourly bars
            if days_back <= 7:
                duration = "1 W"
            elif days_back <= 30:
                duration = "1 M"
            elif days_back <= 90:
                duration = "3 M"
            else:
                duration = "3 M"  # IBKR limit for hourly
        else:
            # Daily/Weekly/Monthly
            if days_back <= 30:
                duration = "1 M"
            elif days_back <= 90:
                duration = "3 M"
            elif days_back <= 180:
                duration = "6 M"
            else:
                duration = "1 Y"
        
        logger.info(f"Fetching history for {symbol} from IBKR: from={from_timestamp}, to={to_timestamp}, days={days_diff:.1f}, duration={duration}, bar_size={bar_size}")
        
        # Determine cache TTL based on resolution and if this is a real-time request
        # For real-time requests (small time windows), use much shorter or no cache
        time_diff = to_timestamp - from_timestamp
        
        # Real-time requests have very small time windows (e.g., 10 minutes for 1-min chart)
        is_realtime_request = time_diff <= 900  # 15 minutes
        
        # Set cache TTL based on resolution and request type
        if is_realtime_request and resolution == '1':
            cache_ttl = 10  # 10 seconds for 1-minute real-time requests
        elif is_realtime_request and resolution in ['3', '5']:
            cache_ttl = 15  # 15 seconds for 3-5 minute real-time requests
        elif is_realtime_request:
            cache_ttl = 20  # 20 seconds for other real-time requests
        else:
            cache_ttl = 300  # 5 minutes for historical data requests
        
        logger.info(f"🕒 Cache TTL for {symbol} ({resolution}-min): {cache_ttl}s (realtime: {is_realtime_request})")
        
        # Check cache first (only if not a very recent real-time request)
        # Include endDateTime in cache key to avoid serving wrong time range
        end_dt_str = datetime.fromtimestamp(to_timestamp).strftime("%Y%m%d_%H%M%S") if to_timestamp else "current"
        cache_key = f"{symbol}_{resolution}_{duration}_{bar_size}_{end_dt_str}"
        current_time = time.time()
        
        # For older data requests (more than 1 day back), don't use cache
        # This ensures we always fetch fresh data for historical requests
        is_historical_request = days_diff > 1
        
        if cache_key in _history_cache and not (is_realtime_request and resolution == '1') and not is_historical_request:
            cached_data, cache_time = _history_cache[cache_key]
            cache_age = current_time - cache_time
            if cache_age < cache_ttl:
                logger.info(f"📦 Using cached data for {symbol} (age: {cache_age:.1f}s, TTL: {cache_ttl}s)")
                bars = cached_data
                logger.info(f"📦 CACHE_HIT: Serving {len(cached_data)} cached bars from {datetime.fromtimestamp(cache_time).isoformat()}")
            else:
                logger.info(f"🔄 Cache expired for {symbol} (age: {cache_age:.1f}s > TTL: {cache_ttl}s), fetching fresh data")
                # Convert to_timestamp to datetime for IBKR endDateTime
                end_dt = datetime.fromtimestamp(to_timestamp) if to_timestamp else None
                logger.info(f"🔄 IBKR_REQUEST: symbol={symbol}, duration={duration}, barSize={bar_size}, rth=True, endDateTime={end_dt}")
                bars = await ib_client.history_bars(
                    symbol=symbol,
                    duration=duration,
                    barSize=bar_size,
                    rth=True,
                    endDateTime=end_dt
                )
                logger.info(f"🔄 IBKR_RESPONSE: Received {len(bars) if bars else 0} bars")
                if bars:
                    _history_cache[cache_key] = (bars, current_time)
        else:
            if is_historical_request:
                logger.info(f"🆕 Historical data fetch for {symbol} (skipping cache, days_diff={days_diff:.1f})")
            else:
                logger.info(f"🆕 {'Real-time' if is_realtime_request else 'Fresh'} data fetch for {symbol}")
            # Convert to_timestamp to datetime for IBKR endDateTime
            end_dt = datetime.fromtimestamp(to_timestamp) if to_timestamp else None
            logger.info(f"🆕 IBKR_REQUEST: symbol={symbol}, duration={duration}, barSize={bar_size}, rth=True, endDateTime={end_dt}, days_back={days_back:.1f}")
            bars = await ib_client.history_bars(
                symbol=symbol,
                duration=duration,
                barSize=bar_size,
                rth=True,
                endDateTime=end_dt
            )
            logger.info(f"🆕 IBKR_RESPONSE: Received {len(bars) if bars else 0} bars")
            # Cache with appropriate TTL (only for recent data)
            if bars and not is_historical_request:
                _history_cache[cache_key] = (bars, current_time)
                logger.info(f"🆕 CACHED: Stored {len(bars)} bars with TTL {cache_ttl}s")
        
        if not bars:
            logger.warning(f"No data received from IBKR for {symbol}")
            return {"s": "no_data"}
        
        # Debug: Log detailed info about raw IBKR data
        if len(bars) > 0:
            logger.info(f"📊 RAW_IBKR_DATA for {symbol}:")
            logger.info(f"📊   Total bars from IBKR: {len(bars)}")
            logger.info(f"📊   First bar: date={bars[0].date}, type={type(bars[0].date)}, close={bars[0].close}")
            logger.info(f"📊   Last bar:  date={bars[-1].date}, type={type(bars[-1].date)}, close={bars[-1].close}")
            
            # Log last few raw bars to see timestamps from IBKR
            if len(bars) >= 3:
                logger.info(f"📊 Last 3 raw bars from IBKR:")
                for i, bar in enumerate(bars[-3:]):
                    bar_index = len(bars) - 3 + i
                    logger.info(f"📊   Raw bar {bar_index}: date={bar.date}, close={bar.close}")
        else:
            logger.warning(f"📊 NO_RAW_BARS: IBKR returned 0 bars for {symbol}")
        
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
            
            # Include all bars returned by IBKR - don't filter here
            # IBKR returns data going back from endDateTime by duration
            # We return all of it, and the frontend will filter to the requested range
            # This ensures we don't lose data that might be slightly outside the range
            result["t"].append(bar_timestamp)
            result["o"].append(float(bar.open))
            result["h"].append(float(bar.high))
            result["l"].append(float(bar.low))
            result["c"].append(float(bar.close))
            result["v"].append(int(bar.volume) if bar.volume else 0)
        
        logger.info(f"Returning {len(result['t'])} bars for {symbol} from IBKR")
        
        # Enhanced logging for ALL requests to debug timestamp issues
        if len(result["t"]) > 0:
            first_timestamp = result["t"][0]
            last_timestamp = result["t"][-1]
            first_time = datetime.fromtimestamp(first_timestamp)
            last_time = datetime.fromtimestamp(last_timestamp)
            current_time = datetime.now()
            
            logger.info(f"📊 RESPONSE_TIMESTAMP_INFO for {symbol} ({resolution}):")
            logger.info(f"📊   Bars returned: {len(result['t'])}")
            logger.info(f"📊   First bar:    {first_timestamp} = {first_time.isoformat()}")
            logger.info(f"📊   Last bar:     {last_timestamp} = {last_time.isoformat()}")
            logger.info(f"📊   Current time: {current_time.isoformat()}")
            logger.info(f"📊   Time lag:     {(current_time.timestamp() - last_timestamp)/60:.1f} minutes behind current")
            
            # Check if we're getting real-time data (last bar should be recent)
            time_lag_minutes = (current_time.timestamp() - last_timestamp) / 60
            
            if resolution == '1':
                if time_lag_minutes > 2:
                    logger.warning(f"⚠️  STALE_DATA: Last 1-minute bar is {time_lag_minutes:.1f} minutes old!")
                else:
                    logger.info(f"✅ FRESH_DATA: Last 1-minute bar is only {time_lag_minutes:.1f} minutes old")
            
            # Log the last few timestamps for all resolutions to see alignment
            if len(result["t"]) >= 3:
                logger.info(f"📊 Last 3 bars:")
                for i, ts in enumerate(result["t"][-3:]):
                    dt = datetime.fromtimestamp(ts)
                    bar_index = len(result["t"]) - 3 + i
                    logger.info(f"📊   Bar {bar_index}: {ts} = {dt.isoformat()} (min:{dt.minute}:{dt.second:02d})")
            
            # For debugging: check if we're getting the same last timestamp as previous calls
            # (This should be handled by a class variable, but for now just log it)
            logger.info(f"📊 REQUEST vs RESPONSE comparison:")
            logger.info(f"📊   Requested from: {from_time_readable}")
            logger.info(f"📊   Requested to:   {to_time_readable}")
            logger.info(f"📊   Got from:       {first_time.isoformat()}")
            logger.info(f"📊   Got to:         {last_time.isoformat()}")
        
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

