import logging.config
import asyncio
from fastapi import FastAPI
from app.routes import health_router, cache_router, users_router, charts_router
from app.db.models import Base
from app.db.postgres import engine, AsyncSessionLocal
from app.controllers.user_controller import seed_admin
from app.utils.ib_client import ib_client
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

app.include_router(health_router)
app.include_router(cache_router)
app.include_router(users_router)
app.include_router(charts_router)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await seed_admin(db)
    
    # asyncio.create_task(ib_client.connect())


@app.on_event("shutdown")
async def shutdown():
    await ib_client.disconnect()
