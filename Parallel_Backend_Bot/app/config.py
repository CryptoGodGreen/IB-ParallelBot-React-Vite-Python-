import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "appuser")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "apppass")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "appdb")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", 5433))

    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", 6379))

    # IBKR settings
    IB_HOST: str = os.getenv("IB_HOST", "host.docker.internal")
    IB_PORT: int = int(os.getenv("IB_PORT", 7497))
    IB_CLIENT_ID: int = int(os.getenv("IB_CLIENT_ID", 42))
    IB_STREAMING_CLIENT_ID: int = int(os.getenv("IB_STREAMING_CLIENT_ID", 100))
    IB_TRADING_CLIENT_ID: int = int(os.getenv("IB_TRADING_CLIENT_ID", 101))
    IB_RTH_DEFAULT: bool = os.getenv("IB_RTH_DEFAULT", "true").lower() == "true"
    IB_CONNECT_TIMEOUT: float = float(os.getenv("IB_CONNECT_TIMEOUT", 6.0))
    IB_RECONNECT_BACKOFF_SECONDS: float = float(os.getenv("IB_RECONNECT_BACKOFF_SECONDS", 3.0))
    IB_MARKETDATA_DELAY: float = float(os.getenv("IB_MARKETDATA_DELAY", 1.5))

settings = Settings()
