from typing import Dict, Set
from fastapi import WebSocket
import asyncio
import json

class WSManager:
    def __init__(self):
        self.groups: Dict[str, Set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, group: str, ws: WebSocket):
        await ws.accept()
        async with self.lock:
            self.groups.setdefault(group, set()).add(ws)

    async def disconnect(self, group: str, ws: WebSocket):
        async with self.lock:
            self.groups.get(group, set()).discard(ws)

    async def broadcast(self, group: str, message: dict):
        dead = []
        async with self.lock:
            conns = list(self.groups.get(group, set()))
        for ws in conns:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(group, ws)

_ws = WSManager()

async def ws_broadcast(group: str, message: dict):
    await _ws.broadcast(group, message)

def ws_manager() -> WSManager:
    return _ws
