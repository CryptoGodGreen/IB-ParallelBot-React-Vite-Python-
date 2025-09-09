from pydantic import BaseModel

class CacheRequest(BaseModel):
    key: str
    value: str
    ttl: int = 60

class CacheResponse(BaseModel):
    key: str
    value: str
