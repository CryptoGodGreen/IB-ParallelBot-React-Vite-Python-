from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# Use IP address instead of hostname to avoid DNS lookups
# If running in Docker, resolve the hostname once at startup
import socket
try:
    # Add timeout to DNS resolution to prevent hanging
    socket.setdefaulttimeout(2)  # 2 second timeout for DNS resolution
    postgres_ip = socket.gethostbyname(settings.POSTGRES_HOST)
    logger.info(f"🔍 Resolved {settings.POSTGRES_HOST} to {postgres_ip}")
    socket.setdefaulttimeout(None)  # Reset to default
except (socket.gaierror, socket.timeout) as e:
    postgres_ip = settings.POSTGRES_HOST
    logger.warning(f"⚠️ Could not resolve {settings.POSTGRES_HOST} (error: {e}), using as-is")
    socket.setdefaulttimeout(None)  # Reset to default

DATABASE_URL = (
    f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
    f"@{postgres_ip}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
)

engine = create_async_engine(
    DATABASE_URL, 
    echo=False, 
    future=True,
    pool_size=15,  # Increased to handle concurrent requests
    max_overflow=10,  # Allow more overflow connections
    pool_pre_ping=False,  # Disabled - can cause hangs on slow/unresponsive DB. Connection recycling handles stale connections.
    pool_recycle=300,  # Recycle connections after 5 minutes
    pool_timeout=10,  # Increased to 10 seconds - give more time to get connection from pool
    # asyncpg-specific optimizations
    connect_args={
        "server_settings": {
            "application_name": "fastapi_trading_bot",
            "jit": "off",  # Disable JIT compilation for faster queries
        },
        "command_timeout": 10,  # Increased to 10 seconds for slow queries
        "timeout": 5,  # 5 seconds for initial connection
    }
)

logger.info(f"✅ Database engine created with URL: postgresql+asyncpg://...@{postgres_ip}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}")

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
