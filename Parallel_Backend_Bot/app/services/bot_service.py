import asyncio
import logging
import time
from typing import Dict, List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, insert
from sqlalchemy.orm import selectinload

from app.db.postgres import AsyncSessionLocal
from app.models.bot_models import BotInstance, BotLine, BotEvent
from app.utils.ib_client import ib_client
from ib_async import MarketOrder
from app.utils.ib_interface import ib_interface
from app.services.market_data_service import MarketDataService

logger = logging.getLogger(__name__)

class BotService:
    """
    Backend service to manage trading bots with database persistence
    """
    
    def __init__(self):
        self.active_bots: Dict[int, Dict] = {}  # In-memory bot state
        self.market_data_service = MarketDataService()
        self._running = False
        self._price_request_locks: Dict[str, asyncio.Lock] = {}  # Prevent concurrent requests for same symbol
        
    async def start(self):
        """Start the bot service"""
        self._running = True
        logger.info("🤖 Bot Service started")
        
        # Load existing active bots from database
        await self.load_active_bots()
        
        # Start background tasks
        asyncio.create_task(self._price_monitoring_loop())
        asyncio.create_task(self._bot_status_update_loop())
        
    async def stop(self):
        """Stop the bot service"""
        self._running = False
        logger.info("🤖 Bot Service stopped")
        
    async def create_bot(self, config_data: dict) -> BotInstance:
        """Create a new bot instance"""
        async with AsyncSessionLocal() as session:
            try:
                # Get the trade_amount from the configuration
                from app.db.models import UserChart
                config_result = await session.execute(
                    select(UserChart).where(UserChart.id == config_data['config_id'])
                )
                config = config_result.scalar_one_or_none()
                trade_amount = config.trade_amount if config else 1000
                
                # Create bot instance
                bot = BotInstance(
                    config_id=config_data['config_id'],
                    symbol=config_data['symbol'],
                    name=config_data['name'],
                    position_size=trade_amount,  # Use trade_amount from configuration
                    max_position=config_data.get('max_position', 10000),
                    is_active=True,  # Auto-start the bot
                    is_running=True  # Auto-start the bot
                )
                
                session.add(bot)
                await session.commit()
                await session.refresh(bot)
                
                logger.info(f"🤖 Created bot instance {bot.id} for {bot.symbol}")
                
                # Load bot state into memory since it's auto-started
                await self._load_bot_state(bot.id)
                
                return bot
                
            except Exception as e:
                await session.rollback()
                logger.error(f"Error creating bot: {e}")
                raise
                
    async def start_bot(self, bot_id: int) -> bool:
        """Start a bot instance"""
        async with AsyncSessionLocal() as session:
            try:
                # Update database
                await session.execute(
                    update(BotInstance)
                    .where(BotInstance.id == bot_id)
                    .values(is_active=True, is_running=True, updated_at=datetime.now())
                )
                await session.commit()
                
                # Load bot state into memory
                await self._load_bot_state(bot_id)
                
                logger.info(f"🤖 Started bot {bot_id}")
                return True
                
            except Exception as e:
                logger.error(f"Error starting bot {bot_id}: {e}")
                return False
                
    async def stop_bot(self, bot_id: int) -> bool:
        """Stop a bot instance"""
        async with AsyncSessionLocal() as session:
            try:
                # Update database
                await session.execute(
                    update(BotInstance)
                    .where(BotInstance.id == bot_id)
                    .values(is_active=False, is_running=False, updated_at=datetime.now())
                )
                await session.commit()
                
                # Remove from memory
                if bot_id in self.active_bots:
                    del self.active_bots[bot_id]
                
                logger.info(f"🤖 Stopped bot {bot_id}")
                return True
                
            except Exception as e:
                logger.error(f"Error stopping bot {bot_id}: {e}")
                return False
                
    async def update_bot_price(self, bot_id: int, price: float):
        """Update bot with new market price"""
        if bot_id not in self.active_bots:
            return
            
        bot_state = self.active_bots[bot_id]
        bot_state['current_price'] = price
        
        # Check for price crossings
        await self._check_price_crossings(bot_id, price)
        
        # Check for soft stop and hard stop conditions
        await self._check_soft_stop_out(bot_id, price)
        await self._check_hard_stop_out(bot_id, price)
        
        # Update database
        await self._update_bot_in_db(bot_id, {'current_price': price})
        
    async def _load_bot_state(self, bot_id: int):
        """Load bot state from database into memory"""
        async with AsyncSessionLocal() as session:
            try:
                # Get bot instance with lines
                result = await session.execute(
                    select(BotInstance)
                    .options(selectinload(BotInstance.lines))
                    .where(BotInstance.id == bot_id)
                )
                bot = result.scalar_one_or_none()
                
                if not bot:
                    return
                
                # Get trend strategy and real line data from UserChart
                from app.db.models import UserChart
                from app.models.bot_config import BotConfiguration
                
                config_result = await session.execute(
                    select(UserChart).where(UserChart.id == bot.config_id)
                )
                config = config_result.scalar_one_or_none()
                trend_strategy = config.trend_strategy if config else "uptrend"
                multi_buy = config.multi_buy if config else "disabled"
                trade_amount = float(config.trade_amount) if config and config.trade_amount else 1000.0
                interval = config.interval if config else "1M"  # Get interval from chart config
                
                # Get bot configuration settings (global settings)
                bot_config_result = await session.execute(
                    select(BotConfiguration).order_by(BotConfiguration.id.desc()).limit(1)
                )
                bot_config = bot_config_result.scalar_one_or_none()
                
                # Determine which interval settings to use (5m, 15m, or 1h)
                soft_stop_pct = 5.0
                soft_stop_minutes = 5
                hard_stop_pct = 5.0
                
                if bot_config:
                    # Normalize interval to determine which settings to use
                    interval_upper = interval.upper()
                    if '5M' in interval_upper or interval_upper == '5':
                        soft_stop_pct = float(bot_config.stop_loss_5m) if bot_config.stop_loss_5m else 5.0
                        soft_stop_minutes = bot_config.stop_loss_minutes_5m or 5
                        hard_stop_pct = float(bot_config.hard_stop_5m) if bot_config.hard_stop_5m else 5.0
                    elif '15M' in interval_upper or interval_upper == '15':
                        soft_stop_pct = float(bot_config.stop_loss_15m) if bot_config.stop_loss_15m else 5.0
                        soft_stop_minutes = bot_config.stop_loss_minutes_15m or 5
                        hard_stop_pct = float(bot_config.hard_stop_15m) if bot_config.hard_stop_15m else 5.0
                    elif '1H' in interval_upper or interval_upper == '60' or interval_upper == '1H':
                        soft_stop_pct = float(bot_config.stop_loss_1h) if bot_config.stop_loss_1h else 5.0
                        soft_stop_minutes = bot_config.stop_loss_minutes_1h or 5
                        hard_stop_pct = float(bot_config.hard_stop_1h) if bot_config.hard_stop_1h else 5.0
                
                logger.info(f"🎯 Bot {bot_id}: trend_strategy={trend_strategy}, multi_buy={multi_buy}, interval={interval}")
                logger.info(f"🎯 Bot {bot_id}: Soft stop: {soft_stop_pct}%, Timer: {soft_stop_minutes}min, Hard stop: {hard_stop_pct}%")
                
                # Extract real line data from layout_data
                real_entry_lines = []
                real_exit_lines = []
                upward_lines = []  # For UPTREND: collect all upward lines first
                downward_lines = []  # For DOWNTREND: collect all downward lines first
                if config and config.layout_data:
                    layout = config.layout_data
                    
                    # Extract entry lines from TradingView drawings
                    if 'other_drawings' in layout and 'tradingview_drawings' in layout['other_drawings']:
                        drawings = layout['other_drawings']['tradingview_drawings']
                        line_counter = 1  # Global counter for unique line IDs
                        
                        for drawing in drawings:
                            if drawing['name'] == 'trend_line' and len(drawing['points']) >= 2:
                                # Calculate current price based on trend line slope and intercept
                                current_price = self._calculate_trend_line_price(drawing['points'])
                                
                                # Determine if it's entry or exit based on trend strategy
                                prices = [point['price'] for point in drawing['points']]
                                if len(prices) >= 2:
                                    price_diff = prices[-1] - prices[0]  # End - Start
                                    
                                    if trend_strategy == 'uptrend':
                                        # UPTREND SPOT TRADING: Only use upward lines
                                        # Bottom upward line = Entry, Higher upward lines = Exits
                                        if price_diff > 0:  # Upward trend line
                                            # Store all upward lines first, then sort and assign
                                            upward_lines.append({
                                                'price': current_price,
                                                'is_active': True,
                                                'id': f"line_{line_counter}",  # Use unique string ID
                                                'points': drawing['points']  # Store points for recalculation
                                            })
                                            line_counter += 1
                                    else:  # downtrend
                                        # DOWNTREND OPTIONS: Top (highest) downward line = Entry, Remaining downward lines = Exit
                                        if price_diff < 0:  # Downward trend line
                                            # Store all downward lines first, then sort and assign
                                            downward_lines.append({
                                                'price': current_price,
                                                'is_active': True,
                                                'id': f"line_{line_counter}",  # Use unique string ID
                                                'points': drawing['points']  # Store points for recalculation
                                            })
                                            line_counter += 1
                                        else:  # Upward trend = Exit line
                                            real_exit_lines.append({
                                                'price': current_price,
                                                'is_active': True,
                                                'id': f"line_{line_counter}",  # Use unique string ID
                                                'points': drawing['points']  # Store points for recalculation
                                            })
                                            line_counter += 1
                    
                    # For DOWNTREND: Sort downward lines and assign top (highest) as entry, rest as exit
                    if trend_strategy == 'downtrend' and downward_lines:
                        # Sort downward lines by price (highest to lowest)
                        downward_lines.sort(key=lambda x: x['price'], reverse=True)
                        logger.info(f"🎯 Bot {bot_id}: Sorted {len(downward_lines)} downward lines for options trading")
                        
                        # Top (highest) downward line = Entry (option bid)
                        if len(downward_lines) > 0:
                            real_entry_lines.append(downward_lines[0])  # Highest downward line = Entry
                            logger.info(f"🎯 Bot {bot_id}: Added entry line (option bid) at ${downward_lines[0]['price']:.2f}")
                        
                        # Remaining downward lines = Exit (option ask)
                        for i in range(1, len(downward_lines)):
                            real_exit_lines.append(downward_lines[i])
                            logger.info(f"🎯 Bot {bot_id}: Added exit line (option ask) at ${downward_lines[i]['price']:.2f}")
                    
                    # For UPTREND: Sort upward lines and assign based on multi-buy setting
                    if trend_strategy == 'uptrend' and upward_lines:
                        # Sort upward lines by price (lowest to highest)
                        upward_lines.sort(key=lambda x: x['price'])
                        logger.info(f"🎯 Bot {bot_id}: Sorted {len(upward_lines)} upward lines, multi_buy={multi_buy}")
                        
                        if multi_buy == 'enabled':
                            # Multi-buy mode: Bottom 2 lines = Entry, Higher lines = Exit
                            logger.info(f"🎯 Bot {bot_id}: Multi-buy ENABLED - assigning bottom 2 lines as entry")
                            if len(upward_lines) >= 2:
                                real_entry_lines.append(upward_lines[0])  # 1st buy line
                                real_entry_lines.append(upward_lines[1])  # 2nd buy line
                                logger.info(f"🎯 Bot {bot_id}: Added entry lines at ${upward_lines[0]['price']:.2f} and ${upward_lines[1]['price']:.2f}")
                                
                            # All higher lines = Exit lines
                            for i in range(2, len(upward_lines)):
                                real_exit_lines.append(upward_lines[i])
                                logger.info(f"🎯 Bot {bot_id}: Added exit line at ${upward_lines[i]['price']:.2f}")
                        else:
                            # Single buy mode: Bottom line = Entry, Higher lines = Exit
                            logger.info(f"🎯 Bot {bot_id}: Multi-buy DISABLED - assigning bottom 1 line as entry")
                            if upward_lines:
                                real_entry_lines.append(upward_lines[0])
                                logger.info(f"🎯 Bot {bot_id}: Added entry line at ${upward_lines[0]['price']:.2f}")
                            
                            # All higher lines = Exit lines
                            for i in range(1, len(upward_lines)):
                                real_exit_lines.append(upward_lines[i])
                                logger.info(f"🎯 Bot {bot_id}: Added exit line at ${upward_lines[i]['price']:.2f}")
                    
                    logger.info(f"🎯 Extracted {len(real_entry_lines)} entry lines and {len(real_exit_lines)} exit lines from layout_data")
                
                # Load into memory
                self.active_bots[bot_id] = {
                    'id': bot.id,
                    'config_id': bot.config_id,
                    'symbol': bot.symbol,
                    'name': bot.name,
                    'trend_strategy': trend_strategy,  # Add trend strategy
                    'multi_buy': multi_buy,  # Multi-buy mode
                    'trade_amount': trade_amount,  # Trade amount in dollars
                    'is_active': bot.is_active,
                    'is_running': bot.is_running,
                    'is_bought': bot.is_bought,
                    'current_price': bot.current_price,
                    'previous_price': bot.current_price,  # Initialize with current price
                    'entry_price': bot.entry_price,
                    'total_position': bot.total_position,
                    'shares_entered': bot.shares_entered,
                    'shares_exited': bot.shares_exited,
                    'open_shares': bot.open_shares,
                    'position_size': bot.position_size,  # Keep for backward compatibility, but use trade_amount for calculations
                    'max_position': bot.max_position,
                    'entry_lines': real_entry_lines,
                    'exit_lines': real_exit_lines,
                    'original_exit_lines_count': len(real_exit_lines),  # Store original count for position splitting
                    'crossed_lines': set(),  # Track crossed lines
                    'interval': interval,  # Store interval for reference
                    'soft_stop_pct': soft_stop_pct,  # Soft stop percentage
                    'soft_stop_minutes': soft_stop_minutes,  # Soft stop timer duration in minutes
                    'hard_stop_pct': hard_stop_pct,  # Hard stop percentage (from global config)
                    'bot_hard_stop_out': hard_stop_pct,  # Use global hard stop instead of individual bot config
                    'hard_stop_triggered': False,  # Track if hard stop-out was triggered
                    'soft_stop_timer_start': None,  # Timestamp when soft stop timer started (None if not active)
                    'soft_stop_timer_active': False,  # Whether soft stop timer is currently running
                    # Order tracking fields
                    'entry_order_id': bot.entry_order_id,
                    'entry_order_status': bot.entry_order_status,
                    'entry_order_price': bot.entry_price,  # Use entry_price as order price
                    'entry_order_quantity': bot.shares_entered,
                    'entry_order_last_update': None,
                    'stop_loss_order_id': bot.stop_loss_order_id,
                    'stop_loss_price': bot.stop_loss_price,
                    # Options-specific fields
                    'option_contract': None,
                    'option_strike': None,
                    'option_expiry': None,
                    'option_right': None,
                    # Track filled exit lines (loaded from database or initialized as empty set)
                    'filled_exit_lines': self._load_filled_exit_lines(bot)
                }
                
                # If bot is already bought but has no exit orders, create them
                if bot.is_bought and not any(key.startswith('exit_order_') for key in self.active_bots[bot_id].keys()):
                    logger.info(f"🤖 Bot {bot_id}: Already bought but no exit orders found, creating them...")
                    await self._create_exit_orders_on_position_open(bot_id, float(bot.current_price) if bot.current_price else 0.0)
                
                # Check if all shares are sold and bot should be completed
                if bot.is_bought and bot.open_shares <= 0 and bot.shares_exited > 0:
                    logger.info(f"🎉 Bot {bot_id}: All shares sold! Marking as completed...")
                    await self._complete_bot(bot_id)
                
                logger.info(f"🤖 Loaded bot state for {bot_id}")
                
            except Exception as e:
                logger.error(f"Error loading bot state {bot_id}: {e}")
                
    async def _complete_bot(self, bot_id: int):
        """Mark bot as completed when all shares are sold"""
        try:
            # Get current bot state to include final shares_exited value
            bot_state = self.active_bots.get(bot_id, {})
            
            # Update database
            await self._update_bot_in_db(bot_id, {
                'is_active': False,
                'is_running': False,
                'is_bought': False,
                'open_shares': 0,  # Ensure open shares is 0 when completed
                'shares_exited': bot_state.get('shares_exited', 0),  # Include final exit tracking
                'status': 'COMPLETED'
            })
            
            # Remove from active bots
            if bot_id in self.active_bots:
                del self.active_bots[bot_id]
            
            # Log completion event
            await self._log_bot_event(bot_id, 'bot_completed', {
                'reason': 'all_shares_sold',
                'strategy': 'uptrend_spot_limit'
            })
            
            logger.info(f"🎉 Bot {bot_id}: COMPLETED! All shares sold successfully.")
            
        except Exception as e:
            logger.error(f"Error completing bot {bot_id}: {e}")
    
    async def cancel_all_pending_orders(self, bot_id: int) -> dict:
        """Cancel all pending orders for a bot"""
        try:
            if bot_id not in self.active_bots:
                return {"success": False, "message": f"Bot {bot_id} not found or not active"}
            
            bot_state = self.active_bots[bot_id]
            cancelled_orders = []
            errors = []
            
            # Cancel entry order if pending
            if (bot_state.get('entry_order_id') and 
                bot_state.get('entry_order_status') == 'PENDING'):
                try:
                    from app.utils.ib_client import ib_client
                    success = await ib_client.cancel_order(bot_state['entry_order_id'])
                    if success:
                        bot_state['entry_order_status'] = 'CANCELLED'
                        cancelled_orders.append(f"Entry order {bot_state['entry_order_id']}")
                        logger.info(f"✅ Bot {bot_id}: Cancelled entry order {bot_state['entry_order_id']}")
                    else:
                        errors.append(f"Failed to cancel entry order {bot_state['entry_order_id']}")
                except Exception as e:
                    errors.append(f"Error cancelling entry order: {e}")
            
            # Cancel exit orders
            for key, value in bot_state.items():
                if (key.startswith('exit_order_') and 
                    isinstance(value, dict) and 
                    value.get('status') == 'PENDING'):
                    try:
                        from app.utils.ib_client import ib_client
                        success = await ib_client.cancel_order(value['order_id'])
                        if success:
                            value['status'] = 'CANCELLED'
                            cancelled_orders.append(f"Exit order {value['order_id']} ({value.get('line_id', 'unknown')})")
                            logger.info(f"✅ Bot {bot_id}: Cancelled exit order {value['order_id']}")
                        else:
                            errors.append(f"Failed to cancel exit order {value['order_id']}")
                    except Exception as e:
                        errors.append(f"Error cancelling exit order {value['order_id']}: {e}")
            
            # Cancel stop loss order if pending
            if bot_state.get('stop_loss_order_id'):
                try:
                    from app.utils.ib_client import ib_client
                    success = await ib_client.cancel_order(bot_state['stop_loss_order_id'])
                    if success:
                        cancelled_orders.append(f"Stop loss order {bot_state['stop_loss_order_id']}")
                        logger.info(f"✅ Bot {bot_id}: Cancelled stop loss order {bot_state['stop_loss_order_id']}")
                except Exception as e:
                    errors.append(f"Error cancelling stop loss order: {e}")
            
            # Update database
            await self._update_bot_in_db(bot_id, {
                'entry_order_status': bot_state.get('entry_order_status', 'CANCELLED')
            })
            
            # Log event
            await self._log_bot_event(bot_id, 'orders_cancelled', {
                'cancelled_orders': cancelled_orders,
                'errors': errors,
                'strategy': 'manual_cancellation'
            })
            
            result = {
                "success": True,
                "cancelled_orders": cancelled_orders,
                "errors": errors,
                "message": f"Cancelled {len(cancelled_orders)} orders"
            }
            
            if errors:
                result["message"] += f", {len(errors)} errors"
            
            logger.info(f"🛑 Bot {bot_id}: Manual order cancellation completed - {result['message']}")
            return result
            
        except Exception as e:
            logger.error(f"Error cancelling orders for bot {bot_id}: {e}")
            return {"success": False, "message": f"Error cancelling orders: {e}"}
    
    async def _check_price_crossings(self, bot_id: int, current_price: float):
        """Check for price crossings and execute trades"""
        bot_state = self.active_bots[bot_id]
        
        # Get previous price for directional crossing detection
        previous_price = bot_state.get('previous_price', current_price)
        
        # Check entry lines (upward crossing or current price above entry)
        # In multi-buy mode, continue checking until all entry lines are crossed
        if not bot_state['is_bought'] or bot_state.get('multi_buy') == 'enabled':
            # Count how many entry lines have been crossed
            crossed_entry_count = sum(1 for entry_line in bot_state['entry_lines'] 
                                     if entry_line['id'] in bot_state['crossed_lines'])
            
            for line in bot_state['entry_lines']:
                # Skip if already crossed (unless it's the last entry line to complete position)
                if line['id'] in bot_state['crossed_lines']:
                    continue
                
                # Check for upward crossing: previous_price < line_price <= current_price
                if previous_price < line['price'] <= current_price:
                    
                    logger.info(f"🤖 Bot {bot_id}: ENTRY CROSSING DETECTED! "
                              f"Line: ${line['price']}, Current: ${current_price}")
                    
                    await self._execute_entry_trade(bot_id, line, current_price)
                    bot_state['crossed_lines'].add(line['id'])
                
                # Fallback: If current price is above entry line and no crossing detected yet
                elif current_price > line['price']:
                    
                    logger.info(f"🤖 Bot {bot_id}: ENTRY PRICE ABOVE LINE! "
                              f"Line: ${line['price']}, Current: ${current_price}")
                    
                    await self._execute_entry_trade(bot_id, line, current_price)
                    bot_state['crossed_lines'].add(line['id'])
        
        # Check exit lines (downward crossing)
        if bot_state['is_bought'] and bot_state['open_shares'] > 0:
            for line in bot_state['exit_lines']:
                # Check for downward crossing: previous_price > line_price >= current_price
                if (previous_price > line['price'] >= current_price and 
                    line['id'] not in bot_state['crossed_lines']):
                    
                    logger.info(f"🤖 Bot {bot_id}: EXIT CROSSING DETECTED! "
                              f"Line: ${line['price']}, Current: ${current_price}")
                    
                    await self._execute_exit_trade(bot_id, line, current_price)
                    bot_state['crossed_lines'].add(line['id'])
        
        # Update previous price for next comparison
        bot_state['previous_price'] = current_price
        
        # Monitor order status and update limit prices every 30 seconds
        await self._monitor_orders(bot_id, current_price)
        
    async def _monitor_orders(self, bot_id: int, current_price: float):
        """Monitor order status and update limit prices every 30 seconds"""
        try:
            bot_state = self.active_bots[bot_id]
            current_time = time.time()
            
            # Check if we need to update prices (every 30 seconds)
            should_update_prices = False
            if 'last_price_update' not in bot_state:
                bot_state['last_price_update'] = current_time
                should_update_prices = True
                logger.info(f"🔄 Bot {bot_id}: First price update check")
            elif current_time - bot_state['last_price_update'] >= 30:
                should_update_prices = True
                bot_state['last_price_update'] = current_time
                logger.info(f"🔄 Bot {bot_id}: 30-second price update triggered")
            
            logger.debug(f"🔄 Bot {bot_id}: should_update_prices={should_update_prices}, time_since_last_update={current_time - bot_state.get('last_price_update', current_time):.1f}s")
            
            # Monitor entry order (only for limit orders, market orders execute immediately)
            if ('entry_order_id' in bot_state and 
                bot_state.get('entry_order_status') == 'PENDING' and 
                bot_state.get('is_bought') == False):
                await self._check_entry_order_status(bot_id, current_price, should_update_prices)
            
            # Monitor exit orders
            exit_orders_found = 0
            active_exit_statuses = {
                'PENDING', 'SUBMITTED', 'PRESUBMITTED', 'PENDINGSUBMIT',
                'PENDING_SUBMIT', 'WORKING', 'UNKNOWN', 'API_PENDING'
            }
            logger.info(f"🔄 Bot {bot_id}: Checking bot state for exit orders...")
            logger.info(f"🔄 Bot {bot_id}: Bot state keys: {list(bot_state.keys())}")
            
            for key, value in bot_state.items():
                if key.startswith('exit_order_'):
                    logger.info(f"🔄 Bot {bot_id}: Found exit order key: {key}, value: {value}")
                    if isinstance(value, dict):
                        status = (value.get('status') or 'PENDING').upper()
                        value['status'] = status
                        if status in active_exit_statuses:
                            exit_orders_found += 1
                            logger.info(f"🔄 Bot {bot_id}: Monitoring exit order {key}, status={status}")
                            await self._check_exit_order_status(bot_id, key, value, current_price, should_update_prices)
                        else:
                            logger.info(f"🔄 Bot {bot_id}: Exit order {key} not active (status={status}): {value}")
                    else:
                        logger.info(f"🔄 Bot {bot_id}: Exit order {key} not tracked (non-dict): {value}")
            
            logger.info(f"🔄 Bot {bot_id}: Found {exit_orders_found} pending exit orders")
            
            # Ensure exit orders exist every cycle if bot has a position
            if bot_state.get('is_bought') == True:
                # Load filled exit lines
                filled_exit_lines = bot_state.get('filled_exit_lines', set())
                if isinstance(filled_exit_lines, str):
                    filled_exit_lines = set(filled_exit_lines.split(',')) if filled_exit_lines else set()
                elif not isinstance(filled_exit_lines, set):
                    filled_exit_lines = set()
                
                # Check if we have exit lines but no active exit orders
                exit_lines = bot_state.get('exit_lines', [])
                # Filter out filled exit lines
                unfilled_exit_lines = [line for line in exit_lines if line.get('id') not in filled_exit_lines]
                
                if unfilled_exit_lines and exit_orders_found == 0:
                    logger.info(f"🔄 Bot {bot_id}: Position is open but no active exit orders found - resubmitting exit orders (excluding {len(filled_exit_lines)} filled lines)")
                    await self._create_exit_orders_on_position_open(bot_id, current_price, force_resubmit=False)
                elif unfilled_exit_lines:
                    # Check if all unfilled exit lines have orders, if not, resubmit missing ones
                    active_exit_statuses_check = {
                        'PENDING', 'SUBMITTED', 'PRESUBMITTED', 'PENDINGSUBMIT',
                        'PENDING_SUBMIT', 'WORKING', 'UNKNOWN', 'API_PENDING'
                    }
                    exit_lines_with_orders = 0
                    for exit_line in unfilled_exit_lines:
                        exit_order_key = f"exit_order_{exit_line['id']}"
                        existing_order = bot_state.get(exit_order_key)
                        if existing_order and isinstance(existing_order, dict):
                            status = (existing_order.get('status') or 'PENDING').upper()
                            if status in active_exit_statuses_check:
                                exit_lines_with_orders += 1
                    
                    if exit_lines_with_orders < len(unfilled_exit_lines):
                        logger.info(f"🔄 Bot {bot_id}: Only {exit_lines_with_orders} out of {len(unfilled_exit_lines)} unfilled exit lines have active orders (filled: {len(filled_exit_lines)}) - resubmitting missing exit orders")
                        await self._create_exit_orders_on_position_open(bot_id, current_price, force_resubmit=False)
                    
        except Exception as e:
            logger.error(f"Error monitoring orders for bot {bot_id}: {e}")
    
    async def _check_entry_order_status(self, bot_id: int, current_price: float, should_update_prices: bool):
        """Check and update entry order status"""
        try:
            bot_state = self.active_bots[bot_id]
            order_id = bot_state['entry_order_id']
            
            # Get order status from IBKR
            from app.utils.ib_client import ib_client
            
            # Check if order is filled
            order_status = await ib_client.get_order_status(order_id)
            
            if order_status == 'Filled':
                logger.info(f"✅ Bot {bot_id}: Entry order {order_id} FILLED!")
                
                # Update bot state to BOUGHT
                bot_state['is_bought'] = True
                bot_state['entry_price'] = bot_state['entry_order_price']
                bot_state['shares_entered'] = bot_state['entry_order_quantity']
                bot_state['open_shares'] = bot_state['entry_order_quantity']
                bot_state['entry_order_status'] = 'FILLED'
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'is_bought': True,
                    'entry_price': bot_state['entry_price'],
                    'shares_entered': bot_state['shares_entered'],
                    'open_shares': bot_state['open_shares'],
                    'entry_order_status': 'FILLED'
                })
                
                # Log entry order event (for limit orders that were just filled)
                await self._log_bot_event(bot_id, 'spot_entry_limit_order', {
                    'line_price': bot_state.get('entry_order_price', bot_state['entry_price']),
                    'current_price': current_price,
                    'shares_bought': bot_state['shares_entered'],
                    'order_id': order_id,
                    'order_status': 'FILLED',
                    'strategy': 'uptrend_spot_limit'
                })
                
                # Log position opened event
                await self._log_bot_event(bot_id, 'spot_position_opened', {
                    'entry_price': bot_state['entry_price'],
                    'shares_bought': bot_state['shares_entered'],
                    'order_id': order_id,
                    'strategy': 'uptrend_spot_limit'
                })
                
                logger.info(f"🤖 Bot {bot_id}: Position opened - {bot_state['shares_entered']} shares at ${bot_state['entry_price']}")
                
                # Create exit limit orders for all exit lines immediately
                await self._create_exit_orders_on_position_open(bot_id, current_price)
                
            elif should_update_prices and order_status == 'Submitted':
                # Update limit price to current market price
                await self._update_entry_order_price(bot_id, current_price)
                
        except Exception as e:
            logger.error(f"Error checking entry order status for bot {bot_id}: {e}")
    
    async def _check_exit_order_status(self, bot_id: int, order_key: str, order_info: dict, current_price: float, should_update_prices: bool):
        """Check and update exit order status"""
        try:
            bot_state = self.active_bots[bot_id]
            order_id = order_info['order_id']
            
            logger.info(f"🔄 Bot {bot_id}: Checking exit order {order_key}, should_update_prices={should_update_prices}")
            logger.info(f"🔄 Bot {bot_id}: Order info: {order_info}")
            
            # Get order status from IBKR
            from app.utils.ib_client import ib_client
            
            logger.info(f"🔄 Bot {bot_id}: Getting order status for order {order_id}")
            order_status = await ib_client.get_order_status(order_id)
            # Normalize order status to uppercase for consistent comparison
            order_status_normalized = (order_status or 'UNKNOWN').strip().upper()
            logger.info(f"🔄 Bot {bot_id}: Order {order_id} status: {order_status} (normalized: {order_status_normalized})")
            
            # Recalculate exit line price from trend line for accurate comparison
            line_id = order_info.get('line_id', '')
            exit_line_price = order_info.get('price', 0)  # Fallback to stored price
            exit_line = None
            
            # Find the exit line for this order
            for exit_line_candidate in bot_state.get('exit_lines', []):
                if exit_line_candidate.get('id') == line_id:
                    exit_line = exit_line_candidate
                    break
            
            if exit_line and exit_line.get('points'):
                # Recalculate exit line price from trend line points
                exit_line_price_calculated = self._calculate_trend_line_price(exit_line['points'])
                
                # Get contract specs to round price to minimum tick
                specs = ib_client.get_specs(bot_state['symbol'])
                min_tick = specs.get('min_tick', 0.01) if specs else 0.01
                
                # Round price to minimum tick
                def round_to_tick(price: float, tick: float) -> float:
                    return round(round(price / tick) * tick, 6)
                
                exit_line_price = round_to_tick(exit_line_price_calculated, min_tick)
            
            logger.info(f"🎯 Bot {bot_id}: Manual fill check - Current: ${current_price:.2f}, Exit line: ${exit_line_price:.2f}, Order status: {order_status_normalized}")
            
            # Check if current price is above exit line (manual fill detection)
            if current_price >= exit_line_price and order_status_normalized in ['UNKNOWN', 'SUBMITTED', 'PENDING', 'PRESUBMITTED', 'WORKING']:
                logger.info(f"🎯 Bot {bot_id}: Current price ${current_price:.2f} >= Exit line ${exit_line_price:.2f}, marking as filled (status was: {order_status_normalized})")
                order_status_normalized = 'FILLED'
            
            if order_status_normalized == 'FILLED':
                logger.info(f"✅ Bot {bot_id}: Exit order {order_id} FILLED!")
                
                # Update bot state
                shares_sold = order_info['quantity']
                exit_line_price = order_info.get('price', 0)
                line_id = order_info.get('line_id', '')
                bot_state['shares_exited'] += shares_sold
                bot_state['open_shares'] -= shares_sold
                order_info['status'] = 'FILLED'
                
                # Mark this exit line as filled (so we don't create orders for it again)
                if 'filled_exit_lines' not in bot_state:
                    bot_state['filled_exit_lines'] = set()
                bot_state['filled_exit_lines'].add(line_id)
                logger.info(f"✅ Bot {bot_id}: Marked exit line {line_id} as FILLED. Filled exit lines: {bot_state['filled_exit_lines']}")
                
                # Update database
                logger.info(f"🔄 Bot {bot_id}: Updating database - shares_exited={bot_state['shares_exited']}, open_shares={bot_state['open_shares']}")
                db_update = {
                    'is_bought': bot_state['is_bought'],
                    'shares_exited': bot_state['shares_exited'],
                    'open_shares': bot_state['open_shares'],
                    f'{order_key}_status': 'FILLED'  # Update exit order status in database
                }
                # Store filled exit lines in database (as comma-separated string)
                if 'filled_exit_lines' in bot_state:
                    filled_lines_str = ','.join(sorted(bot_state['filled_exit_lines']))
                    db_update['filled_exit_lines'] = filled_lines_str
                await self._update_bot_in_db(bot_id, db_update)
                
                # Log exit order filled event (so frontend shows the exit order as filled)
                await self._log_bot_event(bot_id, 'spot_exit_limit_order', {
                    'line_price': exit_line_price,
                    'current_price': current_price,
                    'shares_to_sell': shares_sold,
                    'order_id': order_id,
                    'order_status': 'FILLED',
                    'line_id': line_id,
                    'strategy': 'uptrend_spot_limit'
                })
                
                # Log partial exit event (for position tracking)
                await self._log_bot_event(bot_id, 'spot_position_partial_exit', {
                    'shares_sold': shares_sold,
                    'remaining_shares': bot_state['open_shares'],
                    'total_exited': bot_state['shares_exited'],
                    'order_id': order_id,
                    'line_price': exit_line_price,
                    'line_id': line_id,
                    'strategy': 'uptrend_spot_limit'
                })
                
                logger.info(f"🤖 Bot {bot_id}: Sold {shares_sold} shares at ${exit_line_price:.2f}, {bot_state['open_shares']} remaining")
                
                # Check if all shares are sold - if so, complete the bot
                if bot_state['open_shares'] <= 0:
                    bot_state['is_bought'] = False
                    bot_state['crossed_lines'] = set()
                    logger.info(f"🎉 Bot {bot_id}: All shares sold! Completing bot...")
                    await self._complete_bot(bot_id)
                    return  # Exit early since bot is completed
                
            # Always check if exit order price needs updating (every cycle, not just every 30 seconds)
            if order_status_normalized in ['SUBMITTED', 'UNKNOWN', 'PENDING', 'PRESUBMITTED', 'WORKING']:
                # Recalculate exit line price from trend line (not current market price)
                line_id = order_info.get('line_id', '')
                logger.info(f"🔄 Bot {bot_id}: Checking price update for exit order {order_id}, line_id={line_id}")
                
                exit_line = None
                
                # Find the exit line for this order
                exit_lines = bot_state.get('exit_lines', [])
                logger.info(f"🔄 Bot {bot_id}: Searching {len(exit_lines)} exit lines for line_id={line_id}")
                
                for exit_line_candidate in exit_lines:
                    candidate_id = exit_line_candidate.get('id', '')
                    logger.debug(f"🔄 Bot {bot_id}: Checking exit line candidate: id={candidate_id}")
                    if candidate_id == line_id:
                        exit_line = exit_line_candidate
                        logger.info(f"✅ Bot {bot_id}: Found exit line {line_id} for order {order_id}")
                        break
                
                if exit_line and exit_line.get('points'):
                    # Recalculate exit line price from trend line points
                    exit_line_price_new = self._calculate_trend_line_price(exit_line['points'])
                    
                    # Get contract specs to round price to minimum tick
                    specs = ib_client.get_specs(bot_state['symbol'])
                    min_tick = specs.get('min_tick', 0.01) if specs else 0.01
                    
                    # Round price to minimum tick
                    def round_to_tick(price: float, tick: float) -> float:
                        return round(round(price / tick) * tick, 6)
                    
                    exit_line_price_rounded = round_to_tick(exit_line_price_new, min_tick)
                    old_price_raw = order_info.get('price', 0)
                    old_price = float(old_price_raw)
                    # Round old price to min_tick for accurate comparison
                    old_price_rounded = round_to_tick(old_price, min_tick)
                    
                    # Compare rounded prices directly - update if they're different
                    # Use a small epsilon (1/1000 of min_tick) for floating point comparison
                    epsilon = min_tick * 0.001  # Very small epsilon (0.00001 for 0.01 tick)
                    price_diff = abs(exit_line_price_rounded - old_price_rounded)
                    
                    logger.info(f"🔄 Bot {bot_id}: Exit order {order_id} price check - Old: ${old_price:.6f} (raw: {old_price_raw}, rounded: ${old_price_rounded:.6f}), New: ${exit_line_price_rounded:.6f}, Diff: ${price_diff:.9f}, MinTick: {min_tick}, Epsilon: {epsilon}")
                    
                    # Update if rounded prices are different (using epsilon for floating point safety)
                    if price_diff > epsilon:
                        logger.info(f"✅ Bot {bot_id}: Updating exit order {order_id} price from ${old_price:.6f} to ${exit_line_price_rounded:.6f} (trend line price, diff: ${price_diff:.9f} > epsilon: {epsilon})")
                        await self._update_exit_order_price(bot_id, order_key, order_info, exit_line_price_rounded)
                    else:
                        logger.info(f"⏭️ Bot {bot_id}: Exit order {order_id} price unchanged (${exit_line_price_rounded:.6f} vs ${old_price_rounded:.6f}, diff: ${price_diff:.9f} <= epsilon: {epsilon})")
                else:
                    if not exit_line:
                        logger.warning(f"⚠️ Bot {bot_id}: Could not find exit line with id={line_id} for order {order_id}. Available exit line IDs: {[e.get('id') for e in exit_lines]}")
                    else:
                        logger.warning(f"⚠️ Bot {bot_id}: Exit line {line_id} found but has no points data for order {order_id}")
            else:
                logger.debug(f"🔄 Bot {bot_id}: Exit order {order_id} status {order_status_normalized} is not active, skipping price update")
                
        except Exception as e:
            logger.error(f"Error checking exit order status for bot {bot_id}: {e}")
    
    async def _update_entry_order_price(self, bot_id: int, new_price: float):
        """Update entry order limit price"""
        try:
            bot_state = self.active_bots[bot_id]
            order_id = bot_state['entry_order_id']
            
            from app.utils.ib_client import ib_client
            
            # Modify the order with new price
            success = await ib_client.modify_order(order_id, new_price)
            
            if success:
                bot_state['entry_order_price'] = new_price
                bot_state['entry_order_last_update'] = time.time()
                
                logger.info(f"🔄 Bot {bot_id}: Updated entry order {order_id} price to ${new_price:.2f}")
            else:
                logger.warning(f"⚠️ Bot {bot_id}: Failed to update entry order {order_id} price")
                
        except Exception as e:
            logger.error(f"Error updating entry order price for bot {bot_id}: {e}")
    
    async def _update_exit_order_price(self, bot_id: int, order_key: str, order_info: dict, new_price: float):
        """Update exit order limit price"""
        try:
            order_id = order_info['order_id']
            
            from app.utils.ib_client import ib_client
            
            # Modify the order with new price
            success = await ib_client.modify_order(order_id, new_price)
            
            if success:
                order_info['price'] = new_price
                order_info['last_update'] = time.time()
                
                logger.info(f"🔄 Bot {bot_id}: Updated exit order {order_id} price to ${new_price:.2f}")
            else:
                logger.warning(f"⚠️ Bot {bot_id}: Failed to update exit order {order_id} price")
                
        except Exception as e:
            logger.error(f"Error updating exit order price for bot {bot_id}: {e}")
    
    async def _create_exit_orders_on_position_open(self, bot_id: int, current_price: float, force_resubmit: bool = False):
        """Create exit limit orders for all exit lines when position is opened or resubmit if missing"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if not bot_state.get('exit_lines'):
                logger.warning(f"Bot {bot_id}: No exit lines configured - cannot create exit orders")
                return
            
            # Use open_shares for total shares to allocate (remaining shares after fills)
            total_shares_to_allocate = bot_state.get('open_shares', 0)
            if total_shares_to_allocate <= 0:
                total_shares_to_allocate = bot_state.get('shares_entered', 0)
            
            # Use shares_entered (original total) for calculating per-line allocation
            # This ensures consistent allocation (50/50) regardless of partial fills
            original_total_shares = bot_state.get('shares_entered', 0)
            if original_total_shares <= 0:
                original_total_shares = total_shares_to_allocate
            
            if total_shares_to_allocate <= 0:
                logger.error(f"Bot {bot_id}: Cannot create exit orders - open_shares={bot_state.get('open_shares', 0)}, shares_entered={bot_state.get('shares_entered', 0)}")
                return
            
            total_exit_lines = len(bot_state['exit_lines'])
            if total_exit_lines == 0:
                logger.warning(f"Bot {bot_id}: No exit lines found - cannot create exit orders")
                return
            
            # Load filled exit lines from bot_state (set of line IDs that have been filled)
            filled_exit_lines = bot_state.get('filled_exit_lines', set())
            if isinstance(filled_exit_lines, str):
                # If loaded from database as comma-separated string, convert to set
                filled_exit_lines = set(filled_exit_lines.split(',')) if filled_exit_lines else set()
            elif not isinstance(filled_exit_lines, set):
                filled_exit_lines = set()
            
            # Filter out filled exit lines - only work with unfilled lines
            unfilled_exit_lines = [line for line in bot_state['exit_lines'] if line.get('id') not in filled_exit_lines]
            unfilled_count = len(unfilled_exit_lines)
            
            if unfilled_count == 0:
                logger.info(f"✅ Bot {bot_id}: All exit lines have been filled ({len(filled_exit_lines)}/{total_exit_lines}), no need to create orders")
                return
            
            logger.info(f"🔄 Bot {bot_id}: {unfilled_count} unfilled exit lines out of {total_exit_lines} total. Filled lines: {filled_exit_lines}")
            logger.info(f"🔄 Bot {bot_id}: Original total shares: {original_total_shares}, Shares to allocate: {total_shares_to_allocate}")
            
            # Calculate target shares per exit line based on ORIGINAL total shares and ORIGINAL exit lines count
            # This ensures each exit line gets a fixed share (e.g., 50/50) regardless of which lines are filled
            shares_per_exit = original_total_shares // total_exit_lines if total_exit_lines > 0 else 0
            logger.info(f"🔄 Bot {bot_id}: Shares per exit line (based on original {total_exit_lines} lines and {original_total_shares} shares): {shares_per_exit}")
            
            # Check which unfilled exit lines already have active orders and if they need updating
            active_exit_statuses = {
                'PENDING', 'SUBMITTED', 'PRESUBMITTED', 'PENDINGSUBMIT',
                'PENDING_SUBMIT', 'WORKING', 'UNKNOWN', 'API_PENDING'
            }
            exit_lines_needing_orders = []
            orders_to_cancel = []
            
            for i, exit_line in enumerate(unfilled_exit_lines):
                exit_order_key = f"exit_order_{exit_line['id']}"
                existing_order = bot_state.get(exit_order_key)
                
                # Calculate target shares for this exit line (always use shares_per_exit based on original count)
                # Check if this is the last original exit line (not just last unfilled) to handle remainder
                exit_line_index_in_original = next((j for j, line in enumerate(bot_state['exit_lines']) if line['id'] == exit_line['id']), -1)
                is_last_original_exit_line = exit_line_index_in_original == total_exit_lines - 1
                
                if is_last_original_exit_line:
                    # Last original exit line gets any remainder
                    total_allocated = shares_per_exit * (total_exit_lines - 1)
                    remainder = original_total_shares - total_allocated
                    target_shares = remainder if remainder > 0 else shares_per_exit
                else:
                    # All other exit lines get equal shares
                    target_shares = shares_per_exit
                
                if force_resubmit:
                    # Force resubmit: cancel existing order if any, then create new one
                    if existing_order and isinstance(existing_order, dict):
                        orders_to_cancel.append((exit_order_key, existing_order))
                    exit_lines_needing_orders.append(exit_line)
                elif existing_order and isinstance(existing_order, dict):
                    status = (existing_order.get('status') or 'PENDING').upper()
                    existing_shares = int(existing_order.get('quantity', 0)) if existing_order.get('quantity') is not None else 0
                    target_shares_int = int(target_shares)
                    
                    if status not in active_exit_statuses or status == 'FILLED':
                        # Order doesn't exist, is filled, or is inactive - need new one
                        logger.info(f"🔄 Bot {bot_id}: Exit order for line {exit_line['id']} status is {status}, will create new order")
                        exit_lines_needing_orders.append(exit_line)
                    elif existing_shares != target_shares_int:
                        # Order exists but shares have changed - cancel and recreate
                        logger.info(f"🔄 Bot {bot_id}: Exit order for line {exit_line['id']} shares changed from {existing_shares} to {target_shares_int}, will update")
                        orders_to_cancel.append((exit_order_key, existing_order))
                        exit_lines_needing_orders.append(exit_line)
                    else:
                        logger.info(f"✅ Bot {bot_id}: Exit order for line {exit_line['id']} already exists with correct shares ({target_shares_int}) and status {status}")
                else:
                    # No order exists for this line
                    logger.info(f"🔄 Bot {bot_id}: No exit order found for line {exit_line['id']}, will create new order")
                    exit_lines_needing_orders.append(exit_line)
            
            # Cancel existing orders that need to be updated
            # Also check all exit lines for any existing orders when force_resubmit is True
            if force_resubmit:
                # When force_resubmit is True, cancel ALL existing exit orders for unfilled lines
                logger.info(f"🔄 Bot {bot_id}: Force resubmit mode - checking all unfilled exit lines for existing orders to cancel")
                for exit_line in unfilled_exit_lines:
                    exit_order_key = f"exit_order_{exit_line['id']}"
                    existing_order = bot_state.get(exit_order_key)
                    if existing_order and isinstance(existing_order, dict):
                        order_id = existing_order.get('order_id')
                        if order_id:
                            # Check if already in orders_to_cancel
                            already_in_cancel_list = any(
                                cancel_key == exit_order_key
                                for cancel_key, _ in orders_to_cancel
                            )
                            if not already_in_cancel_list:
                                logger.info(f"🔄 Bot {bot_id}: Force resubmit - will cancel existing exit order {order_id} for {exit_order_key}")
                                orders_to_cancel.append((exit_order_key, existing_order))
            
            if orders_to_cancel:
                from app.utils.ib_client import ib_client
                logger.info(f"🔄 Bot {bot_id}: Cancelling {len(orders_to_cancel)} exit orders that need updating")
                cancelled_keys = []
                for exit_order_key, order_info in orders_to_cancel:
                    try:
                        order_id = order_info.get('order_id')
                        line_id = order_info.get('line_id', '')
                        cancelled_quantity = order_info.get('quantity', 0)
                        cancelled_price = order_info.get('price', 0)
                        
                        if order_id:
                            logger.info(f"🔄 Bot {bot_id}: Cancelling exit order {order_id} for {exit_order_key} (current shares: {cancelled_quantity})")
                            success = await ib_client.cancel_order(order_id)
                            if success:
                                logger.info(f"✅ Bot {bot_id}: Successfully cancelled exit order {order_id}")
                                
                                # Log cancellation event so it shows as CANCELLED in trade history
                                await self._log_bot_event(bot_id, 'spot_exit_limit_order', {
                                    'line_price': cancelled_price,
                                    'current_price': current_price,
                                    'shares_to_sell': cancelled_quantity,
                                    'order_id': order_id,
                                    'order_status': 'CANCELLED',
                                    'line_id': line_id,
                                    'strategy': 'uptrend_spot_limit',
                                    'note': 'cancelled_for_update'
                                })
                                
                                cancelled_keys.append(exit_order_key)
                            else:
                                logger.warning(f"⚠️ Bot {bot_id}: Failed to cancel exit order {order_id}, but will continue to create new order")
                                # Still remove from bot_state even if cancellation failed, so we create new order
                                cancelled_keys.append(exit_order_key)
                    except Exception as e:
                        logger.error(f"❌ Bot {bot_id}: Error cancelling exit order {exit_order_key}: {e}")
                        # Still remove from bot_state on error, so we create new order
                        cancelled_keys.append(exit_order_key)
                
                # Remove cancelled orders from bot_state after all cancellations
                for exit_order_key in cancelled_keys:
                    if exit_order_key in bot_state:
                        del bot_state[exit_order_key]
                        logger.info(f"🗑️ Bot {bot_id}: Removed {exit_order_key} from bot_state after cancellation")
                
                # Small delay to ensure cancellation is processed
                await asyncio.sleep(0.5)
            
            if not exit_lines_needing_orders:
                logger.info(f"✅ Bot {bot_id}: All exit orders already exist with correct shares, no need to resubmit")
                return
            
            logger.info(f"🤖 Bot {bot_id}: Creating/resubmitting exit orders for {len(exit_lines_needing_orders)} exit lines with {total_shares_to_allocate} shares to allocate (original: {original_total_shares})")
            
            # Use the same shares_per_exit calculation based on original exit lines count and original total shares
            # This ensures consistent share allocation (50/50) regardless of which lines are filled
            num_lines_needing_orders = len(exit_lines_needing_orders)
            if num_lines_needing_orders == 0:
                logger.info(f"✅ Bot {bot_id}: No exit lines need orders")
                return
            
            # Calculate shares per exit line based on ORIGINAL total shares and ORIGINAL exit lines count
            # Each exit line should get original_total_shares // total_exit_lines (e.g., 100 // 2 = 50)
            shares_per_exit_line = original_total_shares // total_exit_lines if total_exit_lines > 0 else 0
            logger.info(f"🤖 Bot {bot_id}: Shares per exit line (based on original {total_exit_lines} lines and {original_total_shares} shares): {shares_per_exit_line}")
            
            # Create exit orders for each exit line that needs an order
            orders_created = 0
            for i, exit_line in enumerate(exit_lines_needing_orders):
                try:
                    # Each exit line gets equal shares based on original count (e.g., 50/50)
                    # Only the last original exit line (not the last unfilled) gets any remainder
                    # Check if this is the last original exit line by comparing line IDs
                    exit_line_index_in_original = next((j for j, line in enumerate(bot_state['exit_lines']) if line['id'] == exit_line['id']), -1)
                    is_last_original_exit_line = exit_line_index_in_original == total_exit_lines - 1
                    
                    if is_last_original_exit_line:
                        # Last original exit line gets any remainder
                        total_allocated = shares_per_exit_line * (total_exit_lines - 1)
                        remainder = original_total_shares - total_allocated
                        shares_to_sell = remainder if remainder > 0 else shares_per_exit_line
                        logger.info(f"🤖 Bot {bot_id}: Last original exit line {exit_line['id']} gets remainder: {shares_to_sell} shares (from original {original_total_shares} shares)")
                    else:
                        shares_to_sell = shares_per_exit_line
                    
                    if shares_to_sell <= 0:
                        logger.warning(f"Bot {bot_id}: Skipping exit line {exit_line['id']} - shares_to_sell is {shares_to_sell}")
                        continue
                    
                    # Get current price for this exit line
                    exit_line_price = self._calculate_trend_line_price(exit_line['points'])
                    
                    # Place limit sell order
                    from app.utils.ib_client import ib_client
                    contract = await ib_client.qualify_stock(bot_state['symbol'])
                    if not contract:
                        logger.error(f"❌ Bot {bot_id}: Could not qualify {bot_state['symbol']} for exit order on line {exit_line['id']}")
                        continue
                    
                    # Get contract specs to round price to minimum tick
                    specs = ib_client.get_specs(bot_state['symbol'])
                    min_tick = specs.get('min_tick', 0.01) if specs else 0.01
                    
                    # Round price to minimum tick to avoid Error 110
                    def round_to_tick(price: float, tick: float) -> float:
                        return round(round(price / tick) * tick, 6)
                    
                    exit_line_price_rounded = round_to_tick(exit_line_price, min_tick)
                    
                    logger.info(f"🤖 Bot {bot_id}: Creating exit order for line {exit_line['id']} - {shares_to_sell} shares at ${exit_line_price_rounded:.6f} (original: ${exit_line_price:.6f}, min_tick: {min_tick})")
                    
                    from ib_async import LimitOrder
                    order = LimitOrder("SELL", shares_to_sell, exit_line_price_rounded)
                    trade = await ib_client.place_order(contract, order)
                    
                    if trade:
                        order_id = trade.order.orderId
                        logger.info(f"✅ Bot {bot_id}: Exit order {order_id} placed for line {exit_line['id']} - {shares_to_sell} shares at ${exit_line_price_rounded:.6f} (rounded from ${exit_line_price:.6f})")

                        initial_status = await ib_client.await_order_submission(trade, timeout=6.0)
                        normalized_status = (initial_status or 'PENDING').strip().upper()
                        
                        logger.info(f"📊 Bot {bot_id}: Exit order {order_id} initial status: {normalized_status}")

                        if normalized_status in {'CANCELLED', 'INACTIVE', 'APICANCELLED', 'REJECTED', 'ERROR'}:
                            logger.error(
                                f"❌ Bot {bot_id}: Exit order {order_id} rejected with status {normalized_status} at price ${exit_line_price_rounded:.6f}"
                            )
                            await self._log_bot_event(bot_id, 'exit_order_rejected', {
                                'line_id': exit_line['id'],
                                'line_price': exit_line_price_rounded,  # Use rounded price
                                'shares_to_sell': shares_to_sell,
                                'order_id': order_id,
                                'status': normalized_status,
                            })
                            continue

                        if normalized_status == 'FILLED':
                            logger.info(
                                f"✅ Bot {bot_id}: Exit order {order_id} filled immediately at ${exit_line_price_rounded:.6f}"
                            )
                            bot_state['shares_exited'] = bot_state.get('shares_exited', 0) + shares_to_sell
                            bot_state['open_shares'] = max(0, bot_state.get('open_shares', 0) - shares_to_sell)

                            # Mark this exit line as filled (so we don't create orders for it again)
                            if 'filled_exit_lines' not in bot_state:
                                bot_state['filled_exit_lines'] = set()
                            bot_state['filled_exit_lines'].add(exit_line['id'])
                            logger.info(f"✅ Bot {bot_id}: Marked exit line {exit_line['id']} as FILLED (immediate fill). Filled exit lines: {bot_state['filled_exit_lines']}")

                            fully_closed = bot_state['open_shares'] <= 0
                            if fully_closed:
                                bot_state['is_bought'] = False
                                bot_state['crossed_lines'] = set()

                            db_update = {
                                'shares_exited': bot_state['shares_exited'],
                                'open_shares': bot_state['open_shares'],
                                'is_bought': bot_state.get('is_bought', False),
                            }
                            # Store filled exit lines in database
                            if 'filled_exit_lines' in bot_state:
                                filled_lines_str = ','.join(sorted(bot_state['filled_exit_lines']))
                                db_update['filled_exit_lines'] = filled_lines_str
                            
                            await self._update_bot_in_db(bot_id, db_update)

                            # Log exit order filled event (so frontend shows the exit order as filled)
                            await self._log_bot_event(bot_id, 'spot_exit_limit_order', {
                                'line_price': exit_line_price_rounded,
                                'current_price': current_price,
                                'shares_to_sell': shares_to_sell,
                                'order_id': order_id,
                                'order_status': 'FILLED',
                                'line_id': exit_line['id'],
                                'strategy': 'uptrend_spot_limit',
                                'note': 'filled_immediately_on_submit'
                            })

                            # Log partial exit event (for position tracking)
                            await self._log_bot_event(bot_id, 'spot_position_partial_exit', {
                                'line_id': exit_line['id'],
                                'line_price': exit_line_price_rounded,
                                'shares_sold': shares_to_sell,
                                'remaining_shares': bot_state['open_shares'],
                                'total_exited': bot_state['shares_exited'],
                                'order_id': order_id,
                                'strategy': 'uptrend_spot_limit',
                                'note': 'filled_immediately_on_submit'
                            })

                            if fully_closed:
                                logger.info(f"🎉 Bot {bot_id}: All shares sold via immediate fill; completing bot.")
                                await self._complete_bot(bot_id)
                            continue

                        # Order is pending - store it and log event
                        exit_order_key = f"exit_order_{exit_line['id']}"
                        bot_state[exit_order_key] = {
                            'order_id': order_id,
                            'status': normalized_status,
                            'price': exit_line_price_rounded,  # Store rounded price (actual order price)
                            'quantity': shares_to_sell,
                            'last_update': time.time(),
                            'line_id': exit_line['id']
                        }
                        
                        await self._update_bot_in_db(bot_id, {
                            f'{exit_order_key}_id': order_id,
                            f'{exit_order_key}_status': normalized_status
                        })
                        
                        # Log exit order event with the same event type as _submit_exit_order
                        await self._log_bot_event(bot_id, 'spot_exit_limit_order', {
                            'line_price': exit_line_price_rounded,  # Use rounded price (actual order price)
                            'current_price': current_price,
                            'shares_to_sell': shares_to_sell,
                            'order_id': order_id,
                            'order_status': normalized_status,
                            'line_id': exit_line['id'],
                            'strategy': 'uptrend_spot_limit'
                        })
                        
                        orders_created += 1
                        logger.info(f"✅ Bot {bot_id}: Exit order {order_id} logged as event (status: {normalized_status})")
                    else:
                        logger.error(f"❌ Bot {bot_id}: Failed to place exit order for line {exit_line['id']} - trade is None")
                except Exception as e:
                    logger.error(f"❌ Bot {bot_id}: Error creating exit order for line {exit_line.get('id', 'unknown')}: {e}", exc_info=True)
            
            logger.info(f"✅ Bot {bot_id}: Exit orders creation completed - {orders_created} orders created out of {total_exit_lines} exit lines")
            
        except Exception as e:
            logger.error(f"❌ Bot {bot_id}: Error creating exit orders: {e}", exc_info=True)
        
    async def _place_stop_loss_order(self, bot_id: int, entry_price: float, quantity: int):
        """Place stop-loss order when buy order is submitted"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Check if there's an existing stop loss order - cancel it before placing a new one
            existing_stop_loss_order_id = bot_state.get('stop_loss_order_id')
            if existing_stop_loss_order_id:
                try:
                    logger.info(f"🔄 Bot {bot_id}: Cancelling existing stop loss order {existing_stop_loss_order_id} before placing new one")
                    from app.utils.ib_client import ib_client
                    success = await ib_client.cancel_order(int(existing_stop_loss_order_id) if isinstance(existing_stop_loss_order_id, str) else existing_stop_loss_order_id)
                    if success:
                        logger.info(f"✅ Bot {bot_id}: Successfully cancelled existing stop loss order")
                    else:
                        logger.warning(f"⚠️ Bot {bot_id}: Failed to cancel existing stop loss order, but continuing with new order")
                except Exception as e:
                    logger.warning(f"⚠️ Bot {bot_id}: Error cancelling existing stop loss order: {e}, but continuing with new order")
            
            # Get hard stop-out percentage
            hard_stop_out_pct = float(bot_state.get('bot_hard_stop_out', 5.0))
            
            # Calculate stop-loss price (entry price - stop-out percentage)
            stop_loss_price = entry_price * (1 - hard_stop_out_pct / 100)
            
            logger.info(f"🛡️ Bot {bot_id}: Placing stop-loss order at ${stop_loss_price:.2f} ({hard_stop_out_pct}% below entry) for {quantity} shares")
            
            # Get contract
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"Could not qualify {bot_state['symbol']} for stop-loss")
                return
                
            # Import StopOrder
            from ib_async import StopOrder
            
            # Place stop-loss order
            stop_order = StopOrder("SELL", quantity, stop_loss_price)
            trade = await ib_client.place_order(contract, stop_order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: STOP-LOSS ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Store stop-loss order information (convert order ID to string for database)
                stop_loss_order_id_str = str(trade.order.orderId)
                bot_state['stop_loss_order_id'] = stop_loss_order_id_str
                bot_state['stop_loss_price'] = stop_loss_price
                bot_state['stop_loss_quantity'] = quantity
                bot_state['stop_loss_percentage'] = hard_stop_out_pct
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'stop_loss_order_id': stop_loss_order_id_str,
                    'stop_loss_price': stop_loss_price
                })
                
                # Log event
                await self._log_bot_event(bot_id, 'stop_loss_order_placed', {
                    'entry_price': entry_price,
                    'stop_loss_price': stop_loss_price,
                    'stop_loss_percentage': hard_stop_out_pct,
                    'quantity': quantity,
                    'order_id': trade.order.orderId
                })
                
                logger.info(f"✅ Bot {bot_id}: Stop-loss order placed successfully")
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place stop-loss order")
                
        except Exception as e:
            logger.error(f"Error placing stop-loss order for bot {bot_id}: {e}")
        
    async def _check_soft_stop_out(self, bot_id: int, current_price: float):
        """Check for soft stop-out conditions with timer and execute sell if timer expires"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Only check if bot has bought shares
            if not bot_state['is_bought'] or bot_state['open_shares'] <= 0:
                # Reset timer if position is closed
                bot_state['soft_stop_timer_start'] = None
                bot_state['soft_stop_timer_active'] = False
                return
            
            entry_price = bot_state.get('entry_price', 0)
            if entry_price <= 0:
                return  # No valid entry price
            
            # Convert entry_price to float
            entry_price = float(entry_price)
            
            # Get soft stop and hard stop percentages
            soft_stop_pct = bot_state.get('soft_stop_pct', 5.0)
            hard_stop_pct = bot_state.get('hard_stop_pct', 5.0)
            soft_stop_minutes = bot_state.get('soft_stop_minutes', 5)
            
            # Calculate stop prices
            soft_stop_price = entry_price * (1 - soft_stop_pct / 100)
            hard_stop_price = entry_price * (1 - hard_stop_pct / 100)
            
            # Check if price goes below hard stop - this takes priority
            if current_price <= hard_stop_price:
                # Hard stop takes priority - reset soft stop timer (hard stop handler will sell)
                bot_state['soft_stop_timer_start'] = None
                bot_state['soft_stop_timer_active'] = False
                return
            
            # Check if price is below soft stop
            if current_price <= soft_stop_price:
                # Price is below soft stop - start or continue timer
                if not bot_state['soft_stop_timer_active']:
                    # Start the timer
                    bot_state['soft_stop_timer_start'] = time.time()
                    bot_state['soft_stop_timer_active'] = True
                    logger.info(f"⏱️ Bot {bot_id}: SOFT STOP TIMER STARTED - "
                              f"Entry: ${entry_price:.2f}, Current: ${current_price:.2f}, "
                              f"Soft stop: ${soft_stop_price:.2f} ({soft_stop_pct}%), "
                              f"Timer: {soft_stop_minutes} minutes")
                
                # Check if timer has expired
                if bot_state['soft_stop_timer_active'] and bot_state['soft_stop_timer_start']:
                    elapsed_minutes = (time.time() - bot_state['soft_stop_timer_start']) / 60
                    
                    if elapsed_minutes >= soft_stop_minutes:
                        # Timer expired - sell position
                        logger.warning(f"⏱️ Bot {bot_id}: SOFT STOP TIMER EXPIRED! "
                                     f"Price stayed below soft stop for {elapsed_minutes:.1f} minutes. "
                                     f"Selling position...")
                        
                        # Execute soft stop sell
                        await self._execute_soft_stop_sell(bot_id, current_price)
            else:
                # Price is above soft stop - reset timer
                if bot_state['soft_stop_timer_active']:
                    logger.info(f"⏱️ Bot {bot_id}: SOFT STOP TIMER RESET - "
                              f"Price recovered above soft stop: ${current_price:.2f} > ${soft_stop_price:.2f}")
                    bot_state['soft_stop_timer_start'] = None
                    bot_state['soft_stop_timer_active'] = False
                    
        except Exception as e:
            logger.error(f"Error checking soft stop-out for bot {bot_id}: {e}")
    
    async def _execute_soft_stop_sell(self, bot_id: int, current_price: float):
        """Execute market sell due to soft stop timer expiry"""
        try:
            bot_state = self.active_bots[bot_id]
            shares_to_sell = bot_state['open_shares']
            
            if shares_to_sell <= 0:
                return
                
            logger.warning(f"⏱️ Bot {bot_id}: Executing SOFT STOP SELL of {shares_to_sell} shares at ${current_price:.2f}")
            
            # Place market sell order
            from app.utils.ib_client import ib_client
            from ib_async import MarketOrder
            
            # Get contract
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"❌ Bot {bot_id}: Could not get contract for {bot_state['symbol']}")
                return
            
            # Place market sell order
            order = MarketOrder("SELL", shares_to_sell)
            trade = await ib_client.place_order(contract, order)
            
            if trade and trade.order:
                logger.warning(f"⏱️ Bot {bot_id}: SOFT STOP ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Update bot state - sell all remaining shares and stop the bot
                bot_state['shares_exited'] += shares_to_sell
                bot_state['open_shares'] = 0
                bot_state['is_bought'] = False
                bot_state['is_active'] = False  # Stop the bot
                bot_state['is_running'] = False  # Stop running
                bot_state['status'] = 'SOFT_STOPPED_OUT'  # Set status
                bot_state['soft_stop_timer_start'] = None  # Clear timer
                bot_state['soft_stop_timer_active'] = False  # Clear timer flag
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'is_bought': False,
                    'is_active': False,
                    'is_running': False,
                    'shares_exited': bot_state['shares_exited'],
                    'open_shares': 0,
                    'status': 'SOFT_STOPPED_OUT'
                })
                
                # Log event
                await self._log_bot_event(bot_id, 'soft_stop_sell', {
                    'current_price': current_price,
                    'shares_sold': shares_to_sell,
                    'order_id': trade.order.orderId if trade.order else None,
                    'reason': 'soft_stop_timer_expired'
                })
                
                logger.warning(f"⏱️ Bot {bot_id}: SOFT STOP COMPLETED - All shares sold")
                
                # Remove bot from active bots since it's stopped
                if bot_id in self.active_bots:
                    del self.active_bots[bot_id]
                    logger.info(f"⏱️ Bot {bot_id}: Removed from active bots due to soft stop-out")
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place soft stop sell order")
                
        except Exception as e:
            logger.error(f"Error executing soft stop sell for bot {bot_id}: {e}")
    
    async def _check_hard_stop_out(self, bot_id: int, current_price: float):
        """Check for hard stop-out conditions and execute emergency sell"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Only check if bot has bought shares and has a hard stop-out configured
            if not bot_state['is_bought'] or bot_state['open_shares'] <= 0:
                return
                
            # Use hard stop from global config (already loaded in bot state)
            hard_stop_pct = bot_state.get('hard_stop_pct', bot_state.get('bot_hard_stop_out', 0.0))
            if hard_stop_pct <= 0:
                return  # No hard stop-out configured
            
            entry_price = bot_state.get('entry_price', 0)
            if entry_price <= 0:
                return  # No valid entry price
                
            # Convert entry_price to float to avoid Decimal type errors
            entry_price = float(entry_price)
            
            # Calculate stop-out price (entry price - stop-out percentage)
            stop_out_price = entry_price * (1 - hard_stop_pct / 100)
            
            # Check if current price has dropped below stop-out price
            if current_price <= stop_out_price:
                logger.warning(f"🚨 Bot {bot_id}: HARD STOP-OUT TRIGGERED! "
                              f"Entry: ${entry_price:.2f}, Current: ${current_price:.2f}, "
                              f"Stop-out: ${stop_out_price:.2f} ({hard_stop_pct}%)")
                
                # Reset soft stop timer (hard stop takes priority)
                bot_state['soft_stop_timer_start'] = None
                bot_state['soft_stop_timer_active'] = False
                
                # Execute emergency sell of all remaining shares
                await self._execute_hard_stop_out_sell(bot_id, current_price)
                
        except Exception as e:
            logger.error(f"Error checking hard stop-out for bot {bot_id}: {e}")
            
    async def _execute_hard_stop_out_sell(self, bot_id: int, current_price: float):
        """Execute emergency sell of all remaining shares due to hard stop-out"""
        try:
            bot_state = self.active_bots[bot_id]
            shares_to_sell = bot_state['open_shares']
            
            if shares_to_sell <= 0:
                return
                
            logger.warning(f"🚨 Bot {bot_id}: Executing HARD STOP-OUT SELL of {shares_to_sell} shares at ${current_price:.2f}")
            
            # Place market sell order
            from app.utils.ib_client import ib_client
            from ib_async import MarketOrder
            
            # Get contract
            contract = await ib_client.get_contract(bot_state['symbol'])
            if not contract:
                logger.error(f"❌ Bot {bot_id}: Could not get contract for {bot_state['symbol']}")
                return
                
            # Place market sell order
            order = MarketOrder("SELL", shares_to_sell)
            trade = ib_client.ib.placeOrder(contract, order)
            
            if trade:
                logger.warning(f"🚨 Bot {bot_id}: HARD STOP-OUT ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Update bot state - sell all remaining shares and stop the bot
                bot_state['shares_exited'] += shares_to_sell
                bot_state['open_shares'] = 0
                bot_state['is_bought'] = False
                bot_state['is_active'] = False  # Stop the bot
                bot_state['is_running'] = False  # Stop running
                bot_state['hard_stop_triggered'] = True  # Mark hard stop as triggered
                bot_state['status'] = 'HARD_STOPPED_OUT'  # Set status to hard stopped
                bot_state['crossed_lines'] = set()  # Reset crossed lines
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'is_bought': False,
                    'is_active': False,
                    'is_running': False,
                    'shares_exited': bot_state['shares_exited'],
                    'open_shares': 0,
                    'hard_stop_triggered': True,
                    'status': 'HARD_STOPPED_OUT'
                })
                
                # Log event
                await self._log_bot_event(bot_id, 'hard_stop_out_sell', {
                    'current_price': current_price,
                    'shares_sold': shares_to_sell,
                    'order_id': trade.order.orderId,
                    'reason': 'hard_stop_out_triggered'
                })
                
                logger.warning(f"🚨 Bot {bot_id}: HARD STOP-OUT COMPLETED - All shares sold")
                
                # Remove bot from active bots since it's stopped
                if bot_id in self.active_bots:
                    del self.active_bots[bot_id]
                    logger.info(f"🚨 Bot {bot_id}: Removed from active bots due to hard stop-out")
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place hard stop-out order")
                
        except Exception as e:
            logger.error(f"Error executing hard stop-out sell for bot {bot_id}: {e}")
                    
    async def _execute_entry_trade(self, bot_id: int, line, current_price: float):
        """Execute entry trade based on trend strategy"""
        try:
            bot_state = self.active_bots[bot_id]
            trend_strategy = bot_state.get('trend_strategy', 'uptrend')
            
            if trend_strategy == 'uptrend':
                # UPTREND: Use spot/equity trading (buy stocks)
                await self._execute_spot_entry_trade(bot_id, line, current_price)
            elif trend_strategy == 'downtrend':
                # DOWNTREND: Use options trading (buy puts)
                await self._execute_options_entry_trade(bot_id, line, current_price)
            else:
                logger.error(f"Unknown trend strategy: {trend_strategy}")
                
        except Exception as e:
            logger.error(f"Error executing entry trade for bot {bot_id}: {e}")
            
    async def _execute_spot_entry_trade(self, bot_id: int, line, current_price: float):
        """Execute spot/equity entry trade (uptrend strategy) using market orders"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Place market buy order for stocks
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"Could not qualify {bot_state['symbol']}")
                return
                
            # Import MarketOrder
            from ib_async import MarketOrder
            
            # Check if multi-buy mode is enabled
            if bot_state.get('multi_buy') == 'enabled' and len(bot_state.get('entry_lines', [])) >= 2:
                # Multi-buy mode: Place incremental orders as price crosses each level
                await self._execute_multi_buy_entry_trade(bot_id, line, current_price)
                return
            
            # Single buy mode: trade_amount is the number of shares to buy
            trade_amount = bot_state.get('trade_amount', bot_state.get('position_size', 100))
            shares_to_buy = int(trade_amount)
            if shares_to_buy < 1:
                shares_to_buy = 1  # Minimum 1 share
            
            logger.info(f"🤖 Bot {bot_id}: Single-buy mode - Buying {shares_to_buy} shares (trade_amount={trade_amount}) at price ${current_price:.2f}")
            
            order = MarketOrder("BUY", shares_to_buy)
            trade = await ib_client.place_order(contract, order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: MARKET BUY ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Single buy mode: Execute immediately (multi-buy mode handled separately)
                bot_state['is_bought'] = True
                bot_state['entry_price'] = current_price
                bot_state['shares_entered'] = shares_to_buy
                bot_state['open_shares'] = shares_to_buy
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'is_bought': True,
                    'entry_price': current_price,
                    'shares_entered': shares_to_buy,
                    'open_shares': shares_to_buy,
                    'entry_order_status': 'FILLED'
                })
                
                # Log entry order event
                await self._log_bot_event(bot_id, 'spot_entry_market_order', {
                    'line_price': line.get('price', current_price),
                    'current_price': current_price,
                    'shares_bought': shares_to_buy,
                    'order_id': trade.order.orderId,
                    'order_status': 'FILLED',
                    'strategy': 'uptrend_spot_market'
                })
                
                # Log position opened event
                await self._log_bot_event(bot_id, 'spot_position_opened', {
                    'entry_price': current_price,
                    'shares_bought': shares_to_buy,
                    'order_id': trade.order.orderId,
                    'strategy': 'uptrend_spot_limit'
                })
                
                logger.info(f"🤖 Bot {bot_id}: Position opened - {shares_to_buy} shares at ${current_price:.2f}")
                
                # Place stop-loss order
                await self._place_stop_loss_order(bot_id, current_price, shares_to_buy)
                
                # Create exit limit orders for all exit lines immediately
                await self._create_exit_orders_on_position_open(bot_id, current_price)
                
                bot_state['entry_order_id'] = trade.order.orderId
                bot_state['entry_order_status'] = 'FILLED'
                bot_state['entry_order_price'] = current_price
                bot_state['entry_order_quantity'] = shares_to_buy
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place entry market order")
            
        except Exception as e:
            logger.error(f"Error executing spot entry trade for bot {bot_id}: {e}")
            
    async def _execute_options_entry_trade(self, bot_id: int, line, current_price: float):
        """Execute options entry trade (downtrend strategy)"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Find appropriate put option
            option_info = await self._find_put_option(bot_state['symbol'], current_price)
            if not option_info:
                logger.error(f"Could not find put option for {bot_state['symbol']}")
                return
                
            # Create options contract
            from ib_async import Option
            contract = Option(
                symbol=bot_state['symbol'],
                lastTradeDateOrContractMonth=option_info['expiry'],
                strike=option_info['strike'],
                right='P',  # Put option
                exchange='SMART'
            )
            
            # Qualify the contract
            qualified_contracts = await ib_client.qualify_contracts(contract)
            if not qualified_contracts:
                logger.error(f"Could not qualify put option contract")
                return
                
            contract = qualified_contracts[0]
            
            # Calculate number of contracts (options are typically 100 shares per contract)
            contracts_to_buy = max(1, bot_state['position_size'] // 100)
            
            # Place market buy order for put options
            order = MarketOrder("BUY", contracts_to_buy)
            trade = await ib_client.place_order(contract, order)
            
            # Update bot state
            bot_state['is_bought'] = True
            bot_state['entry_price'] = current_price
            bot_state['shares_entered'] += contracts_to_buy
            bot_state['total_position'] += contracts_to_buy
            bot_state['open_shares'] += contracts_to_buy
            
            # Store option details
            bot_state['option_contract'] = contract
            bot_state['option_strike'] = option_info['strike']
            bot_state['option_expiry'] = option_info['expiry']
            bot_state['option_right'] = 'P'
            
            # Update database
            await self._update_bot_in_db(bot_id, {
                'is_bought': True,
                'entry_price': current_price,
                'shares_entered': bot_state['shares_entered'],
                'total_position': bot_state['total_position'],
                'open_shares': bot_state['open_shares']
            })
            
            # Log event
            await self._log_bot_event(bot_id, 'options_position_opened', {
                'line_price': line['price'],
                'current_price': current_price,
                'contracts': contracts_to_buy,
                'strike': option_info['strike'],
                'expiry': option_info['expiry'],
                'order_id': trade.order.orderId if trade.order else None,
                'strategy': 'downtrend_options'
            })
            
            logger.info(f"🤖 Bot {bot_id} opened OPTIONS position: {contracts_to_buy} PUT contracts at ${current_price}")
            
        except Exception as e:
            logger.error(f"Error executing options entry trade for bot {bot_id}: {e}")
            
    async def _find_put_option(self, symbol: str, current_price: float) -> dict:
        """Find appropriate put option for downtrend strategy"""
        try:
            # For now, use a simple strategy:
            # Find a put option that's 5% out of the money with 30-45 DTE
            target_strike = current_price * 0.95  # 5% OTM
            
            # Get current date and add 30-45 days for expiry
            from datetime import datetime, timedelta
            target_expiry = datetime.now() + timedelta(days=35)
            expiry_str = target_expiry.strftime("%Y%m%d")
            
            # Round strike to nearest $5 increment
            strike = round(target_strike / 5) * 5
            
            return {
                'strike': strike,
                'expiry': expiry_str,
                'right': 'P'
            }
            
        except Exception as e:
            logger.error(f"Error finding put option: {e}")
            return None
            
    async def _execute_exit_trade(self, bot_id: int, line, current_price: float):
        """Execute exit trade based on trend strategy"""
        try:
            bot_state = self.active_bots[bot_id]
            trend_strategy = bot_state.get('trend_strategy', 'uptrend')
            
            if trend_strategy == 'uptrend':
                # UPTREND: Sell stocks
                await self._execute_spot_exit_trade(bot_id, line, current_price)
            elif trend_strategy == 'downtrend':
                # DOWNTREND: Sell put options
                await self._execute_options_exit_trade(bot_id, line, current_price)
            else:
                logger.error(f"Unknown trend strategy: {trend_strategy}")
                
        except Exception as e:
            logger.error(f"Error executing exit trade for bot {bot_id}: {e}")
            
    async def _execute_spot_exit_trade(self, bot_id: int, line, current_price: float):
        """Execute spot/equity exit trade (uptrend strategy) - split position across exit lines"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if bot_state['open_shares'] <= 0:
                return
            
            # Calculate how many shares to sell at this exit line
            # Split position equally across all ORIGINAL exit lines
            total_exit_lines = bot_state['original_exit_lines_count']
            shares_to_sell = bot_state['open_shares'] // total_exit_lines
            
            # For the last exit line, sell any remaining shares
            if line['id'] == bot_state['exit_lines'][-1]['id']:
                shares_to_sell = bot_state['open_shares']
            
            if shares_to_sell <= 0:
                return
                
            # Place limit sell order for stocks
            from app.utils.ib_client import ib_client
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"Could not qualify {bot_state['symbol']}")
                return
            
            # Get contract specs to round price to minimum tick
            specs = ib_client.get_specs(bot_state['symbol'])
            min_tick = specs.get('min_tick', 0.01) if specs else 0.01
            
            # Round price to minimum tick to avoid Error 110
            def round_to_tick(price: float, tick: float) -> float:
                return round(round(price / tick) * tick, 6)
            
            # Use exit line price if available, otherwise use current_price
            exit_price = line.get('price', current_price)
            exit_price_rounded = round_to_tick(exit_price, min_tick)
                
            # Import LimitOrder
            from ib_async import LimitOrder
            
            # Place limit sell order at rounded price
            order = LimitOrder("SELL", shares_to_sell, exit_price_rounded)
            trade = await ib_client.place_order(contract, order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: LIMIT SELL ORDER PLACED - Order ID: {trade.order.orderId} at ${exit_price_rounded:.6f} (rounded from ${exit_price:.6f})")
                
                # Store exit order information for monitoring
                exit_order_key = f"exit_order_{line['id']}"
                bot_state[exit_order_key] = {
                    'order_id': trade.order.orderId,
                    'status': 'PENDING',
                    'price': exit_price_rounded,  # Store rounded price (actual order price)
                    'quantity': shares_to_sell,
                    'last_update': time.time(),
                    'line_id': line['id']
                }
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    f'{exit_order_key}_id': trade.order.orderId,
                    f'{exit_order_key}_status': 'PENDING'
                })
                
                # Log event
                await self._log_bot_event(bot_id, 'spot_exit_limit_order', {
                    'line_price': exit_price_rounded,  # Use rounded price (actual order price)
                    'current_price': current_price,
                    'shares_to_sell': shares_to_sell,
                    'order_id': trade.order.orderId,
                    'strategy': 'uptrend_spot_limit'
                })
                
                logger.info(f"✅ Bot {bot_id}: Exit limit order placed successfully")
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place exit limit order")
            
        except Exception as e:
            logger.error(f"Error executing spot exit trade for bot {bot_id}: {e}")
            
    async def _execute_options_exit_trade(self, bot_id: int, line, current_price: float):
        """Execute options exit trade (downtrend strategy)"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if bot_state['open_shares'] <= 0:
                return
                
            # Use the stored option contract
            contract = bot_state.get('option_contract')
            if not contract:
                logger.error(f"No option contract found for bot {bot_id}")
                return
                
            # Place market sell order for put options
            order = MarketOrder("SELL", bot_state['open_shares'])
            trade = await ib_client.place_order(contract, order)
            
            # Update bot state
            bot_state['is_bought'] = False
            bot_state['shares_exited'] += bot_state['open_shares']
            bot_state['open_shares'] = 0
            bot_state['crossed_lines'] = set()  # Reset for next cycle
            
            # Clear option details
            bot_state['option_contract'] = None
            bot_state['option_strike'] = None
            bot_state['option_expiry'] = None
            bot_state['option_right'] = None
            
            # Update database
            await self._update_bot_in_db(bot_id, {
                'is_bought': False,
                'shares_exited': bot_state['shares_exited'],
                'open_shares': 0
            })
            
            # Log event
            await self._log_bot_event(bot_id, 'options_position_closed', {
                'line_price': line['price'],
                'current_price': current_price,
                'contracts': bot_state['shares_exited'],
                'strike': bot_state.get('option_strike'),
                'expiry': bot_state.get('option_expiry'),
                'order_id': trade.order.orderId if trade.order else None,
                'strategy': 'downtrend_options'
            })
            
            logger.info(f"🤖 Bot {bot_id} closed OPTIONS position: {bot_state['shares_exited']} PUT contracts at ${current_price}")
            
        except Exception as e:
            logger.error(f"Error executing options exit trade for bot {bot_id}: {e}")
            
    def _load_filled_exit_lines(self, bot):
        """Load filled exit lines from bot instance (from database or return empty set)"""
        try:
            # Try to get filled_exit_lines from bot instance
            filled_lines = getattr(bot, 'filled_exit_lines', None)
            if filled_lines:
                if isinstance(filled_lines, str):
                    # If stored as comma-separated string, convert to set
                    return set(filled_lines.split(',')) if filled_lines else set()
                elif isinstance(filled_lines, (list, set)):
                    return set(filled_lines)
            return set()
        except Exception as e:
            logger.debug(f"Could not load filled_exit_lines from bot: {e}")
            return set()
    
    async def _update_bot_in_db(self, bot_id: int, updates: dict):
        """Update bot in database"""
        async with AsyncSessionLocal() as session:
            try:
                # Filter out dynamic fields that don't exist as database columns
                valid_columns = {
                    'is_active', 'is_running', 'is_bought', 'current_price', 'entry_price',
                    'total_position', 'shares_entered', 'shares_exited', 'open_shares',
                    'position_size', 'max_position', 'entry_order_id', 'entry_order_status',
                    'stop_loss_order_id', 'stop_loss_price', 'hard_stop_triggered', 'status'
                    # 'filled_exit_lines'  # TODO: Uncomment after running database migration to add filled_exit_lines column
                }
                
                # Filter out invalid columns and log them
                filtered_updates = {}
                filtered_out = []
                for k, v in updates.items():
                    if k in valid_columns:
                        filtered_updates[k] = v
                    else:
                        filtered_out.append(k)
                
                if filtered_out:
                    logger.debug(f"🔄 Bot {bot_id}: Filtered out non-database columns: {filtered_out}")
                
                if not filtered_updates:
                    logger.debug(f"🔄 Bot {bot_id}: No valid columns to update after filtering")
                    return
                
                logger.info(f"🔄 Bot {bot_id}: Updating database with: {filtered_updates}")
                
                # Convert DECIMAL fields properly
                decimal_fields = {'current_price', 'entry_price', 'stop_loss_price'}
                for field in decimal_fields:
                    if field in filtered_updates and filtered_updates[field] is not None:
                        # Convert to float first, then Decimal will be handled by SQLAlchemy
                        filtered_updates[field] = float(filtered_updates[field])
                
                # Convert String fields (order IDs) to strings
                string_fields = {'entry_order_id', 'entry_order_status', 'stop_loss_order_id', 'status'}
                # 'filled_exit_lines'  # TODO: Add after running database migration
                for field in string_fields:
                    if field in filtered_updates and filtered_updates[field] is not None:
                        # Convert to string if it's not already
                        if not isinstance(filtered_updates[field], str):
                            filtered_updates[field] = str(filtered_updates[field])
                
                # Check if filled_exit_lines column exists in database (it might not if migration hasn't been run)
                # Try to query the column directly - if it doesn't exist, SQLAlchemy will raise an error
                # For now, we'll proactively remove it and handle the error in exception handler if it still occurs
                # Note: We can't reliably check if a column exists without a separate query, so we'll catch the error instead
                
                if not filtered_updates:
                    logger.debug(f"🔄 Bot {bot_id}: No valid columns to update after filtering")
                    return
                
                await session.execute(
                    update(BotInstance)
                    .where(BotInstance.id == bot_id)
                    .values(**filtered_updates, updated_at=datetime.now())
                )
                await session.commit()
                logger.info(f"✅ Bot {bot_id}: Database update committed successfully")
            except Exception as e:
                error_msg = str(e)
                # Check for "Unconsumed column" error and handle gracefully
                if 'Unconsumed column' in error_msg and 'filled_exit_lines' in error_msg:
                    logger.warning(f"⚠️ Bot {bot_id}: filled_exit_lines column doesn't exist in database yet, retrying update without it")
                    try:
                        # Reconstruct filtered_updates from original updates, excluding filled_exit_lines
                        valid_columns = {
                            'is_active', 'is_running', 'is_bought', 'current_price', 'entry_price',
                            'total_position', 'shares_entered', 'shares_exited', 'open_shares',
                            'position_size', 'max_position', 'entry_order_id', 'entry_order_status',
                            'stop_loss_order_id', 'stop_loss_price', 'hard_stop_triggered', 'status'
                        }
                        
                        # Filter updates again, excluding filled_exit_lines
                        retry_updates = {}
                        for k, v in updates.items():
                            if k in valid_columns:  # Exclude filled_exit_lines
                                retry_updates[k] = v
                        
                        # Convert types for retry
                        decimal_fields = {'current_price', 'entry_price', 'stop_loss_price'}
                        for field in decimal_fields:
                            if field in retry_updates and retry_updates[field] is not None:
                                retry_updates[field] = float(retry_updates[field])
                        
                        string_fields = {'entry_order_id', 'entry_order_status', 'stop_loss_order_id', 'status'}
                        for field in string_fields:
                            if field in retry_updates and retry_updates[field] is not None:
                                if not isinstance(retry_updates[field], str):
                                    retry_updates[field] = str(retry_updates[field])
                        
                        if retry_updates:  # Only retry if there are still updates to make
                            await session.execute(
                                update(BotInstance)
                                .where(BotInstance.id == bot_id)
                                .values(**retry_updates, updated_at=datetime.now())
                            )
                            await session.commit()
                            logger.info(f"✅ Bot {bot_id}: Database update committed successfully (without filled_exit_lines)")
                            return
                    except Exception as retry_error:
                        logger.error(f"❌ Error retrying update without filled_exit_lines: {retry_error}", exc_info=True)
                logger.error(f"❌ Error updating bot {bot_id} in database: {e}", exc_info=True)
                logger.error(f"❌ Attempted updates: {updates}")
                # Don't raise - just log the error so the bot continues running
                
    async def _log_bot_event(self, bot_id: int, event_type: str, event_data: dict):
        """Log bot event to database"""
        async with AsyncSessionLocal() as session:
            try:
                event = BotEvent(
                    bot_id=bot_id,
                    event_type=event_type,
                    event_data=event_data
                )
                session.add(event)
                await session.commit()
            except Exception as e:
                logger.error(f"Error logging bot event: {e}")
                
    async def load_active_bots(self):
        """Load all active bots from database, but only if their configurations still exist"""
        async with AsyncSessionLocal() as session:
            try:
                # Import here to avoid circular imports
                from app.db.models import UserChart
                
                result = await session.execute(
                    select(BotInstance)
                    .options(selectinload(BotInstance.lines))
                    .where(BotInstance.is_active == True)
                )
                bots = result.scalars().all()
                
                loaded_count = 0
                for bot in bots:
                    # Check if the configuration still exists
                    config_result = await session.execute(
                        select(UserChart).where(UserChart.id == bot.config_id)
                    )
                    config = config_result.scalar_one_or_none()
                    
                    if config:
                        # Configuration exists, load the bot
                        await self._load_bot_state(bot.id)
                        loaded_count += 1
                    else:
                        # Configuration was deleted, deactivate the bot
                        logger.info(f"🤖 Configuration {bot.config_id} not found, deactivating bot {bot.id}")
                        await self._deactivate_orphaned_bot(bot.id)
                    
                logger.info(f"🤖 Loaded {loaded_count} active bots (deactivated {len(bots) - loaded_count} orphaned bots)")
                
            except Exception as e:
                logger.error(f"Error loading active bots: {e}")
                
    async def _deactivate_orphaned_bot(self, bot_id: int):
        """Deactivate a bot whose configuration was deleted"""
        async with AsyncSessionLocal() as session:
            try:
                # Update bot status in database
                await session.execute(
                    update(BotInstance)
                    .where(BotInstance.id == bot_id)
                    .values(is_active=False, is_running=False, updated_at=datetime.now())
                )
                await session.commit()
                
                # Remove from memory if it exists
                if bot_id in self.active_bots:
                    del self.active_bots[bot_id]
                    
                logger.info(f"🤖 Deactivated orphaned bot {bot_id}")
                
            except Exception as e:
                logger.error(f"Error deactivating orphaned bot {bot_id}: {e}")
                
    async def _price_monitoring_loop(self):
        """Background loop to monitor prices"""
        cycle_count = 0
        while self._running:
            try:
                cycle_count += 1
                self._price_monitoring_cycle = cycle_count
                logger.info(f"🔍 Price monitoring loop: {len(self.active_bots)} active bots (cycle {cycle_count})")
                for bot_id, bot_state in self.active_bots.items():
                    logger.info(f"🔍 Bot {bot_id}: is_running={bot_state['is_running']}, symbol={bot_state['symbol']}")
                    if bot_state['is_running']:
                        logger.info(f"📊 Getting price for bot {bot_id} ({bot_state['symbol']})")
                        # Get current price using direct IBKR connection
                        price = await self._get_current_price(bot_state['symbol'])
                        
                        # Also get candle data for analysis (every 5 cycles to avoid too many API calls)
                        cycle_count = getattr(self, '_price_monitoring_cycle', 0)
                        if cycle_count % 5 == 0:  # Every 5 cycles
                            await self._get_candle_data(bot_state['symbol'], "1 D", "1 min", True)
                        
                        if price > 0:
                            # Update bot price first (this checks soft/hard stops and updates state)
                            await self.update_bot_price(bot_id, price)
                            # Then show detailed price information including entry/exit lines (with updated state)
                            await self._log_detailed_price_info(bot_id, price, bot_state)
                        else:
                            logger.warning(f"❌ Bot {bot_id}: Invalid price for {bot_state['symbol']}: {price}")
                                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                logger.error(f"Error in price monitoring loop: {e}")
                await asyncio.sleep(10)
                
    async def _bot_status_update_loop(self):
        """Background loop to update bot status"""
        while self._running:
            try:
                # Update bot statuses in database
                for bot_id, bot_state in self.active_bots.items():
                    # Ensure open_shares is calculated correctly
                    shares_entered = bot_state.get('shares_entered', 0)
                    shares_exited = bot_state.get('shares_exited', 0)
                    open_shares = max(0, shares_entered - shares_exited)
                    
                    # Sync the calculated value back to bot_state if it's wrong
                    if bot_state.get('open_shares', 0) != open_shares:
                        bot_state['open_shares'] = open_shares
                    
                    await self._update_bot_in_db(bot_id, {
                        'current_price': bot_state['current_price'],
                        'is_bought': bot_state['is_bought'],
                        'open_shares': open_shares,
                        'shares_entered': shares_entered,
                        'shares_exited': shares_exited
                    })
                    
                await asyncio.sleep(30)  # Update every 30 seconds
                
            except Exception as e:
                logger.error(f"Error in status update loop: {e}")
                await asyncio.sleep(60)
    
    async def _get_current_price(self, symbol: str) -> float:
        """Get current price using delayed historical data (no real-time subscription required)"""
        # Get or create lock for this symbol to prevent concurrent requests
        if symbol not in self._price_request_locks:
            self._price_request_locks[symbol] = asyncio.Lock()
        
        lock = self._price_request_locks[symbol]
        
        async with lock:
            try:
                # First try Redis/IBKR bridge (works with delayed data and Docker feed)
                try:
                    price = await asyncio.wait_for(ib_interface.retrieve_quote(symbol), timeout=3.0)
                    if price and price > 0:
                        logger.info(f"✅ Using Redis quote for {symbol}: ${price:.2f}")
                        return float(price)
                except asyncio.TimeoutError:
                    logger.debug(f"⏰ Redis quote timeout for {symbol}")
                except Exception as e:
                    logger.debug(f"⚠️ Redis quote error for {symbol}: {e}")

                # Fall back to historical bars (IBKR provides delayed data without real-time subscription)
                # Try multiple durations to ensure we get recent data
                durations = ["1 D", "2 D", "1 W"]  # Try longer durations if shorter ones fail
                bar_sizes = ["1 min", "5 mins"]  # Try different bar sizes
                
                for duration in durations:
                    for bar_size in bar_sizes:
                        try:
                            logger.info(f"📊 Requesting historical bars for {symbol}: duration={duration}, barSize={bar_size}")
                            
                            # Add timeout to prevent hanging (IBKR sometimes doesn't respond)
                            bars = await asyncio.wait_for(
                                ib_client.history_bars(symbol, duration=duration, barSize=bar_size, rth=True),
                                timeout=15.0
                            )
                            
                            if bars and len(bars) > 0:
                                # Get the most recent bar
                                latest_bar = bars[-1]
                                bar_price = (
                                    getattr(latest_bar, "close", None) or 
                                    getattr(latest_bar, "average", None) or 
                                    getattr(latest_bar, "open", None) or
                                    getattr(latest_bar, "high", None)
                                )
                                
                                if bar_price and bar_price > 0:
                                    # Calculate how old the data is (for logging)
                                    bar_time = getattr(latest_bar, "date", None)
                                    logger.info(f"✅ Using latest historical bar for {symbol}: close=${bar_price:.2f}, duration={duration}, barSize={bar_size}, bars={len(bars)}, bar_time={bar_time}")
                                    return float(bar_price)
                                
                                logger.warning(f"⚠️ Historical bar for {symbol} missing usable price: {latest_bar}")
                            else:
                                logger.warning(f"⚠️ No bars returned for {symbol} with duration={duration}, barSize={bar_size}")
                                
                        except asyncio.TimeoutError:
                            logger.warning(f"⏰ Historical bars request timeout for {symbol} (duration={duration}, barSize={bar_size})")
                            continue
                        except Exception as e:
                            logger.warning(f"⚠️ Historical bars error for {symbol} (duration={duration}, barSize={bar_size}): {e}")
                            # Wait a bit before retrying to avoid overwhelming IBKR
                            await asyncio.sleep(0.5)
                            continue

                logger.error(f"❌ All price retrieval methods failed for {symbol}")
                return -1.0
                    
            except Exception as e:
                logger.error(f"❌ Error getting price for {symbol}: {e}", exc_info=True)
                return -1.0
    
    async def _get_candle_data(self, symbol: str, duration: str = "1 D", bar_size: str = "1 min", rth: bool = True) -> list:
        """Get recent candle/bar data for analysis"""
        # Use same lock to prevent concurrent requests
        if symbol not in self._price_request_locks:
            self._price_request_locks[symbol] = asyncio.Lock()
        
        lock = self._price_request_locks[symbol]
        
        async with lock:
            try:
                logger.info(f"📊 Getting candle data for {symbol}: {duration}, {bar_size}")
                
                # Add timeout to prevent hanging
                bars = await asyncio.wait_for(
                    ib_client.history_bars(symbol, duration, bar_size, rth),
                    timeout=15.0
                )
                
                if bars:
                    logger.info(f"✅ Got {len(bars)} bars for {symbol}")
                    # Log the most recent bar
                    latest_bar = bars[-1] if bars else None
                    if latest_bar:
                        logger.info(f"📊 Latest bar: O={latest_bar.open:.2f}, H={latest_bar.high:.2f}, L={latest_bar.low:.2f}, C={latest_bar.close:.2f}, V={latest_bar.volume}")
                    return bars
                else:
                    logger.warning(f"No candle data received for {symbol}")
                    return []
                    
            except asyncio.TimeoutError:
                logger.warning(f"⏰ Candle data request timeout for {symbol}")
                return []
            except Exception as e:
                logger.error(f"Error getting candle data for {symbol}: {e}")
                return []
    
    async def _log_detailed_price_info(self, bot_id: int, current_price: float, bot_state: dict):
        """Log detailed price information including entry/exit lines"""
        try:
            symbol = bot_state['symbol']
            trend_strategy = bot_state.get('trend_strategy', 'uptrend')
            is_bought = bot_state.get('is_bought', False)
            
            # Get entry and exit lines and recalculate their current prices
            entry_lines = bot_state.get('entry_lines', [])
            exit_lines = bot_state.get('exit_lines', [])
            
            # Recalculate trend line prices for current time
            updated_entry_lines = []
            for line in entry_lines:
                if 'points' in line:
                    current_line_price = self._calculate_trend_line_price(line['points'])
                    updated_line = line.copy()
                    updated_line['price'] = current_line_price
                    updated_entry_lines.append(updated_line)
                else:
                    updated_entry_lines.append(line)
            
            updated_exit_lines = []
            for line in exit_lines:
                if 'points' in line:
                    current_line_price = self._calculate_trend_line_price(line['points'])
                    updated_line = line.copy()
                    updated_line['price'] = current_line_price
                    updated_exit_lines.append(updated_line)
                else:
                    updated_exit_lines.append(line)
            
            # Update bot state with recalculated prices
            bot_state['entry_lines'] = updated_entry_lines
            bot_state['exit_lines'] = updated_exit_lines
            
            # Create detailed price summary
            price_info = f"🤖 Bot {bot_id} ({symbol}) - Strategy: {trend_strategy.upper()}"
            price_info += f"\n💰 Current Price: ${current_price:.2f}"
            
            # Determine position status with more detail
            hard_stop_triggered = bot_state.get('hard_stop_triggered', False)
            
            if hard_stop_triggered:
                position_status = "HARD STOP"
            else:
                position_status = "WAITING"
            
            # Determine bot status (always available)
            if bot_state.get('hard_stop_triggered', False):
                bot_status = "HARD_STOPPED_OUT"
            elif bot_state.get('is_active', False) and bot_state.get('is_running', False):
                bot_status = "RUNNING"
            else:
                bot_status = "COMPLETED"
            
            if is_bought:
                open_shares = bot_state.get('open_shares', 0)
                shares_entered = bot_state.get('shares_entered', 0)
                shares_exited = bot_state.get('shares_exited', 0)
                position_size = bot_state.get('position_size', 0)
                
                # Priority 1: Check if fully sold first
                if open_shares <= 0:
                    position_status = "SOLD_100%"
                elif shares_exited > 0:
                    # Calculate percentage based on exit lines, not raw shares
                    total_exit_lines = bot_state.get('original_exit_lines_count', len(bot_state.get('exit_lines', [])))
                    if total_exit_lines > 0:
                        # Calculate how many exit lines have been hit
                        shares_per_exit_line = shares_entered // total_exit_lines if total_exit_lines > 0 else 0
                        exit_lines_hit = shares_exited // shares_per_exit_line if shares_per_exit_line > 0 else 0
                        
                        # Calculate actual percentage based on shares sold
                        if shares_exited >= shares_entered:
                            position_status = "SOLD_100%"
                        elif shares_exited > 0:
                            # Calculate percentage and round to nearest 25%
                            percentage = (shares_exited / shares_entered) * 100
                            if percentage >= 87.5:
                                position_status = "SOLD_100%"
                            elif percentage >= 62.5:
                                position_status = "SOLD_75%"
                            elif percentage >= 37.5:
                                position_status = "SOLD_50%"
                            elif percentage >= 12.5:
                                position_status = "SOLD_25%"
                            else:
                                position_status = "SOLD_25%"  # Minimum for any partial fill
                        else:
                            position_status = "BOUGHT"
                    else:
                        position_status = "BOUGHT"
                    
                    # Debug logging for percentage calculation
                    logger.debug(f"🔍 Bot {bot_id}: Position calculation - shares_entered={shares_entered}, shares_exited={shares_exited}, open_shares={open_shares}, total_exit_lines={total_exit_lines}, exit_lines_hit={exit_lines_hit}, bot_status={bot_status}")
                # Priority 3: Check if multi-buy mode and partially filled (before checking for full BOUGHT)
                elif bot_state.get('multi_buy') == 'enabled' and shares_entered > 0 and position_size > 0 and shares_exited == 0:
                    buy_percentage = (shares_entered / position_size) * 100
                    # If we have partial position (not 100% bought yet)
                    if buy_percentage < 100:
                        if buy_percentage >= 87.5:
                            position_status = "BUY_100%"
                        elif buy_percentage >= 62.5:
                            position_status = "BUY_75%"
                        elif buy_percentage >= 37.5:
                            position_status = "BUY_50%"
                        elif buy_percentage >= 12.5:
                            position_status = "BUY_25%"
                        else:
                            position_status = "BUY_25%"  # Minimum for any partial fill
                    else:
                        position_status = "BOUGHT"
                else:
                    position_status = "BOUGHT"
            else:
                position_status = "WAITING"
            
            price_info += f" | Position: {position_status} | Status: {bot_status}"
            
            if updated_entry_lines:
                entry_prices = [f"${float(line['price']):.2f}" for line in updated_entry_lines if line.get('is_active', True)]
                price_info += f"\n📈 Entry Lines: {', '.join(entry_prices)}"
            else:
                price_info += f"\n📈 Entry Lines: None configured"
                
            if updated_exit_lines:
                # Filter out crossed exit lines
                active_exit_lines = [line for line in updated_exit_lines if line.get('is_active', True) and line['id'] not in bot_state.get('crossed_lines', set())]
                exit_prices = [f"${float(line['price']):.2f}" for line in active_exit_lines]
                price_info += f"\n📉 Exit Lines: {', '.join(exit_prices)}"
            else:
                price_info += f"\n📉 Exit Lines: None configured"
            
            # Show distance to nearest lines
            if updated_entry_lines and not is_bought:
                active_entries = [float(line['price']) for line in updated_entry_lines if line.get('is_active', True)]
                if active_entries:
                    nearest_entry = min(active_entries, key=lambda x: abs(x - current_price))
                    distance = current_price - nearest_entry
                    direction = "ABOVE" if distance > 0 else "BELOW"
                    price_info += f"\n🎯 Nearest Entry: ${nearest_entry:.2f} ({abs(distance):.2f} {direction})"
            
            if updated_exit_lines and is_bought:
                # Filter out crossed exit lines for nearest calculation
                active_exit_lines = [line for line in updated_exit_lines if line.get('is_active', True) and line['id'] not in bot_state.get('crossed_lines', set())]
                active_exits = [float(line['price']) for line in active_exit_lines]
                if active_exits:
                    nearest_exit = min(active_exits, key=lambda x: abs(x - current_price))
                    distance = current_price - nearest_exit
                    direction = "ABOVE" if distance > 0 else "BELOW"
                    price_info += f"\n🎯 Nearest Exit: ${nearest_exit:.2f} ({abs(distance):.2f} {direction})"
            
            # Show hard stop-out information if bot has position
            if is_bought:
                entry_price = bot_state.get('entry_price', 0)
                hard_stop_out_pct = bot_state.get('bot_hard_stop_out', 0.0)
                # Also check hard_stop_pct as fallback
                if hard_stop_out_pct == 0.0:
                    hard_stop_out_pct = bot_state.get('hard_stop_pct', 0.0)
                
                if entry_price > 0:
                    # Convert entry_price to float to avoid Decimal type errors
                    entry_price = float(entry_price)
                    if hard_stop_out_pct > 0:
                        stop_out_price = entry_price * (1 - hard_stop_out_pct / 100)
                        distance_to_stop = current_price - stop_out_price
                        direction_to_stop = "ABOVE" if distance_to_stop > 0 else "BELOW"
                        price_info += f"\n🛑 Hard Stop-Out: ${stop_out_price:.2f} ({abs(distance_to_stop):.2f} {direction_to_stop}) [{hard_stop_out_pct}%]"
                    else:
                        price_info += f"\n🛑 Hard Stop-Out: Not configured (hard_stop_pct={hard_stop_out_pct}, entry_price=${entry_price:.2f})"
                else:
                    price_info += f"\n🛑 Hard Stop-Out: Cannot calculate (entry_price not set)"
            
            # Show soft stop timer information if bot has position
            if is_bought:
                entry_price = bot_state.get('entry_price', 0)
                soft_stop_pct = bot_state.get('soft_stop_pct', 0.0)
                soft_stop_minutes = bot_state.get('soft_stop_minutes', 5)
                soft_stop_timer_active = bot_state.get('soft_stop_timer_active', False)
                soft_stop_timer_start = bot_state.get('soft_stop_timer_start', None)
                
                if entry_price > 0:
                    # Convert entry_price to float to avoid Decimal type errors
                    entry_price = float(entry_price)
                    
                    if soft_stop_pct > 0:
                        soft_stop_price = entry_price * (1 - soft_stop_pct / 100)
                        distance_to_soft_stop = current_price - soft_stop_price
                        direction_to_soft_stop = "ABOVE" if distance_to_soft_stop > 0 else "BELOW"
                        
                        # Check if price is below soft stop
                        if current_price <= soft_stop_price:
                            # Price is below soft stop - show timer status
                            if soft_stop_timer_active and soft_stop_timer_start:
                                elapsed_seconds = time.time() - soft_stop_timer_start
                                elapsed_minutes = elapsed_seconds / 60
                                remaining_seconds = max(0, (soft_stop_minutes * 60) - elapsed_seconds)
                                remaining_minutes = int(remaining_seconds // 60)
                                remaining_secs = int(remaining_seconds % 60)
                                
                                if remaining_seconds > 0:
                                    price_info += f"\n⏱️ Soft Stop Timer: ${soft_stop_price:.2f} ({abs(distance_to_soft_stop):.2f} {direction_to_soft_stop}) [{soft_stop_pct}%] - ACTIVE: {remaining_minutes}m {remaining_secs}s remaining (expires in {elapsed_minutes:.1f}/{soft_stop_minutes}min)"
                                else:
                                    price_info += f"\n⏱️ Soft Stop Timer: ${soft_stop_price:.2f} ({abs(distance_to_soft_stop):.2f} {direction_to_soft_stop}) [{soft_stop_pct}%] - EXPIRED (selling...)"
                            else:
                                # Timer should start immediately, but if it's not active yet, show starting
                                price_info += f"\n⏱️ Soft Stop Timer: ${soft_stop_price:.2f} ({abs(distance_to_soft_stop):.2f} {direction_to_soft_stop}) [{soft_stop_pct}%] - STARTING ({soft_stop_minutes}min timer)"
                        else:
                            # Price is above soft stop - show inactive status
                            if soft_stop_timer_active:
                                # Timer was active but price recovered - should be reset by check
                                price_info += f"\n⏱️ Soft Stop Timer: ${soft_stop_price:.2f} ({abs(distance_to_soft_stop):.2f} {direction_to_soft_stop}) [{soft_stop_pct}%] - RESET (price recovered above stop)"
                            else:
                                price_info += f"\n⏱️ Soft Stop Timer: ${soft_stop_price:.2f} ({abs(distance_to_soft_stop):.2f} {direction_to_soft_stop}) [{soft_stop_pct}%] - INACTIVE (price above stop)"
                    else:
                        price_info += f"\n⏱️ Soft Stop Timer: Not configured (soft_stop_pct={soft_stop_pct}, entry_price=${entry_price:.2f})"
                else:
                    price_info += f"\n⏱️ Soft Stop Timer: Cannot calculate (entry_price not set)"
            
            # Show open limit orders
            price_info = await self._log_open_orders(bot_id, bot_state, price_info)
            
            logger.info(price_info)
            
        except Exception as e:
            logger.error(f"Error logging detailed price info for bot {bot_id}: {e}")
    
    async def _log_open_orders(self, bot_id: int, bot_state: dict, price_info: str) -> str:
        """Log information about open limit orders and return updated price_info string"""
        try:
            open_orders = []
            
            # Check entry order (only if it's a valid pending order)
            if ('entry_order_id' in bot_state and 
                bot_state.get('entry_order_id') and 
                bot_state.get('entry_order_status') == 'PENDING'):
                entry_order_info = {
                    'type': 'ENTRY',
                    'order_id': bot_state['entry_order_id'],
                    'price': bot_state.get('entry_order_price', 0),
                    'quantity': bot_state.get('entry_order_quantity', 0),
                    'status': bot_state.get('entry_order_status', 'UNKNOWN')
                }
                open_orders.append(entry_order_info)
            
            # Check exit orders (only if they're valid pending orders)
            for key, value in bot_state.items():
                if (key.startswith('exit_order_') and 
                    isinstance(value, dict) and 
                    value.get('status') == 'PENDING' and
                    value.get('order_id')):  # Ensure order_id is not None/empty
                    exit_order_info = {
                        'type': 'EXIT',
                        'order_id': value.get('order_id'),
                        'price': value.get('price', 0),
                        'quantity': value.get('quantity', 0),
                        'status': value.get('status', 'UNKNOWN'),
                        'line_id': value.get('line_id', 'UNKNOWN')
                    }
                    open_orders.append(exit_order_info)
            
            # Check stop-loss order
            if 'stop_loss_order_id' in bot_state and bot_state.get('stop_loss_order_id'):
                stop_loss_info = {
                    'type': 'STOP_LOSS',
                    'order_id': bot_state['stop_loss_order_id'],
                    'price': bot_state.get('stop_loss_price', 0),
                    'quantity': bot_state.get('stop_loss_quantity', 0),
                    'status': 'ACTIVE'
                }
                open_orders.append(stop_loss_info)
            
            # Add open orders information to price_info
            if open_orders:
                price_info += f"\n📋 Open Orders ({len(open_orders)}):"
                for order in open_orders:
                    order_type_emoji = {
                        'ENTRY': '🟢',
                        'EXIT': '🔴', 
                        'STOP_LOSS': '🛡️'
                    }.get(order['type'], '📋')
                    
                    if order['type'] == 'EXIT':
                        price_info += f"\n  {order_type_emoji} {order['type']}: ${order['price']:.2f} x {order['quantity']} shares (ID: {order['order_id']}, Line: {order['line_id']})"
                    else:
                        price_info += f"\n  {order_type_emoji} {order['type']}: ${order['price']:.2f} x {order['quantity']} shares (ID: {order['order_id']})"
            else:
                price_info += f"\n📋 Open Orders: None"
            
            return price_info
                
        except Exception as e:
            logger.error(f"Error logging open orders for bot {bot_id}: {e}")
            return price_info
    
    async def delete_bot_instance(self, bot_id: int):
        """Delete a bot instance and clean up all associated data"""
        try:
            # Stop the bot if it's running
            if bot_id in self.active_bots:
                await self.stop_bot(bot_id)
            
            # Remove from memory
            if bot_id in self.active_bots:
                del self.active_bots[bot_id]
            
            logger.info(f"🤖 Deleted bot instance {bot_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting bot instance {bot_id}: {e}")
            return False
    
    def _calculate_trend_line_price(self, points):
        """Calculate current price based on trend line slope and intercept"""
        try:
            if len(points) < 2:
                return 0.0
            
            # Extract time and price from points
            times = [point['time'] for point in points]
            prices = [point['price'] for point in points]
            
            logger.info(f"Trend line points: times={times}, prices={prices}")
            
            # Determine time format: TradingView uses milliseconds, but frontend might convert to seconds
            # Check if times are in milliseconds (typically > 1e12) or seconds (typically < 1e10)
            # If times are in seconds, convert to milliseconds to match TradingView's internal format
            if times and times[0] < 1e10:  # Times are in seconds (e.g., 1763135400)
                # Convert to milliseconds to match TradingView format
                times = [t * 1000 for t in times]
                current_time = int(time.time() * 1000)  # Current time in milliseconds
                logger.info(f"Converted times from seconds to milliseconds: {times}, current_time={current_time}")
            else:
                # Times are already in milliseconds
                current_time = int(time.time() * 1000)  # Current time in milliseconds
            
            # Calculate slope and intercept using linear regression
            # y = mx + b where y=price, x=time, m=slope, b=intercept
            n = len(times)
            sum_x = sum(times)
            sum_y = sum(prices)
            sum_xy = sum(times[i] * prices[i] for i in range(n))
            sum_x2 = sum(t * t for t in times)
            
            # Calculate slope (m) and intercept (b)
            if n * sum_x2 - sum_x * sum_x == 0:
                # Avoid division by zero - return average price
                return sum_y / n
            
            slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
            intercept = (sum_y - slope * sum_x) / n
            
            # Calculate current price: price = slope * current_time + intercept
            current_price = slope * current_time + intercept
            
            logger.info(f"Trend line calculation: current_time={current_time}, slope={slope:.8f}, intercept={intercept:.2f}, current_price={current_price:.2f}")
            
            return current_price
            
        except Exception as e:
            logger.error(f"Error calculating trend line price: {e}")
            # Fallback to average price
            prices = [point['price'] for point in points]
            return sum(prices) / len(prices)
    
    async def _execute_multi_buy_entry_trade(self, bot_id: int, line, current_price: float):
        """Execute multi-buy order when price crosses one of the 2 entry lines (50/50 split)"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if len(bot_state.get('entry_lines', [])) < 2:
                logger.error(f"Bot {bot_id}: Multi-buy enabled but less than 2 entry lines found")
                return
            
            entry_lines = bot_state['entry_lines']
            # In multi-buy mode, entry_lines[0] is the first (lower) entry line
            # and entry_lines[1] is the second (higher) entry line
            first_line = entry_lines[0]   # Lower entry line (1st buy line)
            second_line = entry_lines[1]  # Higher entry line (2nd buy line)
            
            # trade_amount is the total number of shares to buy across the 2 entry lines
            trade_amount = bot_state.get('trade_amount', bot_state.get('position_size', 100))
            total_shares = int(trade_amount)
            if total_shares < 1:
                total_shares = 1  # Minimum 1 share
            
            # Split shares 50/50 between the 2 entry lines
            shares_per_line = total_shares // 2
            shares_at_first = shares_per_line
            shares_at_second = total_shares - shares_at_first  # Second line gets remainder to ensure total is correct
            
            logger.info(f"🤖 Bot {bot_id}: Multi-buy mode - trade_amount={trade_amount} shares total, splitting 50/50: 1st line={shares_at_first}, 2nd line={shares_at_second}")
            
            # Initialize multi_buy_tracker if not exists
            if 'multi_buy_tracker' not in bot_state:
                bot_state['multi_buy_tracker'] = {
                    'first_filled': False,
                    'second_filled': False,
                    'total_shares_bought': 0
                }
            
            tracker = bot_state['multi_buy_tracker']
            shares_to_buy = 0
            
            # Check which entry line was crossed and place corresponding order
            if line['id'] == first_line['id'] and not tracker['first_filled']:
                # Price crossed 1st entry line (lower)
                shares_to_buy = shares_at_first
                tracker['first_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 1st entry line (lower) - buying {shares_to_buy} shares")
            elif line['id'] == second_line['id'] and not tracker['second_filled']:
                # Price crossed 2nd entry line (higher)
                shares_to_buy = shares_at_second
                tracker['second_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 2nd entry line (higher) - buying {shares_to_buy} shares")
            
            if shares_to_buy == 0:
                logger.info(f"🤖 Bot {bot_id}: Multi-buy order already placed for this crossing")
                return
            
            # Place market order for this specific allocation
            from ib_async import MarketOrder
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"Could not qualify {bot_state['symbol']}")
                return
            
            order = MarketOrder("BUY", shares_to_buy)
            trade = await ib_client.place_order(contract, order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: Multi-buy market order placed - {shares_to_buy} shares (Order ID: {trade.order.orderId})")
                tracker['total_shares_bought'] += shares_to_buy
                
                # Update bot state
                bot_state['shares_entered'] = tracker['total_shares_bought']
                bot_state['open_shares'] = tracker['total_shares_bought']
                
                # Determine which line was crossed for logging
                line_identifier = "1st entry line (lower)" if line['id'] == first_line['id'] else "2nd entry line (higher)"
                
                # Store entry order ID for this specific order first
                order_key = 'entry_order_id_1' if line['id'] == first_line['id'] else 'entry_order_id_2'
                bot_state[order_key] = trade.order.orderId
                
                # Collect all entry order IDs (including the one we just stored)
                entry_order_1 = bot_state.get('entry_order_id_1')
                entry_order_2 = bot_state.get('entry_order_id_2')
                all_order_ids_list = []
                if entry_order_1:
                    all_order_ids_list.append(str(entry_order_1))
                if entry_order_2:
                    all_order_ids_list.append(str(entry_order_2))
                
                # Log entry order event for this buy order
                await self._log_bot_event(bot_id, 'spot_entry_market_order', {
                    'line_price': line.get('price', current_price),
                    'current_price': current_price,
                    'shares_bought': shares_to_buy,
                    'order_id': trade.order.orderId,
                    'order_status': 'FILLED',
                    'line_identifier': line_identifier,
                    'total_shares_bought': tracker['total_shares_bought'],
                    'all_entry_order_ids': ','.join(all_order_ids_list),  # Include all order IDs
                    'order_sequence': '1' if line['id'] == first_line['id'] else '2',  # Show which order (1st or 2nd)
                    'strategy': 'uptrend_spot_market',
                    'multi_buy': True
                })
                
                # If this is the first order, mark as bought
                if tracker['total_shares_bought'] > 0:
                    bot_state['is_bought'] = True
                    if bot_state['entry_price'] == 0:
                        bot_state['entry_price'] = current_price
                
                # Store entry_order_id (use the latest order ID for backward compatibility)
                bot_state['entry_order_id'] = trade.order.orderId
                
                # Update database with entry order ID
                # Store the latest order ID in entry_order_id for backward compatibility
                # Individual order IDs are tracked in bot_state for internal use
                
                # Collect all entry order IDs for multi-buy mode
                all_entry_order_ids = []
                if bot_state.get('entry_order_id_1'):
                    all_entry_order_ids.append(str(bot_state['entry_order_id_1']))
                if bot_state.get('entry_order_id_2'):
                    all_entry_order_ids.append(str(bot_state['entry_order_id_2']))
                
                # Store as comma-separated list if multiple orders, or single ID if one order
                entry_order_ids_str = ','.join(all_entry_order_ids) if all_entry_order_ids else str(trade.order.orderId)
                
                db_update = {
                    'is_bought': bot_state['is_bought'],
                    'shares_entered': bot_state['shares_entered'],
                    'open_shares': bot_state['open_shares'],
                    'entry_order_status': 'FILLED',
                    'entry_order_id': entry_order_ids_str  # Store all order IDs (comma-separated)
                }
                
                await self._update_bot_in_db(bot_id, db_update)
                
                logger.info(f"✅ Bot {bot_id}: Entry order {trade.order.orderId} stored in database - {shares_to_buy} shares at ${current_price:.2f} (Total: {tracker['total_shares_bought']}, All Order IDs: {entry_order_ids_str})")
                
                # After first entry order is filled, create exit orders with partial shares
                if tracker['first_filled'] and not tracker['second_filled']:
                    logger.info(f"✅ Bot {bot_id}: First entry order filled ({shares_to_buy} shares), creating exit orders with partial shares")
                    # Create exit orders with current shares (will be 25/25 if total is 100)
                    await self._create_exit_orders_on_position_open(bot_id, current_price)
                
                # If both entry lines are filled, log position opened event and update exit orders
                if tracker['first_filled'] and tracker['second_filled']:
                    logger.info(f"✅ Bot {bot_id}: All multi-buy orders placed ({tracker['total_shares_bought']} shares)")
                    
                    # Log position opened event (only once when all orders are filled)
                    await self._log_bot_event(bot_id, 'spot_position_opened', {
                        'entry_price': bot_state['entry_price'],
                        'shares_bought': tracker['total_shares_bought'],
                        'order_id': trade.order.orderId,  # Last order ID
                        'strategy': 'uptrend_spot_market',
                        'multi_buy': True,
                        'total_orders': 2
                    })
                    
                    # Update exit orders to reflect full position (50/50 instead of 25/25)
                    logger.info(f"✅ Bot {bot_id}: Updating exit orders from partial to full position ({tracker['total_shares_bought']} shares)")
                    # Force resubmit to ensure old orders (25/25) are cancelled and new ones (50/50) are created
                    await self._create_exit_orders_on_position_open(bot_id, current_price, force_resubmit=True)
                    
                    # Place stop-loss order using actual shares bought
                    await self._place_stop_loss_order(bot_id, bot_state['entry_price'], tracker['total_shares_bought'])
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place multi-buy market order for {shares_to_buy} shares")
            
        except Exception as e:
            logger.error(f"Error executing multi-buy entry trade for bot {bot_id}: {e}")

# Global bot service instance
bot_service = BotService()
