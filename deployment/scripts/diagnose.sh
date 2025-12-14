#!/bin/bash
#
# diagnose.sh - Diagnose trading bot deployment issues
#
# Usage: ./diagnose.sh
#

set +e  # Don't exit on errors - we want to collect all diagnostics

DEPLOY_DIR="/opt/trading-bot"
COMPOSE_FILE="$DEPLOY_DIR/docker-ib-gateway/docker-compose.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "🔍 Trading Bot Deployment Diagnostics"
echo "========================================="
echo ""

# Check if deployment directory exists
echo -e "${BLUE}1. Checking deployment directory...${NC}"
if [ -d "$DEPLOY_DIR" ]; then
    echo -e "${GREEN}✅ Deployment directory exists: $DEPLOY_DIR${NC}"
    ls -la "$DEPLOY_DIR"
else
    echo -e "${RED}❌ Deployment directory not found: $DEPLOY_DIR${NC}"
    exit 1
fi
echo ""

# Check docker-compose file
echo -e "${BLUE}2. Checking docker-compose file...${NC}"
if [ -f "$COMPOSE_FILE" ]; then
    echo -e "${GREEN}✅ docker-compose.yaml found${NC}"
else
    echo -e "${RED}❌ docker-compose.yaml not found at: $COMPOSE_FILE${NC}"
    exit 1
fi
echo ""

# Check .env file
echo -e "${BLUE}3. Checking .env file...${NC}"
if [ -f "$DEPLOY_DIR/docker-ib-gateway/.env" ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
    echo "Environment variables (redacted):"
    cat "$DEPLOY_DIR/docker-ib-gateway/.env" | sed 's/\(PASSWORD\|SECRET\|USERNAME\)=.*/\1=***REDACTED***/'
else
    echo -e "${RED}❌ .env file not found${NC}"
fi
echo ""

# Check running containers
echo -e "${BLUE}4. Checking running containers...${NC}"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Check container health
echo -e "${BLUE}5. Checking container health status...${NC}"
for container in ib-gateway postgres redis fastapi-app; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        health=$(docker inspect $container --format='{{.State.Health.Status}}' 2>/dev/null || echo "no healthcheck")
        status=$(docker inspect $container --format='{{.State.Status}}' 2>/dev/null)

        if [ "$health" = "healthy" ] || [ "$status" = "running" ]; then
            echo -e "${GREEN}✅ $container: $status (health: $health)${NC}"
        else
            echo -e "${RED}❌ $container: $status (health: $health)${NC}"
        fi
    else
        echo -e "${RED}❌ $container: not found${NC}"
    fi
done
echo ""

# Check network connectivity between containers
echo -e "${BLUE}6. Checking network connectivity...${NC}"
if docker ps | grep -q fastapi-app; then
    echo "Testing connectivity from fastapi-app to other services:"

    echo -n "  - postgres: "
    if docker exec fastapi-app ping -c 1 postgres >/dev/null 2>&1; then
        echo -e "${GREEN}✅ reachable${NC}"
    else
        echo -e "${RED}❌ unreachable${NC}"
    fi

    echo -n "  - redis: "
    if docker exec fastapi-app ping -c 1 redis >/dev/null 2>&1; then
        echo -e "${GREEN}✅ reachable${NC}"
    else
        echo -e "${RED}❌ unreachable${NC}"
    fi

    echo -n "  - gateway: "
    if docker exec fastapi-app ping -c 1 gateway >/dev/null 2>&1; then
        echo -e "${GREEN}✅ reachable${NC}"
    else
        echo -e "${RED}❌ unreachable${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  fastapi-app not running, skipping network tests${NC}"
fi
echo ""

# Check environment variables in fastapi-app
echo -e "${BLUE}7. Checking fastapi-app environment variables...${NC}"
if docker ps | grep -q fastapi-app; then
    docker exec fastapi-app env | grep -E '(POSTGRES|REDIS|IB_|JWT)' | sed 's/\(PASSWORD\|SECRET\)=.*/\1=***REDACTED***/' | sort
else
    echo -e "${YELLOW}⚠️  fastapi-app not running${NC}"
fi
echo ""

# Check PostgreSQL connection
echo -e "${BLUE}8. Testing PostgreSQL connection...${NC}"
if docker ps | grep -q postgres; then
    POSTGRES_USER=$(grep POSTGRES_USER "$DEPLOY_DIR/docker-ib-gateway/.env" | cut -d'=' -f2)
    POSTGRES_DB=$(grep POSTGRES_DB "$DEPLOY_DIR/docker-ib-gateway/.env" | cut -d'=' -f2)

    if docker exec postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL is accepting connections${NC}"

        # Test from fastapi-app
        if docker ps | grep -q fastapi-app; then
            echo "Testing from fastapi-app container:"
            if docker exec fastapi-app python3 -c "
import os, asyncpg, asyncio
async def test():
    try:
        conn = await asyncpg.connect(
            user=os.environ['POSTGRES_USER'],
            password=os.environ['POSTGRES_PASSWORD'],
            database=os.environ['POSTGRES_DB'],
            host='postgres',
            port=5432
        )
        print('✅ Database connection successful!')
        await conn.close()
    except Exception as e:
        print(f'❌ Database connection failed: {e}')
asyncio.run(test())
" 2>&1; then
                echo ""
            fi
        fi
    else
        echo -e "${RED}❌ PostgreSQL is not ready${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  postgres container not running${NC}"
fi
echo ""

# Check Redis connection
echo -e "${BLUE}9. Testing Redis connection...${NC}"
if docker ps | grep -q redis; then
    if docker exec redis redis-cli ping >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Redis is responding${NC}"
    else
        echo -e "${RED}❌ Redis is not responding${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  redis container not running${NC}"
fi
echo ""

# Check HTTP endpoints
echo -e "${BLUE}10. Testing HTTP endpoints...${NC}"
echo -n "  - FastAPI Health (/health): "
if curl -f http://localhost:8000/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ accessible${NC}"
else
    echo -e "${RED}❌ not accessible${NC}"
fi

echo -n "  - FastAPI Docs (/docs): "
if curl -f http://localhost:8000/docs >/dev/null 2>&1; then
    echo -e "${GREEN}✅ accessible${NC}"
else
    echo -e "${RED}❌ not accessible${NC}"
fi
echo ""

# Show recent logs for failed containers
echo -e "${BLUE}11. Recent logs from containers...${NC}"
for container in ib-gateway postgres redis fastapi-app; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        status=$(docker inspect $container --format='{{.State.Status}}' 2>/dev/null)
        health=$(docker inspect $container --format='{{.State.Health.Status}}' 2>/dev/null || echo "no healthcheck")

        if [ "$status" != "running" ] || [ "$health" = "unhealthy" ]; then
            echo ""
            echo -e "${RED}=== $container (Status: $status, Health: $health) ===${NC}"
            docker logs $container --tail 50 2>&1
        fi
    fi
done
echo ""

# Final summary
echo "========================================="
echo -e "${BLUE}📊 Diagnostic Summary${NC}"
echo "========================================="
echo ""

ALL_HEALTHY=true

for container in ib-gateway postgres redis fastapi-app; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        health=$(docker inspect $container --format='{{.State.Health.Status}}' 2>/dev/null || echo "no healthcheck")

        if [ "$health" = "healthy" ]; then
            echo -e "${GREEN}✅ $container is healthy${NC}"
        elif docker ps --format '{{.Names}}' | grep -q "^${container}$" && [ "$health" = "no healthcheck" ]; then
            echo -e "${YELLOW}⚠️  $container is running (no healthcheck defined)${NC}"
        else
            echo -e "${RED}❌ $container is NOT healthy (status: $health)${NC}"
            ALL_HEALTHY=false
        fi
    else
        echo -e "${RED}❌ $container is NOT running${NC}"
        ALL_HEALTHY=false
    fi
done

echo ""
if [ "$ALL_HEALTHY" = true ]; then
    echo -e "${GREEN}✅ All services are healthy!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some services are unhealthy. Check the logs above for details.${NC}"
    echo ""
    echo "Common fixes:"
    echo "  1. Check GitHub Secrets are correctly set"
    echo "  2. Verify .env file has correct values"
    echo "  3. Check container logs: docker logs <container-name>"
    echo "  4. Restart services: cd $DEPLOY_DIR/docker-ib-gateway && docker-compose restart"
    echo "  5. Full rebuild: cd $DEPLOY_DIR/docker-ib-gateway && docker-compose down && docker-compose up -d --build"
    exit 1
fi
