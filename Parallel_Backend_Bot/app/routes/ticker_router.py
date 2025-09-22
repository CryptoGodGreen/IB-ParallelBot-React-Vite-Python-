import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.utils.ib_client import ib_client

router = APIRouter(prefix="/ws", tags=["Ticker"])

@router.websocket("/ticker/{symbol}")
async def ws_ticker(websocket: WebSocket, symbol: str):
    await websocket.accept()
    try:
        
        contract = await ib_client.qualify_stock(symbol)
        if not contract:
            await websocket.send_json({"error": f"Unable to qualify {symbol}"})
            await websocket.close()
            return

        ticker = ib_client.ib.reqMktData(contract)

        while True:
            await asyncio.sleep(5) 
            await websocket.send_json({
                "symbol": symbol.upper(),
                "last": ticker.last,
                "bid": ticker.bid,
                "ask": ticker.ask,
                "volume": ticker.volume,
                "time": ticker.time.isoformat() if ticker.time else None
            })

    except WebSocketDisconnect:
        print(f"❌ WebSocket disconnected for {symbol}")
    except Exception as e:
        await websocket.send_json({"error": str(e)})
        await websocket.close()
