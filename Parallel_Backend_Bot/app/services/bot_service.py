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
                                        # DOWNTREND OPTIONS: Downward lines = Entry, Upward lines = Exit
                                        if price_diff < 0:  # Downward trend = Entry line
                                            real_entry_lines.append({
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
                    'position_size': bot.position_size,
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
                    'option_right': None
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
                
                # Log event
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
            logger.info(f"🔄 Bot {bot_id}: Order {order_id} status: {order_status}")
            
            # Check if current price is above exit line (manual fill detection)
            exit_line_price = order_info.get('price', 0)
            logger.info(f"🎯 Bot {bot_id}: Manual fill check - Current: ${current_price:.2f}, Exit line: ${exit_line_price:.2f}, Order status: {order_status}")
            
            if current_price > exit_line_price and order_status in ['Unknown', 'Submitted', 'Pending']:
                logger.info(f"🎯 Bot {bot_id}: Current price ${current_price:.2f} > Exit line ${exit_line_price:.2f}, marking as filled (status was: {order_status})")
                order_status = 'Filled'
            
            if order_status == 'Filled':
                logger.info(f"✅ Bot {bot_id}: Exit order {order_id} FILLED!")
                
                # Update bot state
                shares_sold = order_info['quantity']
                bot_state['shares_exited'] += shares_sold
                bot_state['open_shares'] -= shares_sold
                order_info['status'] = 'FILLED'
                
                # Check if all shares are sold
                if bot_state['open_shares'] <= 0:
                    bot_state['is_bought'] = False
                    bot_state['crossed_lines'] = set()
                    logger.info(f"🎉 Bot {bot_id}: All shares sold! Completing bot...")
                    await self._complete_bot(bot_id)
                    return  # Exit early since bot is completed
                
                # Update database
                logger.info(f"🔄 Bot {bot_id}: Updating database - shares_exited={bot_state['shares_exited']}, open_shares={bot_state['open_shares']}")
                await self._update_bot_in_db(bot_id, {
                    'is_bought': bot_state['is_bought'],
                    'shares_exited': bot_state['shares_exited'],
                    'open_shares': bot_state['open_shares']
                })
                
                # Log event
                await self._log_bot_event(bot_id, 'spot_position_partial_exit', {
                    'shares_sold': shares_sold,
                    'remaining_shares': bot_state['open_shares'],
                    'total_exited': bot_state['shares_exited'],
                    'order_id': order_id,
                    'strategy': 'uptrend_spot_limit'
                })
                
                logger.info(f"🤖 Bot {bot_id}: Sold {shares_sold} shares, {bot_state['open_shares']} remaining")
                
                # Check if all shares are sold - if so, complete the bot
                if bot_state['open_shares'] <= 0:
                    logger.info(f"🎉 Bot {bot_id}: All shares sold! Completing bot...")
                    await self._complete_bot(bot_id)
                
            elif should_update_prices and order_status in ['Submitted', 'Unknown']:
                logger.info(f"🔄 Bot {bot_id}: Updating exit order {order_id} price from ${order_info['price']:.2f} to ${current_price:.2f}")
                # Update limit price to current market price
                await self._update_exit_order_price(bot_id, order_key, order_info, current_price)
            else:
                logger.debug(f"🔄 Bot {bot_id}: Not updating order {order_id} - should_update_prices={should_update_prices}, status={order_status}")
                
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
    
    async def _create_exit_orders_on_position_open(self, bot_id: int, current_price: float):
        """Create exit limit orders for all exit lines when position is opened"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if not bot_state.get('exit_lines'):
                logger.warning(f"Bot {bot_id}: No exit lines configured")
                return
            
            logger.info(f"🤖 Bot {bot_id}: Creating exit orders for {len(bot_state['exit_lines'])} exit lines")
            
            # Calculate shares per exit line
            total_shares = bot_state.get('shares_entered', 0)
            total_exit_lines = len(bot_state['exit_lines'])
            shares_per_exit = total_shares // total_exit_lines
            
            # Create exit orders for each exit line
            for i, exit_line in enumerate(bot_state['exit_lines']):
                # Calculate shares for this exit line
                if i == len(bot_state['exit_lines']) - 1:
                    # Last exit line gets any remaining shares
                    shares_to_sell = total_shares - (shares_per_exit * (total_exit_lines - 1))
                else:
                    shares_to_sell = shares_per_exit
                
                if shares_to_sell <= 0:
                    continue
                
                # Get current price for this exit line
                exit_line_price = self._calculate_trend_line_price(exit_line['points'])
                
                logger.info(f"🤖 Bot {bot_id}: Creating exit order for line {exit_line['id']} - {shares_to_sell} shares at ${exit_line_price:.2f}")
                
                # Place limit sell order
                contract = await ib_client.qualify_stock(bot_state['symbol'])
                if not contract:
                    logger.error(f"Could not qualify {bot_state['symbol']} for exit order")
                    continue
                
                from ib_async import LimitOrder
                order = LimitOrder("SELL", shares_to_sell, exit_line_price)
                trade = await ib_client.place_order(contract, order)
                
                if trade:
                    order_id = trade.order.orderId
                    logger.info(f"✅ Bot {bot_id}: Exit order {order_id} created for line {exit_line['id']}")

                    initial_status = await ib_client.await_order_submission(trade, timeout=6.0)
                    normalized_status = (initial_status or 'PENDING').strip().upper()

                    if normalized_status in {'CANCELLED', 'INACTIVE', 'APICANCELLED', 'REJECTED', 'ERROR'}:
                        logger.error(
                            f"❌ Bot {bot_id}: Exit order {order_id} rejected with status {normalized_status}"
                        )
                        await self._log_bot_event(bot_id, 'exit_order_rejected', {
                            'line_id': exit_line['id'],
                            'line_price': exit_line_price,
                            'shares_to_sell': shares_to_sell,
                            'order_id': order_id,
                            'status': normalized_status,
                        })
                        continue

                    if normalized_status == 'FILLED':
                        logger.info(
                            f"Bot {bot_id}: Exit order {order_id} filled immediately at ${exit_line_price:.2f}"
                        )
                        bot_state['shares_exited'] = bot_state.get('shares_exited', 0) + shares_to_sell
                        bot_state['open_shares'] = max(0, bot_state.get('open_shares', 0) - shares_to_sell)

                        fully_closed = bot_state['open_shares'] <= 0
                        if fully_closed:
                            bot_state['is_bought'] = False
                            bot_state['crossed_lines'] = set()

                        await self._update_bot_in_db(bot_id, {
                            'shares_exited': bot_state['shares_exited'],
                            'open_shares': bot_state['open_shares'],
                            'is_bought': bot_state.get('is_bought', False),
                        })

                        await self._log_bot_event(bot_id, 'spot_position_partial_exit', {
                            'line_id': exit_line['id'],
                            'line_price': exit_line_price,
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

                    exit_order_key = f"exit_order_{exit_line['id']}"
                    bot_state[exit_order_key] = {
                        'order_id': order_id,
                        'status': normalized_status,
                        'price': exit_line_price,
                        'quantity': shares_to_sell,
                        'last_update': time.time(),
                        'line_id': exit_line['id']
                    }
                    
                    await self._update_bot_in_db(bot_id, {
                        f'{exit_order_key}_id': order_id,
                        f'{exit_order_key}_status': normalized_status
                    })
                    
                    await self._log_bot_event(bot_id, 'exit_order_created', {
                        'line_id': exit_line['id'],
                        'line_price': exit_line_price,
                        'shares_to_sell': shares_to_sell,
                        'order_id': order_id,
                        'initial_status': normalized_status,
                        'strategy': 'uptrend_spot_limit'
                    })
                else:
                    logger.error(f"❌ Bot {bot_id}: Failed to create exit order for line {exit_line['id']}")
            
            logger.info(f"✅ Bot {bot_id}: Exit orders creation completed")
            
        except Exception as e:
            logger.error(f"Error creating exit orders for bot {bot_id}: {e}")
        
    async def _place_stop_loss_order(self, bot_id: int, entry_price: float, quantity: int):
        """Place stop-loss order when buy order is submitted"""
        try:
            bot_state = self.active_bots[bot_id]
            
            # Get hard stop-out percentage
            hard_stop_out_pct = float(bot_state.get('bot_hard_stop_out', 5.0))
            
            # Calculate stop-loss price (entry price - stop-out percentage)
            stop_loss_price = entry_price * (1 - hard_stop_out_pct / 100)
            
            logger.info(f"🛡️ Bot {bot_id}: Placing stop-loss order at ${stop_loss_price:.2f} ({hard_stop_out_pct}% below entry)")
            
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
                
                # Store stop-loss order information
                bot_state['stop_loss_order_id'] = trade.order.orderId
                bot_state['stop_loss_price'] = stop_loss_price
                bot_state['stop_loss_quantity'] = quantity
                bot_state['stop_loss_percentage'] = hard_stop_out_pct
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'stop_loss_order_id': trade.order.orderId,
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
            
            # Single buy mode: Place single market buy order
            order = MarketOrder("BUY", bot_state['position_size'])
            trade = await ib_client.place_order(contract, order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: MARKET BUY ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Track position accumulation
                shares_to_add = bot_state['position_size']
                
                if bot_state.get('multi_buy') == 'enabled' and len(bot_state.get('entry_lines', [])) >= 2:
                    # Multi-buy mode: Accumulate shares as we cross each entry line
                    if 'shares_entered' not in bot_state:
                        bot_state['shares_entered'] = 0
                        bot_state['open_shares'] = 0
                        bot_state['entry_price'] = 0
                    
                    # Add shares for this crossing
                    bot_state['shares_entered'] += shares_to_add
                    bot_state['open_shares'] += shares_to_add
                    
                    # Calculate average entry price
                    total_cost = (bot_state['entry_price'] * (bot_state['shares_entered'] - shares_to_add)) + (current_price * shares_to_add)
                    bot_state['entry_price'] = total_cost / bot_state['shares_entered'] if bot_state['shares_entered'] > 0 else current_price
                    
                    # Check if all entry lines are crossed (position complete)
                    total_entry_lines = len(bot_state.get('entry_lines', []))
                    crossed_entry_lines = sum(1 for entry_line in bot_state['entry_lines'] 
                                             if entry_line['id'] in bot_state['crossed_lines'])
                    
                    if crossed_entry_lines >= total_entry_lines:
                        bot_state['is_bought'] = True
                        logger.info(f"🤖 Bot {bot_id}: All entry lines crossed! Position complete: {bot_state['shares_entered']} shares @ ${bot_state['entry_price']:.2f}")
                        
                        # Place stop-loss order
                        await self._place_stop_loss_order(bot_id, current_price, bot_state['shares_entered'])
                        
                        # Create exit limit orders for all exit lines immediately
                        await self._create_exit_orders_on_position_open(bot_id, current_price)
                    else:
                        logger.info(f"🤖 Bot {bot_id}: Accumulating position: {bot_state['shares_entered']} shares so far (crossed {crossed_entry_lines}/{total_entry_lines} entry lines)")
                else:
                    # Single buy mode: Execute immediately
                    bot_state['is_bought'] = True
                    bot_state['entry_price'] = current_price
                    bot_state['shares_entered'] = bot_state['position_size']
                    bot_state['open_shares'] = bot_state['position_size']
                    
                    # Place stop-loss order
                    await self._place_stop_loss_order(bot_id, current_price, bot_state['position_size'])
                    
                    # Create exit limit orders for all exit lines immediately
                    await self._create_exit_orders_on_position_open(bot_id, current_price)
                
                bot_state['entry_order_id'] = trade.order.orderId
                bot_state['entry_order_status'] = 'FILLED'
                bot_state['entry_order_price'] = current_price
                bot_state['entry_order_quantity'] = bot_state['position_size']
                
                # Update database
                logger.info(f"🔄 Bot {bot_id}: Updating database with shares_entered={bot_state.get('shares_entered', bot_state['position_size'])}, open_shares={bot_state.get('open_shares', bot_state['position_size'])}")
                await self._update_bot_in_db(bot_id, {
                    'is_bought': bot_state.get('is_bought', False),
                    'entry_price': bot_state.get('entry_price', current_price),
                    'shares_entered': bot_state.get('shares_entered', bot_state['position_size']),
                    'open_shares': bot_state.get('open_shares', bot_state['position_size']),
                    'entry_order_id': trade.order.orderId,
                    'entry_order_status': 'FILLED'
                })
                logger.info(f"✅ Bot {bot_id}: Database updated successfully")
                
                logger.info(f"🤖 Bot {bot_id}: MARKET BUY EXECUTED - {shares_to_add} shares at ${current_price}")
                
                # Log event
                await self._log_bot_event(bot_id, 'spot_position_opened', {
                    'line_price': line['price'],
                    'current_price': current_price,
                    'shares_bought': shares_to_add,
                    'order_id': trade.order.orderId,
                    'strategy': 'uptrend_spot_market'
                })
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
            contract = await ib_client.qualify_stock(bot_state['symbol'])
            if not contract:
                logger.error(f"Could not qualify {bot_state['symbol']}")
                return
                
            # Import LimitOrder
            from ib_async import LimitOrder
            
            # Place limit sell order at current price
            order = LimitOrder("SELL", shares_to_sell, current_price)
            trade = await ib_client.place_order(contract, order)
            
            if trade:
                logger.info(f"✅ Bot {bot_id}: LIMIT SELL ORDER PLACED - Order ID: {trade.order.orderId}")
                
                # Store exit order information for monitoring
                exit_order_key = f"exit_order_{line['id']}"
                bot_state[exit_order_key] = {
                    'order_id': trade.order.orderId,
                    'status': 'PENDING',
                    'price': current_price,
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
                    'line_price': line['price'],
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
                }
                
                # Only include valid database columns
                filtered_updates = {k: v for k, v in updates.items() if k in valid_columns}
                
                logger.info(f"🔄 Bot {bot_id}: Updating database with: {filtered_updates}")
                await session.execute(
                    update(BotInstance)
                    .where(BotInstance.id == bot_id)
                    .values(**filtered_updates, updated_at=datetime.now())
                )
                await session.commit()
                logger.info(f"✅ Bot {bot_id}: Database update committed successfully")
            except Exception as e:
                logger.error(f"Error updating bot {bot_id} in database: {e}")
                
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
                            # Show detailed price information including entry/exit lines
                            await self._log_detailed_price_info(bot_id, price, bot_state)
                            await self.update_bot_price(bot_id, price)
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
        """Get current price using direct IBKR connection"""
        try:
            # First try Redis/IBKR bridge (works with delayed data and Docker feed)
            price = await ib_interface.retrieve_quote(symbol)
            if price and price > 0:
                logger.info(f"✅ Using Redis quote for {symbol}: ${price:.2f}")
                return float(price)

            logger.warning(f"⚠️ Redis quote unavailable for {symbol}; falling back to historical bars")

            # Fall back to historical data (IBKR provides delayed data without real-time subscription)
            bars = await ib_client.history_bars(symbol, duration="30 M", barSize="1 min", rth=True)
            if bars:
                latest_bar = bars[-1]
                bar_price = getattr(latest_bar, "close", None) or getattr(latest_bar, "average", None) or getattr(latest_bar, "open", None)
                if bar_price and bar_price > 0:
                    logger.info(f"✅ Using latest historical bar for {symbol}: close=${bar_price:.2f}")
                    return float(bar_price)
                logger.warning(f"⚠️ Historical bar for {symbol} missing usable price: {latest_bar}")

            logger.warning(f"⚠️ Historical data unavailable for {symbol}; requesting snapshot market data as last resort")

            # As a final fallback, request a delayed snapshot from IBKR (may fail without permissions)
            contract = await ib_client.qualify_stock(symbol)
            if not contract:
                logger.error(f"Could not qualify contract for {symbol}")
                return -1.0

            ticker = ib_client.ib.reqMktData(contract, "", True, False)  # snapshot=True gives delayed data
            await asyncio.sleep(1.0)

            if ticker.last and ticker.last > 0:
                logger.info(f"✅ Snapshot price for {symbol}: ${ticker.last:.2f}")
                return float(ticker.last)
            if ticker.close and ticker.close > 0:
                logger.info(f"✅ Snapshot close price for {symbol}: ${ticker.close:.2f}")
                return float(ticker.close)
            if ticker.bid and ticker.ask and ticker.bid > 0 and ticker.ask > 0:
                mid_price = (ticker.bid + ticker.ask) / 2
                logger.info(f"✅ Snapshot mid-price for {symbol}: ${mid_price:.2f}")
                return float(mid_price)

            logger.warning(f"No valid snapshot data for {symbol} - last: {ticker.last}, bid: {ticker.bid}, ask: {ticker.ask}, close: {getattr(ticker, 'close', None)}")
            return -1.0
                
        except Exception as e:
            logger.error(f"Error getting price for {symbol}: {e}")
            return -1.0
    
    async def _get_candle_data(self, symbol: str, duration: str = "1 D", bar_size: str = "1 min", rth: bool = True) -> list:
        """Get recent candle/bar data for analysis"""
        try:
            logger.info(f"📊 Getting candle data for {symbol}: {duration}, {bar_size}")
            
            # Get historical bars
            bars = await ib_client.history_bars(symbol, duration, bar_size, rth)
            
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
            
            # Show hard stop-out information if configured and bot has position
            hard_stop_out_pct = bot_state.get('bot_hard_stop_out', 0.0)
            if hard_stop_out_pct > 0 and is_bought:
                entry_price = bot_state.get('entry_price', 0)
                if entry_price > 0:
                    # Convert entry_price to float to avoid Decimal type errors
                    entry_price = float(entry_price)
                    stop_out_price = entry_price * (1 - hard_stop_out_pct / 100)
                    distance_to_stop = current_price - stop_out_price
                    direction_to_stop = "ABOVE" if distance_to_stop > 0 else "BELOW"
                    price_info += f"\n🛑 Hard Stop-Out: ${stop_out_price:.2f} ({abs(distance_to_stop):.2f} {direction_to_stop}) [{hard_stop_out_pct}%]"
            
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
            
            # Get current time (in seconds since epoch, matching TradingView format)
            current_time = int(time.time())
            
            # Extract time and price from points
            times = [point['time'] for point in points]
            prices = [point['price'] for point in points]
            
            logger.info(f"Trend line points: times={times}, prices={prices}")
            
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
        """Execute single multi-buy order when price crosses one entry line (30/20/20/30 split)"""
        try:
            bot_state = self.active_bots[bot_id]
            
            if len(bot_state.get('entry_lines', [])) < 2:
                logger.error(f"Bot {bot_id}: Multi-buy enabled but less than 2 entry lines found")
                return
            
            entry_lines = bot_state['entry_lines']
            second_line = entry_lines[0]  # Higher line (2nd buy line)
            first_line = entry_lines[1]   # Lower line (1st buy line)
            
            # Calculate prices for the 4 entry points
            second_price = self._calculate_trend_line_price(second_line['points'])
            first_price = self._calculate_trend_line_price(first_line['points'])
            
            # Calculate intermediate prices (1/3 and 2/3 of the way down from 2nd to 1st)
            price_diff = second_price - first_price
            third_price = second_price - (price_diff / 3)  # 1/3 way down
            two_thirds_price = second_price - (2 * price_diff / 3)  # 2/3 way down
            
            # Calculate share amounts (30%, 20%, 20%, 30% of total)
            total_shares = bot_state['position_size']
            shares_at_second = int(total_shares * 0.30)
            shares_at_third = int(total_shares * 0.20)
            shares_at_two_thirds = int(total_shares * 0.20)
            shares_at_first = total_shares - shares_at_second - shares_at_third - shares_at_two_thirds  # Remainder
            
            # Determine which order to place based on which line was crossed
            # Initialize multi_buy_tracker if not exists
            if 'multi_buy_tracker' not in bot_state:
                bot_state['multi_buy_tracker'] = {
                    'second_filled': False,
                    'third_filled': False,
                    'two_thirds_filled': False,
                    'first_filled': False,
                    'total_shares_bought': 0
                }
            
            tracker = bot_state['multi_buy_tracker']
            shares_to_buy = 0
            
            # Check which price level was crossed and place corresponding order
            if line['id'] == second_line['id'] and not tracker['second_filled']:
                # Price crossed 2nd entry line (highest)
                shares_to_buy = shares_at_second
                tracker['second_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 2nd entry line - buying {shares_to_buy} shares (30%)")
            elif current_price <= third_price and not tracker['third_filled']:
                # Price reached 1/3 way down
                shares_to_buy = shares_at_third
                tracker['third_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 1/3 level - buying {shares_to_buy} shares (20%)")
            elif current_price <= two_thirds_price and not tracker['two_thirds_filled']:
                # Price reached 2/3 way down
                shares_to_buy = shares_at_two_thirds
                tracker['two_thirds_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 2/3 level - buying {shares_to_buy} shares (20%)")
            elif line['id'] == first_line['id'] and not tracker['first_filled']:
                # Price crossed 1st entry line (lowest)
                shares_to_buy = shares_at_first
                tracker['first_filled'] = True
                logger.info(f"🤖 Bot {bot_id}: Multi-buy crossing 1st entry line - buying {shares_to_buy} shares (30%)")
            
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
                
                # If this is the first order, mark as bought
                if tracker['total_shares_bought'] > 0:
                    bot_state['is_bought'] = True
                    if bot_state['entry_price'] == 0:
                        bot_state['entry_price'] = current_price
                
                # Update database
                await self._update_bot_in_db(bot_id, {
                    'is_bought': bot_state['is_bought'],
                    'shares_entered': bot_state['shares_entered'],
                    'open_shares': bot_state['open_shares'],
                    'entry_order_status': 'FILLED'
                })
                
                # If all 4 orders are filled, create exit orders
                if tracker['second_filled'] and tracker['third_filled'] and tracker['two_thirds_filled'] and tracker['first_filled']:
                    logger.info(f"✅ Bot {bot_id}: All multi-buy orders placed ({tracker['total_shares_bought']} shares)")
                    # Create exit limit orders for all exit lines
                    await self._create_exit_orders_on_position_open(bot_id, current_price)
                    # Place stop-loss order
                    await self._place_stop_loss_order(bot_id, current_price, bot_state['position_size'])
            else:
                logger.error(f"❌ Bot {bot_id}: Failed to place multi-buy market order for {shares_to_buy} shares")
            
        except Exception as e:
            logger.error(f"Error executing multi-buy entry trade for bot {bot_id}: {e}")

# Global bot service instance
bot_service = BotService()
