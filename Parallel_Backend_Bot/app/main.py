import logging.config
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import health_router, cache_router, users_router, charts_router, orders_router, bot_router
from app.routes.bot_config_router import router as bot_config_router
from app.api.udf import router as udf_router
from app.db.models import Base
from app.models.market_data import Base as MarketDataBase
from app.models.bot_models import Base as BotBase
from app.models.bot_config import Base as BotConfigBase
from app.db.postgres import engine, AsyncSessionLocal
from app.controllers.user_controller import seed_admin
from app.utils.ib_client import ib_client
from app.services.streaming_service import streaming_service
from app.services.bot_service import bot_service
from app.logging_config import LOGGING_CONFIG

logging.config.dictConfig(LOGGING_CONFIG)

app = FastAPI(
    title="Parallel Bot API",
    description="""
    🚀 **Parallel Bot API** — A production-grade FastAPI service with:
    - ✅ Postgres (SQLAlchemy Async)
    - ✅ Redis (async caching with TTL)
    - ✅ Modular routes & controllers
    - ✅ Dockerized setup (with hot reload in dev)
    - ✅ Swagger + ReDoc auto-docs
    """,
    version="1.0.0",
    contact={
        "name": "Bitorio Tech",
        "url": "https://bitoriotech.com",
        "email": "support@bitoriotech.com",
    },
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    openapi_tags=[
        {"name": "Health", "description": "Check DB connection and service health"}
    ],
)

origins = [
   "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(cache_router)
app.include_router(users_router)
app.include_router(charts_router)
app.include_router(orders_router)
app.include_router(bot_router)
app.include_router(bot_config_router)
app.include_router(udf_router)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(MarketDataBase.metadata.create_all)
        await conn.run_sync(BotBase.metadata.create_all)
        await conn.run_sync(BotConfigBase.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await seed_admin(db)
    
    # IB Gateway connection with retry (handles timing race condition during container startup)
    max_attempts = 10
    backoff = 4.0  # Start at 4 seconds

    for attempt in range(1, max_attempts + 1):
        try:
            await ib_client.connect()
            logging.getLogger(__name__).info(f"✅ IBKR connection established on startup (attempt {attempt})")
            break
        except Exception as e:
            if attempt < max_attempts:
                logging.getLogger(__name__).warning(
                    f"⚠️ IBKR connection attempt {attempt}/{max_attempts} failed: {e}. "
                    f"Retrying in {backoff}s..."
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, 30)  # Exponential backoff, max 30s
            else:
                logging.getLogger(__name__).error(
                    f"❌ IBKR connection failed after {max_attempts} attempts. "
                    f"Gateway may not be ready. Will retry on first API request."
                )

    # Start streaming service (only if connected)
    if ib_client.ib.isConnected():
        try:
            await streaming_service.start()
            logging.getLogger(__name__).info("📡 Streaming service started")
        except Exception as e:
            logging.getLogger(__name__).error(f"❌ Failed to start streaming service: {e}")
    else:
        logging.getLogger(__name__).warning("⚠️ Streaming service not started (no IB connection)")

    # Start bot service
    try:
        await bot_service.start()
        logging.getLogger(__name__).info("🤖 Bot service started")
    except Exception as e:
        logging.getLogger(__name__).error(f"❌ Failed to start bot service: {e}")


@app.on_event("shutdown")
async def shutdown():
    # Stop streaming service
    try:
        await streaming_service.stop()
        logging.getLogger(__name__).info("📡 Streaming service stopped")
    except Exception as e:
        logging.getLogger(__name__).error(f"❌ Error stopping streaming service: {e}")

    # Stop bot service
    try:
        await bot_service.stop()
        logging.getLogger(__name__).info("🤖 Bot service stopped")
    except Exception as e:
        logging.getLogger(__name__).error(f"❌ Error stopping bot service: {e}")

    # Disconnect from IBKR
    try:
        if ib_client.ib.isConnected():
            ib_client.ib.disconnect()
            logging.getLogger(__name__).info("🔌 Disconnected from IBKR")
    except Exception as e:
        logging.getLogger(__name__).error(f"❌ Error disconnecting from IBKR: {e}")
