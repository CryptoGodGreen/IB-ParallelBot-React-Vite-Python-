from fastapi import APIRouter
from app.schemas.cache_schema import CacheRequest
from app.controllers.cache_controller import cache_set, cache_get, cache_del

router = APIRouter(prefix="/cache")

@router.post("/set", summary="Set a cache key", response_description="Cache key stored with TTL")
async def set_cache(req: CacheRequest):
    return await cache_set(req.key, req.value, req.ttl)

@router.get("/get/{key}", summary="Get a cache key", response_description="Value of the cache key")
async def get_cache(key: str):
    return await cache_get(key)

@router.delete("/del/{key}", summary="Delete a cache key", response_description="Cache key removed")
async def delete_cache(key: str):
    return await cache_del(key)
