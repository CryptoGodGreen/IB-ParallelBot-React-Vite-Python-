FROM python:3.11-slim

# Install system packages for timezone handling and other dependencies
RUN apt-get update && apt-get install -y \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Set default timezone to avoid issues with ib_async
ENV TZ=UTC

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Create a non-root user with UID 1000 to match host permissions
RUN groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

# Ensure the app directory is accessible by the appuser and set proper permissions
# Do this as root before switching to appuser
RUN chmod -R 755 /app && chown -R appuser:appuser /app

# Switch to non-root user for runtime
USER appuser

EXPOSE 8000

# Command can be overridden by docker-compose
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
