import os
import json
import logging

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
SQL_LOG_LEVEL = os.getenv("SQL_LOG_LEVEL", "WARNING").upper()
LOG_FORMAT = os.getenv("LOG_FORMAT", "text").lower()

class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "level": record.levelname,
            "time": self.formatTime(record, self.datefmt),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)

TEXT_FORMATTER = {
    "format": "[%(levelname)s] %(asctime)s - %(name)s - %(message)s",
}

JSON_FORMATTER = {
    "()": JsonFormatter,
}

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": TEXT_FORMATTER if LOG_FORMAT == "text" else JSON_FORMATTER,
    },
    "loggers": {
        # Enable uvicorn logs temporarily for debugging
        "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
    "uvicorn.error": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "uvicorn.access": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "sqlalchemy": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "sqlalchemy.engine": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "sqlalchemy.pool": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "sqlalchemy.orm": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "parallel_bot": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
        "app": {"handlers": ["default"], "level": "INFO", "propagate": False},
    "app.api": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.api.udf": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.routes": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.utils": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.services": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.services.streaming_service": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.utils.ib_client": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    "app.utils.ib_interface": {"handlers": ["default"], "level": "CRITICAL", "propagate": False},
    # Only enable bot service logs
    "app.services.bot_service": {"handlers": ["default"], "level": "INFO", "propagate": False},
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
        },
    }
}
