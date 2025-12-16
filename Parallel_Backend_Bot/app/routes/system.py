import uuid
import json
import asyncio
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.controllers import system_controller
from app.utils.redis_util import redis
from app.utils.ib_client import ib_client
from app.services.streaming_service import streaming_service
from app.utils.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"])

@router.get("/status")
async def get_system_status():
    """
    Get comprehensive system health status for all services.
    Returns status for PostgreSQL, Redis, IB Gateway, and FastAPI.
    """
    try:
        status = await system_controller.get_comprehensive_status()
        return status
    except Exception as e:
        logger.error(f"Error getting system status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/restart")
async def restart_containers(confirm: bool = False, current_user = Depends(get_current_user)):
    """
    Request restart of all containers.
    Sets a flag in Redis that the external watchdog script monitors.

    Args:
        confirm: Must be True to proceed with restart
        current_user: Authenticated user (injected by dependency)

    Returns:
        Status of restart request
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="confirm parameter must be True to restart containers")

    try:
        # Check if restart is already in progress
        existing_restart = await redis.get("system:restart:requested")
        if existing_restart:
            return {
                "status": "already_in_progress",
                "message": "A restart is already in progress",
                "restart_id": json.loads(existing_restart).get("restart_id")
            }

        # Generate unique restart ID
        restart_id = str(uuid.uuid4())

        # Set restart flag in Redis (5 minute expiry)
        restart_data = {
            "restart_id": restart_id,
            "timestamp": datetime.utcnow().isoformat(),
            "user": current_user.username if hasattr(current_user, 'username') else "unknown"
        }

        await redis.set(
            "system:restart:requested",
            json.dumps(restart_data),
            ex=300  # 5 minute expiry
        )

        logger.info(f"🔄 Container restart requested by {restart_data['user']} (ID: {restart_id})")

        return {
            "status": "initiated",
            "message": "Restart request submitted. Containers will restart shortly.",
            "restart_id": restart_id,
            "estimated_downtime_seconds": 60
        }

    except Exception as e:
        logger.error(f"Error requesting container restart: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to request restart: {str(e)}")

@router.post("/ib/reconnect")
async def reconnect_ib_gateway(current_user = Depends(get_current_user)):
    """
    Manually trigger IB Gateway reconnection.
    Disconnects and reconnects to IB Gateway, then restarts streaming service.

    Args:
        current_user: Authenticated user (injected by dependency)

    Returns:
        Status of reconnection attempt
    """
    try:
        logger.info(f"🔄 IB Gateway reconnection requested by {current_user.username if hasattr(current_user, 'username') else 'unknown'}")

        # Disconnect if currently connected
        if ib_client.ib.isConnected():
            await ib_client.disconnect()
            logger.info("🔌 Disconnected from IB Gateway")
            await asyncio.sleep(2)  # Wait 2 seconds before reconnecting

        # Attempt to reconnect
        await ib_client.connect()

        if ib_client.ib.isConnected():
            logger.info("✅ Successfully reconnected to IB Gateway")

            # Restart streaming service if it exists
            try:
                if streaming_service:
                    await streaming_service.stop()
                    await asyncio.sleep(1)
                    await streaming_service.start()
                    logger.info("📡 Streaming service restarted")
            except Exception as e:
                logger.warning(f"⚠️ Could not restart streaming service: {e}")

            return {
                "status": "success",
                "message": "Successfully reconnected to IB Gateway",
                "connection_status": "connected"
            }
        else:
            raise Exception("Connection failed - IB Gateway may not be ready")

    except Exception as e:
        logger.error(f"❌ IB Gateway reconnection failed: {e}")
        return {
            "status": "failed",
            "message": f"Reconnection failed: {str(e)}",
            "connection_status": "disconnected"
        }
