import math
import hashlib
from typing import Tuple, Dict
from app.utils.ib_client import IBClient
from app.db.models import LegType

def round_to_tick(price: float, tick: float) -> float:
    return round(round(price / tick) * tick, 6)

def enforce_min_size(qty: int, min_size: int) -> int:
    return max(qty, min_size)

def compute_internal_key(user_id: int, symbol: str, entry: float, qty: int, tp: float, sl_stop: float, tif: str, rth: bool) -> str:
    s = f"{user_id}:{symbol}:{entry}:{qty}:{tp}:{sl_stop}:{tif}:{int(rth)}"
    return hashlib.sha1(s.encode()).hexdigest()

async def build_bracket(symbol: str, entry_price: float, tp_price: float, sl_stop: float, size: int,
                        tif: str, rth_only: bool) -> Dict:
    """
    Computes correct tick rounding & min size, and returns plan for:
    - parent LIMIT entry
    - child TP LIMIT
    - child SL (Stop-Limit; limit = stop +/- small epsilon)
    """
    cli = IBClient.instance()
    await cli.qualify_stock(symbol)
    specs = cli.get_specs(symbol) or {"min_tick": 0.01, "min_size": 1}
    tick, min_size = specs["min_tick"], specs["min_size"]

    size = enforce_min_size(size, min_size)

    entry_r = round_to_tick(entry_price, tick)
    tp_r = round_to_tick(tp_price, tick)
    # set stop-limit's limit slightly worse than stop to increase fill odds
    sl_stop_r = round_to_tick(sl_stop, tick)
    epsilon = 2 * tick
    if sl_stop < entry_price:
        sl_limit_r = round_to_tick(sl_stop_r - epsilon, tick)
    else:
        sl_limit_r = round_to_tick(sl_stop_r + epsilon, tick)

    plan = {
        "symbol": symbol,
        "size": size,
        "tif": tif,
        "rth_only": rth_only,
        "legs": [
            {"type": LegType.entry.value, "action": "BUY" if tp_r > entry_r else "SELL", "price": float(entry_r)},
            {"type": LegType.tp.value,    "action": "SELL" if tp_r > entry_r else "BUY", "price": float(tp_r)},
            {"type": LegType.sl.value,    "action": "SELL" if tp_r > entry_r else "BUY",
             "stop": float(sl_stop_r), "limit": float(sl_limit_r)},
        ]
    }
    return plan
