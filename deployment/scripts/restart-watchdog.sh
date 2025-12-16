#!/bin/bash
# ============================================
# Trading Bot Restart Watchdog
# ============================================
#
# This script monitors Redis for restart requests and executes
# docker-compose restart when a request is detected.
#
# The FastAPI backend sets a flag in Redis when the user requests
# a restart, and this watchdog script picks it up and executes the
# actual docker commands (which cannot be done from inside the container).
#
# Usage:
#   ./restart-watchdog.sh
#
# Systemd service:
#   sudo systemctl start trading-bot-watchdog
#   sudo systemctl status trading-bot-watchdog
#
# ============================================

# Configuration
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
DOCKER_COMPOSE_DIR="${DOCKER_COMPOSE_DIR:-/opt/trading-bot/Parallel_Backend_Bot}"
CHECK_INTERVAL=5  # Check every 5 seconds
RESTART_KEY="system:restart:requested"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} ⚠️  $1"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} ❌ $1"
}

# Check if Redis is accessible
check_redis() {
    if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
        return 1
    fi
    return 0
}

# Main watchdog loop
log "🐕 Trading Bot Restart Watchdog started"
log "   Monitoring Redis at ${REDIS_HOST}:${REDIS_PORT}"
log "   Docker Compose directory: ${DOCKER_COMPOSE_DIR}"
log "   Check interval: ${CHECK_INTERVAL}s"

while true; do
    # Check if Redis is accessible
    if ! check_redis; then
        log_warning "Redis is not accessible at ${REDIS_HOST}:${REDIS_PORT}"
        sleep "$CHECK_INTERVAL"
        continue
    fi

    # Check for restart flag
    RESTART_REQUEST=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$RESTART_KEY" 2>/dev/null)

    if [ -n "$RESTART_REQUEST" ] && [ "$RESTART_REQUEST" != "(nil)" ]; then
        log "🔄 Restart request detected!"
        log "   Request data: $RESTART_REQUEST"

        # Delete the restart flag immediately to prevent duplicate restarts
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" DEL "$RESTART_KEY" > /dev/null 2>&1
        log "   Cleared restart flag from Redis"

        # Execute docker-compose restart
        log "   Changing to directory: $DOCKER_COMPOSE_DIR"
        if [ ! -d "$DOCKER_COMPOSE_DIR" ]; then
            log_error "Docker Compose directory not found: $DOCKER_COMPOSE_DIR"
            sleep "$CHECK_INTERVAL"
            continue
        fi

        cd "$DOCKER_COMPOSE_DIR" || {
            log_error "Failed to change to directory: $DOCKER_COMPOSE_DIR"
            sleep "$CHECK_INTERVAL"
            continue
        }

        log "   Executing: docker-compose restart"
        if docker-compose restart; then
            log "✅ Container restart completed successfully"
        else
            log_error "Docker compose restart failed (exit code: $?)"
        fi

        # Wait a bit before resuming checks
        log "   Waiting 10 seconds before resuming monitoring..."
        sleep 10
    fi

    # Sleep before next check
    sleep "$CHECK_INTERVAL"
done
