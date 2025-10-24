import asyncio
import logging
import json
import redis
from typing import Dict, List, Optional
from ib_async import IB, Stock, Contract, Ticker
from app.config import settings

logger = logging.getLogger(__name__)

class StreamingService:
    """
    Dedicated streaming service similar to Ruby Rails IBServer/run.rb
    Handles all market data streaming via Redis pub/sub
    """
    
    def __init__(self):
        self.ib = IB()
        self.redis = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True
        )
        self._connected = False
        self._registered_symbols: Dict[str, int] = {}  # symbol -> ticker_id
        self._request_mapping: Dict[str, str] = {}  # request_id -> symbol mapping
        self._ticker_id_counter = 1000000  # Start high to avoid conflicts
        
        # Event handlers
        self.ib.errorEvent += self.on_error
        self.ib.disconnectedEvent += self.on_disconnected
        
        # Subscribe to tick data using the correct ib_async approach
        self.ib.pendingTickersEvent += self.on_pending_tickers

    async def start(self):
        """Start the streaming service"""
        try:
            logger.info("🚀 Starting Streaming Service...")
            await self.connect()
            await self.start_redis_subscriber()
            logger.info("✅ Streaming Service started successfully")
        except Exception as e:
            logger.error(f"❌ Failed to start Streaming Service: {e}")
            raise

    async def connect(self):
        """Connect to IB Gateway"""
        if self._connected or self.ib.isConnected():
            return
            
        try:
            logger.info(f"🔌 Connecting to IB Gateway @ {settings.IB_HOST}:{settings.IB_PORT}")
            await self.ib.connectAsync(
                settings.IB_HOST,
                settings.IB_PORT,
                clientId=settings.IB_STREAMING_CLIENT_ID,  # Dedicated client ID for streaming
                timeout=settings.IB_CONNECT_TIMEOUT
            )
            self._connected = True
            logger.info("✅ Connected to IB Gateway for streaming")
        except Exception as e:
            logger.error(f"❌ IB Gateway connection failed: {e}")
            raise

    async def start_redis_subscriber(self):
        """Start Redis subscriber for quote requests (like Ruby IBServer)"""
        pubsub = self.redis.pubsub()
        
        # Subscribe to channels like Ruby implementation
        pubsub.subscribe(
            'contract-quote-requests',
            'option-quote-requests', 
            'historical-quote-requests',
            'contract-info-requests'
        )
        
        logger.info("📡 Started Redis subscriber for quote requests")
        
        # Process messages in a separate task
        asyncio.create_task(self._process_redis_messages(pubsub))

    async def _process_redis_messages(self, pubsub):
        """Process Redis messages in a loop"""
        try:
            while True:
                message = pubsub.get_message(timeout=1.0)
                if message and message['type'] == 'message':
                    await self.handle_redis_message(message)
                await asyncio.sleep(0.1)  # Small delay to prevent busy waiting
        except Exception as e:
            logger.error(f"Error processing Redis messages: {e}")

    async def handle_redis_message(self, message):
        """Handle incoming Redis messages (like Ruby IBServer)"""
        try:
            data = json.loads(message['data'])
            channel = message['channel']
            
            if channel == 'contract-quote-requests':
                await self.handle_contract_quote_request(data)
            elif channel == 'option-quote-requests':
                await self.handle_option_quote_request(data)
            elif channel == 'historical-quote-requests':
                await self.handle_historical_quote_request(data)
            elif channel == 'contract-info-requests':
                await self.handle_contract_info_request(data)
                
        except Exception as e:
            logger.error(f"Error handling Redis message: {e}")

    async def handle_contract_quote_request(self, data):
        """Handle contract quote requests (like Ruby fetch_contract_quote)"""
        symbol = data.get('symbol')
        request_id = data.get('id')
        
        if not symbol or not request_id:
            return
            
        try:
            logger.info(f"📊 Quote request for {symbol} (ID: {request_id})")
            
            # Store request mapping
            self._request_mapping[str(request_id)] = symbol
            
            # Get or create ticker ID
            if symbol not in self._registered_symbols:
                self._registered_symbols[symbol] = self._ticker_id_counter
                self._ticker_id_counter += 1
                
                # Request market data
                contract = Stock(symbol, 'SMART', 'USD')
                ticker = self.ib.reqMktData(contract, '', False, False)
                
            # Publish quote data
            quote_data = {
                'symbol': symbol,
                'request_id': request_id,
                'timestamp': asyncio.get_event_loop().time(),
                'status': 'requested'
            }
            
            self.redis.publish(f'CONTRACT-QUOTES-{request_id}', json.dumps(quote_data))
            
        except Exception as e:
            logger.error(f"Error handling contract quote request for {symbol}: {e}")
            error_data = {
                'symbol': symbol,
                'request_id': request_id,
                'error': str(e),
                'status': 'error'
            }
            self.redis.publish(f'CONTRACT-QUOTES-{request_id}', json.dumps(error_data))

    async def handle_option_quote_request(self, data):
        """Handle option quote requests"""
        # TODO: Implement option quote handling
        pass

    async def handle_historical_quote_request(self, data):
        """Handle historical data requests"""
        # TODO: Implement historical data handling
        pass

    async def handle_contract_info_request(self, data):
        """Handle contract info requests"""
        # TODO: Implement contract info handling
        pass

    def on_pending_tickers(self, tickers):
        """Handle pending tickers event (like Ruby TickPrice subscription)"""
        try:
            for ticker in tickers:
                symbol = ticker.contract.symbol
                
                # Update Redis with latest quote data
                quote_data = {
                    'symbol': symbol,
                    'last': ticker.last,
                    'bid': ticker.bid,
                    'ask': ticker.ask,
                    'volume': ticker.volume,
                    'timestamp': asyncio.get_event_loop().time(),
                    'ticker_id': self._registered_symbols.get(symbol)
                }
                
                # Publish to Redis (like Ruby implementation)
                if symbol in self._registered_symbols:
                    ticker_id = self._registered_symbols[symbol]
                    self.redis.publish(f'QUOTES-{ticker_id}', json.dumps(quote_data))
                    
                    # Find request_id for this symbol and publish to contract-quotes channel
                    for request_id, mapped_symbol in self._request_mapping.items():
                        if mapped_symbol == symbol:
                            self.redis.publish(f'CONTRACT-QUOTES-{request_id}', json.dumps(quote_data))
                            break
                
                # Update process status (like Ruby)
                self.redis.hset('PROCESS_STATUS', 'STREAMING_LAST_TIME', 
                              asyncio.get_event_loop().time())
                
        except Exception as e:
            logger.error(f"Error handling pending tickers: {e}")

    def on_error(self, reqId, errorCode, errorString, contract=None):
        """Handle IB errors (like Ruby Alert subscription)"""
        # Filter out informational messages (like Ruby)
        if errorCode not in [10285, 2104, 2106, 2158, 2176]:
            logger.error(f"IBKR Streaming Error: reqId={reqId}, code={errorCode}, msg='{errorString}'")
        
        # Always update status timestamp (like Ruby)
        self.redis.hset('PROCESS_STATUS', 'STREAMING_LAST_TIME', 
                      asyncio.get_event_loop().time())
        
        # Publish alert to Redis (like Ruby)
        alert_data = {
            'request_id': reqId,
            'code': errorCode,
            'message': errorString,
            'timestamp': asyncio.get_event_loop().time()
        }
        self.redis.publish(f'ALERTS-{reqId}', json.dumps(alert_data))

    def on_disconnected(self):
        """Handle disconnection (like Ruby)"""
        logger.warning("🔌 IB Gateway disconnected from streaming service")
        self._connected = False
        
        # Update status
        self.redis.hset('PROCESS_STATUS', 'STREAMING_STATUS', 'DISCONNECTED')
        self.redis.hset('PROCESS_STATUS', 'STREAMING_LAST_TIME', 
                      asyncio.get_event_loop().time())

    async def stop(self):
        """Stop the streaming service"""
        try:
            logger.info("🛑 Stopping Streaming Service...")
            
            # Cancel all market data requests
            for symbol, ticker_id in self._registered_symbols.items():
                self.ib.cancelMktData(ticker_id)
            
            # Disconnect from IB
            if self.ib.isConnected():
                self.ib.disconnect()
                
            self._connected = False
            logger.info("✅ Streaming Service stopped")
            
        except Exception as e:
            logger.error(f"❌ Error stopping Streaming Service: {e}")


# Singleton instance
streaming_service = StreamingService()
