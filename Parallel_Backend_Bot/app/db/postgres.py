from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# Use IP address instead of hostname to avoid DNS lookups
# If running in Docker, resolve the hostname once at startup
import socket
try:
    postgres_ip = socket.gethostbyname(settings.POSTGRES_HOST)
    logger.info(f"🔍 Resolved {settings.POSTGRES_HOST} to {postgres_ip}")
except socket.gaierror:
    postgres_ip = settings.POSTGRES_HOST
    logger.warning(f"⚠️ Could not resolve {settings.POSTGRES_HOST}, using as-is")

DATABASE_URL = (
    f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
    f"@{postgres_ip}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
)

engine = create_async_engine(
    DATABASE_URL, 
    echo=False, 
    future=True,
    pool_size=20,  # Increase connection pool size
    max_overflow=10,  # Allow up to 10 additional connections
    pool_pre_ping=True,  # Verify connections before using them
    pool_recycle=3600,  # Recycle connections after 1 hour
    pool_timeout=10,  # Wait up to 10 seconds for a connection
    # asyncpg-specific optimizations
    connect_args={
        "server_settings": {
            "application_name": "fastapi_trading_bot",
            "jit": "off",  # Disable JIT compilation for faster queries
        },
        "command_timeout": 10,  # 10 second timeout for commands
        "timeout": 5,  # 5 second connection timeout
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
