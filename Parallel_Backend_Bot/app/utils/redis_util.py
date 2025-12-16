import redis.asyncio as aioredis
from app.config import settings
import time

# Track startup time for uptime calculation
REDIS_STARTUP_TIME = time.time()

redis = aioredis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    decode_responses=True
)

async def set_value(key: str, value: str, ttl: int = 60):
    await redis.set(key, value, ex=ttl)

async def get_value(key: str):
    return await redis.get(key)

async def del_value(key: str):
    return await redis.delete(key)
