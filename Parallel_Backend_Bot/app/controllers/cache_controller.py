from fastapi import HTTPException
from app.utils.redis_util import set_value, get_value, del_value

async def cache_set(key: str, value: str, ttl: int):
    await set_value(key, value, ttl)
    return {"message": f"Key {key} set with TTL {ttl}s"}

async def cache_get(key: str):
    value = await get_value(key)
    if not value:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"key": key, "value": value}

async def cache_del(key: str):
    deleted = await del_value(key)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"message": f"Key {key} deleted"}
