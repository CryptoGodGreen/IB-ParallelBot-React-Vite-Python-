from .health import router as health_router
from .cache import router as cache_router
from .users import router as users_router
from .chart import router as charts_router
from .orders import router as orders_router
from .bot_router import router as bot_router

__all__ = ["health_router", "cache_router", "users_router", "charts_router", "orders_router", "bot_router"]
