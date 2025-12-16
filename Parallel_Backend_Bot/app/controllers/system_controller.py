import asyncio
import time
import logging
from datetime import datetime
from typing import Dict, Any
from sqlalchemy import text
from app.db.postgres import AsyncSessionLocal, POSTGRES_STARTUP_TIME
from app.utils.redis_util import redis, REDIS_STARTUP_TIME
from app.utils.ib_client import ib_client, IB_CLIENT_STARTUP_TIME

logger = logging.getLogger(__name__)

# Track FastAPI startup time here to avoid circular import with main.py
FASTAPI_STARTUP_TIME = time.time()

async def check_postgres_health() -> Dict[str, Any]:
    """
    Check PostgreSQL database health.
    Returns health status, connection status, uptime, and details.
    """
    start_time = time.time()
    try:
        async with AsyncSessionLocal() as session:
            # Execute simple query to check connection
            result = await session.execute(text("SELECT NOW(), version()"))
            row = result.fetchone()

            if row:
                current_time = row[0]
                version = row[1].split(',')[0] if row[1] else "Unknown"  # Extract version number
                ping_ms = round((time.time() - start_time) * 1000, 2)

                uptime_seconds = int(time.time() - POSTGRES_STARTUP_TIME)

                return {
                    "status": "healthy",
                    "connection_status": "connected",
                    "uptime_seconds": uptime_seconds,
                    "last_check": datetime.utcnow().isoformat() + "Z",
                    "details": {
                        "version": version,
                        "ping_ms": ping_ms
                    }
                }
            else:
                raise Exception("No result from database query")

    except asyncio.TimeoutError:
        logger.error("PostgreSQL health check timed out")
        return {
            "status": "unhealthy",
            "connection_status": "timeout",
            "uptime_seconds": 0,
            "last_check": datetime.utcnow().isoformat() + "Z",
            "details": {"error": "Connection timeout"}
        }
    except Exception as e:
        logger.error(f"PostgreSQL health check failed: {e}")
        return {
            "status": "unhealthy",
            "connection_status": "disconnected",
            "uptime_seconds": 0,
            "last_check": datetime.utcnow().isoformat() + "Z",
            "details": {"error": str(e)}
        }

async def check_redis_health() -> Dict[str, Any]:
    """
    Check Redis health.
    Returns health status, connection status, uptime, and details.
    """
    start_time = time.time()
    try:
        # Ping Redis
        result = await redis.ping()

        if result:
            ping_ms = round((time.time() - start_time) * 1000, 2)
            uptime_seconds = int(time.time() - REDIS_STARTUP_TIME)

            # Get Redis info (memory usage)
            try:
                info = await redis.info("memory")
                used_memory_mb = round(info.get("used_memory", 0) / (1024 * 1024), 2)
            except:
                used_memory_mb = 0

            return {
                "status": "healthy",
                "connection_status": "connected",
                "uptime_seconds": uptime_seconds,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {
                    "ping_ms": ping_ms,
                    "used_memory_mb": used_memory_mb
                }
            }
        else:
            raise Exception("Redis PING returned False")

    except asyncio.TimeoutError:
        logger.error("Redis health check timed out")
        return {
            "status": "unhealthy",
            "connection_status": "timeout",
            "uptime_seconds": 0,
            "last_check": datetime.utcnow().isoformat() + "Z",
            "details": {"error": "Connection timeout"}
        }
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        return {
            "status": "unhealthy",
            "connection_status": "disconnected",
            "uptime_seconds": 0,
            "last_check": datetime.utcnow().isoformat() + "Z",
            "details": {"error": str(e)}
        }

async def check_ib_gateway_health() -> Dict[str, Any]:
    """
    Check IB Gateway health.
    Returns health status, connection status, uptime, and details.
    """
    try:
        is_connected = ib_client.ib.isConnected()
        uptime_seconds = int(time.time() - IB_CLIENT_STARTUP_TIME)

        if is_connected:
            # Get client ID from settings
            from app.config import settings
            client_id = settings.IB_CLIENT_ID

            # Check if account data is available
            account_ready = False
            try:
                accounts = ib_client.ib.managedAccounts()
                account_ready = len(accounts) > 0
            except:
                pass

            return {
                "status": "healthy",
                "connection_status": "connected",
                "uptime_seconds": uptime_seconds,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {
                    "client_id": client_id,
                    "account_ready": account_ready
                }
            }
        else:
            return {
                "status": "unhealthy",
                "connection_status": "disconnected",
                "uptime_seconds": uptime_seconds,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {"error": "Not connected to IB Gateway"}
            }

    except Exception as e:
        logger.error(f"IB Gateway health check failed: {e}")
        return {
            "status": "unhealthy",
            "connection_status": "error",
            "uptime_seconds": 0,
            "last_check": datetime.utcnow().isoformat() + "Z",
            "details": {"error": str(e)}
        }

async def check_fastapi_health() -> Dict[str, Any]:
    """
    Check FastAPI service health (self-check).
    Always returns healthy if this function is being called.
    """
    uptime_seconds = int(time.time() - FASTAPI_STARTUP_TIME)

    return {
        "status": "healthy",
        "connection_status": "running",
        "uptime_seconds": uptime_seconds,
        "last_check": datetime.utcnow().isoformat() + "Z",
        "details": {
            "version": "1.0.0"
        }
    }

async def get_comprehensive_status() -> Dict[str, Any]:
    """
    Get comprehensive system health status for all services.
    Runs all health checks in parallel with timeout.
    """
    try:
        # Run all health checks in parallel with 3-second timeout
        postgres_task = asyncio.create_task(check_postgres_health())
        redis_task = asyncio.create_task(check_redis_health())
        ib_task = asyncio.create_task(check_ib_gateway_health())
        fastapi_task = asyncio.create_task(check_fastapi_health())

        # Wait for all tasks with timeout
        results = await asyncio.wait_for(
            asyncio.gather(postgres_task, redis_task, ib_task, fastapi_task, return_exceptions=True),
            timeout=3.0
        )

        postgres_health, redis_health, ib_health, fastapi_health = results

        # Handle exceptions in results
        if isinstance(postgres_health, Exception):
            logger.error(f"PostgreSQL check exception: {postgres_health}")
            postgres_health = {
                "status": "unhealthy",
                "connection_status": "error",
                "uptime_seconds": 0,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {"error": str(postgres_health)}
            }

        if isinstance(redis_health, Exception):
            logger.error(f"Redis check exception: {redis_health}")
            redis_health = {
                "status": "unhealthy",
                "connection_status": "error",
                "uptime_seconds": 0,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {"error": str(redis_health)}
            }

        if isinstance(ib_health, Exception):
            logger.error(f"IB Gateway check exception: {ib_health}")
            ib_health = {
                "status": "unhealthy",
                "connection_status": "error",
                "uptime_seconds": 0,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {"error": str(ib_health)}
            }

        if isinstance(fastapi_health, Exception):
            logger.error(f"FastAPI check exception: {fastapi_health}")
            fastapi_health = {
                "status": "unhealthy",
                "connection_status": "error",
                "uptime_seconds": 0,
                "last_check": datetime.utcnow().isoformat() + "Z",
                "details": {"error": str(fastapi_health)}
            }

        # Determine overall status
        all_healthy = all([
            postgres_health["status"] == "healthy",
            redis_health["status"] == "healthy",
            ib_health["status"] == "healthy",
            fastapi_health["status"] == "healthy"
        ])

        any_unhealthy = any([
            postgres_health["status"] == "unhealthy",
            redis_health["status"] == "unhealthy",
            ib_health["status"] == "unhealthy",
            fastapi_health["status"] == "unhealthy"
        ])

        if all_healthy:
            overall_status = "healthy"
        elif any_unhealthy:
            overall_status = "unhealthy"
        else:
            overall_status = "degraded"

        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "services": {
                "postgres": postgres_health,
                "redis": redis_health,
                "ib_gateway": ib_health,
                "fastapi": fastapi_health
            },
            "overall_status": overall_status
        }

    except asyncio.TimeoutError:
        logger.error("Comprehensive health check timed out")
        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "services": {
                "postgres": {"status": "unknown", "connection_status": "timeout", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {}},
                "redis": {"status": "unknown", "connection_status": "timeout", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {}},
                "ib_gateway": {"status": "unknown", "connection_status": "timeout", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {}},
                "fastapi": {"status": "unknown", "connection_status": "timeout", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {}}
            },
            "overall_status": "unknown"
        }
    except Exception as e:
        logger.error(f"Comprehensive health check failed: {e}")
        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "services": {
                "postgres": {"status": "unknown", "connection_status": "error", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {"error": str(e)}},
                "redis": {"status": "unknown", "connection_status": "error", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {"error": str(e)}},
                "ib_gateway": {"status": "unknown", "connection_status": "error", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {"error": str(e)}},
                "fastapi": {"status": "unknown", "connection_status": "error", "uptime_seconds": 0, "last_check": datetime.utcnow().isoformat() + "Z", "details": {"error": str(e)}}
            },
            "overall_status": "unknown"
        }
