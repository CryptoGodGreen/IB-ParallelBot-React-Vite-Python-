#!/bin/bash
#
# health-check.sh - Verify all services are healthy
#
# This script checks the health status of all services in the trading bot stack
# Exit 0 if all healthy, Exit 1 if any service is unhealthy
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="/opt/trading-bot/docker-ib-gateway"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "🏥 Trading Bot Health Check"
echo "========================================="
echo ""

# Change to deployment directory
cd "$DEPLOY_DIR"

# Function to check Docker container health
check_container_health() {
    local container_name=$1
    local max_retries=${2:-30}
    local retry_delay=${3:-10}

    echo -n "Checking $container_name... "

    for i in $(seq 1 $max_retries); do
        # Check if container exists
        if ! docker inspect "$container_name" >/dev/null 2>&1; then
            echo -e "${RED}FAILED${NC}"
            echo "  Container $container_name does not exist"
            return 1
        fi

        # Check health status
        health_status=$(docker inspect "$container_name" --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")

        if [ "$health_status" = "healthy" ]; then
            echo -e "${GREEN}HEALTHY${NC}"
            return 0
        fi

        # Check if container is running at all
        is_running=$(docker inspect "$container_name" --format='{{.State.Running}}' 2>/dev/null)
        if [ "$is_running" != "true" ]; then
            echo -e "${RED}FAILED${NC}"
            echo "  Container is not running"
            docker logs "$container_name" --tail 20
            return 1
        fi

        # Still waiting for healthy status
        if [ $i -eq 1 ]; then
            echo ""
        fi
        echo "  Attempt $i/$max_retries: Status is '$health_status', retrying in ${retry_delay}s..."
        sleep $retry_delay
    done

    echo -e "${RED}TIMEOUT${NC}"
    echo "  Container failed to become healthy after $max_retries attempts"
    docker logs "$container_name" --tail 50
    return 1
}

# Function to check HTTP endpoint
check_http_endpoint() {
    local endpoint=$1
    local max_retries=${2:-20}
    local retry_delay=${3:-5}

    echo -n "Checking $endpoint... "

    for i in $(seq 1 $max_retries); do
        if curl -f -s "$endpoint" >/dev/null 2>&1; then
            echo -e "${GREEN}RESPONSIVE${NC}"
            return 0
        fi

        if [ $i -eq 1 ]; then
            echo ""
        fi
        echo "  Attempt $i/$max_retries: Not responding, retrying in ${retry_delay}s..."
        sleep $retry_delay
    done

    echo -e "${RED}TIMEOUT${NC}"
    echo "  Endpoint failed to respond after $max_retries attempts"
    return 1
}

# Check all services
echo "📊 Service Health Checks:"
echo "-------------------------"

FAILED=0

# 1. IB Gateway (most critical, longest timeout)
if ! check_container_health "ib-gateway" 30 10; then
    FAILED=1
fi

# 2. PostgreSQL
if ! check_container_health "postgres" 15 5; then
    FAILED=1
fi

# 3. Redis
if ! check_container_health "redis" 10 3; then
    FAILED=1
fi

# 4. FastAPI Backend (check container health first, then HTTP)
if ! check_container_health "fastapi-app" 20 5; then
    FAILED=1
else
    # Also check HTTP endpoint
    if ! check_http_endpoint "http://localhost:8000/docs" 10 5; then
        FAILED=1
    fi
fi

echo ""
echo "========================================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All services are healthy!${NC}"
    echo "========================================="
    echo ""
    echo "Running Containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    exit 0
else
    echo -e "${RED}❌ One or more services failed health checks${NC}"
    echo "========================================="
    echo ""
    echo "Container Status:"
    docker ps -a
    echo ""
    exit 1
fi
