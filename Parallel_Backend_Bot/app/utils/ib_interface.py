import asyncio
import json
import redis
import logging
from typing import Optional
from app.config import settings

logger = logging.getLogger(__name__)

class IbInterface:
    """
    Redis-based quote interface similar to Ruby IbInterface
    Handles quote requests via Redis pub/sub instead of direct IB connection
    """
    
    def __init__(self):
        self.redis = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True
        )

    async def retrieve_quote(self, symbol: str) -> float:
        """
        Retrieve quote via Redis pub/sub (like Ruby IbInterface.retrieve_quote)
        """
        request_id = asyncio.get_event_loop().time() * 1000000  # Unique ID
        
        try:
            logger.info(f"📊 Requesting quote for {symbol} (ID: {request_id})")
            
            # Publish quote request (like Ruby)
            request_data = {
                'symbol': symbol,
                'id': request_id
            }
            
            self.redis.publish('contract-quote-requests', json.dumps(request_data))
            
            # Subscribe to response (like Ruby subscribe_with_timeout)
            pubsub = self.redis.pubsub()
            pubsub.subscribe(f'CONTRACT-QUOTES-{request_id}')
            
            # Wait for response with timeout (like Ruby 3-second timeout)
            timeout = 3.0
            start_time = asyncio.get_event_loop().time()
            
            while True:
                message = pubsub.get_message(timeout=0.1)
                if message and message['type'] == 'message':
                    data = json.loads(message['data'])
                    
                    if data.get('status') == 'error':
                        logger.error(f"Quote request failed for {symbol}: {data.get('error')}")
                        return -1.0
                    
                    # Extract price from ticker data
                    if 'last' in data and data['last'] is not None:
                        price = float(data['last'])
                        logger.info(f"✅ Quote for {symbol}: ${price}")
                        return price
                
                # Check timeout
                if asyncio.get_event_loop().time() - start_time > timeout:
                    logger.warning(f"⏰ Quote request timeout for {symbol}")
                    break
                
                await asyncio.sleep(0.01)  # Small delay to prevent busy waiting
            
            pubsub.unsubscribe(f'CONTRACT-QUOTES-{request_id}')
            pubsub.close()
            
        except Exception as e:
            logger.error(f"❌ Error retrieving quote for {symbol}: {e}")
            return -1.0
        
        logger.warning(f"⚠️ No quote data received for {symbol}")
        return -1.0

    async def retrieve_option_quote(self, symbol: str, strike_date: str, strike: float, right: str, tick_type: int = 1) -> float:
        """
        Retrieve option quote (like Ruby IbInterface.retrieve_option_quote)
        Note: Redis handler is not implemented, so this will timeout quickly and return -1
        """
        request_id = asyncio.get_event_loop().time() * 1000000
        pubsub = None
        
        try:
            # Wrap entire operation in timeout to prevent hanging
            async def _retrieve_with_timeout():
                nonlocal pubsub
                logger.info(f"📊 Requesting option quote for {symbol} {strike_date} {strike} {right}")
                
                request_data = {
                    'symbol': symbol,
                    'strike': strike,
                    'strike_date': strike_date,
                    'right': right,
                    'id': request_id
                }
                
                self.redis.publish('option-quote-requests', json.dumps(request_data))
                
                # Subscribe to response
                pubsub = self.redis.pubsub()
                pubsub.subscribe(f'QUOTES-{request_id}')
                
                timeout = 3.0  # Reduced to 3 seconds - Redis handler not implemented
                start_time = asyncio.get_event_loop().time()
                
                while True:
                    message = pubsub.get_message(timeout=0.1)
                    if message and message['type'] == 'message':
                        data = json.loads(message['data'])
                        
                        if data.get('tick_type') == tick_type and 'price' in data:
                            price = float(data['price'])
                            logger.info(f"✅ Option quote for {symbol}: ${price}")
                            return price
                    
                    # Check timeout
                    if asyncio.get_event_loop().time() - start_time > timeout:
                        logger.warning(f"⏰ Option quote request timeout for {symbol} after {timeout}s")
                        return -1.0
                    
                    await asyncio.sleep(0.01)  # Small delay to prevent busy waiting
            
            # Execute with overall timeout protection
            try:
                result = await asyncio.wait_for(_retrieve_with_timeout(), timeout=5.0)
                return result if result is not None else -1.0
            except asyncio.TimeoutError:
                logger.warning(f"⏰ Option quote operation timed out for {symbol}")
                return -1.0
            finally:
                if pubsub:
                    try:
                        pubsub.unsubscribe(f'QUOTES-{request_id}')
                        pubsub.close()
                    except:
                        pass
            
        except Exception as e:
            logger.error(f"❌ Error retrieving option quote for {symbol}: {e}", exc_info=True)
            if pubsub:
                try:
                    pubsub.unsubscribe(f'QUOTES-{request_id}')
                    pubsub.close()
                except:
                    pass
            return -1.0
        
        logger.warning(f"⚠️ No option quote data received for {symbol}")
        return -1.0

    async def find_option_info(self, symbol: str, option_date: str, strike: float, right: str) -> dict:
        """
        Find option contract info (like Ruby IbInterface.find_option_info)
        """
        request_id = asyncio.get_event_loop().time() * 1000000
        
        try:
            logger.info(f"📊 Requesting option info for {symbol} {option_date} {strike} {right}")
            
            request_data = {
                'strike': strike,
                'option_date': option_date,
                'right': right,
                'multiplier': 100,
                'symbol': symbol,
                'id': request_id
            }
            
            self.redis.publish('contract-info-requests', json.dumps(request_data))
            
            # Subscribe to response
            pubsub = self.redis.pubsub()
            pubsub.subscribe(f'CONTRACT-INFO-{request_id}')
            
            timeout = 30.0  # Like Ruby 30-second timeout
            start_time = asyncio.get_event_loop().time()
            
            while True:
                message = pubsub.get_message(timeout=0.1)
                if message and message['type'] == 'message':
                    data = json.loads(message['data'])
                    
                    if data.get('success', False):
                        logger.info(f"✅ Option info found for {symbol}")
                        return data
                    else:
                        logger.warning(f"⚠️ Option info request failed for {symbol}: {data.get('error')}")
                        return {'success': False, 'error': data.get('error')}
                    
                    # Check timeout
                    if asyncio.get_event_loop().time() - start_time > timeout:
                        logger.warning(f"⏰ Option info request timeout for {symbol}")
                        break
                
                await asyncio.sleep(0.01)  # Small delay to prevent busy waiting
            
            pubsub.unsubscribe(f'CONTRACT-INFO-{request_id}')
            pubsub.close()
            
        except Exception as e:
            logger.error(f"❌ Error finding option info for {symbol}: {e}")
            return {'success': False, 'error': str(e)}
        
        logger.warning(f"⚠️ No option info received for {symbol}")
        return {'success': False, 'error': 'No data received'}

    async def find_next_available_option_date(self, symbol: str, days_from_now: int, strike: float, right: str) -> Optional[str]:
        """
        Find next available option date (like Ruby IbInterface.find_next_available_option_date)
        """
        from datetime import datetime, timedelta
        
        trial_date = datetime.now() + timedelta(days=days_from_now)
        found_date = None
        counter = 0
        
        while found_date is None and counter < 10:
            result = await self.find_option_info(
                symbol, 
                trial_date.strftime("%Y%m%d"), 
                strike, 
                right
            )
            
            if result.get('success', False):
                found_date = trial_date
            else:
                trial_date = trial_date + timedelta(days=1)
                counter += 1
        
        return found_date.strftime("%Y%m%d") if found_date else None


# Singleton instance
ib_interface = IbInterface()
