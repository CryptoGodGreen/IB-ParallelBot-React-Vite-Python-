#!/bin/bash
#
# view-logs.sh - Quick log viewer for trading bot containers
#
# Usage:
#   ./view-logs.sh [container-name] [--follow]
#
# Examples:
#   ./view-logs.sh fastapi-app          # Show last 100 lines
#   ./view-logs.sh fastapi-app --follow # Follow logs in real-time
#   ./view-logs.sh                      # Show all containers
#

DEPLOY_DIR="/opt/trading-bot/docker-ib-gateway"
CONTAINER=${1:-all}
FOLLOW=${2}

if [ "$CONTAINER" = "all" ]; then
    echo "=== All Container Logs ==="
    echo ""
    cd "$DEPLOY_DIR" && docker-compose logs --tail=50
elif [ "$FOLLOW" = "--follow" ] || [ "$FOLLOW" = "-f" ]; then
    echo "Following logs for $CONTAINER (Ctrl+C to exit)..."
    docker logs -f "$CONTAINER"
else
    echo "Last 100 lines from $CONTAINER:"
    docker logs "$CONTAINER" --tail=100
fi
