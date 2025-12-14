#!/bin/bash
#
# deploy.sh - Deploy trading bot to VPS
#
# Usage: ./deploy.sh [paper|live]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="/opt/trading-bot"
BACKUP_DIR="/opt/trading-bot-backups/$(date +%Y%m%d-%H%M%S)"
TRADING_MODE=${1:-paper}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "🚀 Trading Bot Deployment"
echo "========================================="
echo ""
echo "Trading Mode: $TRADING_MODE"
echo "Timestamp: $(date)"
echo ""

# Validate trading mode
if [ "$TRADING_MODE" != "paper" ] && [ "$TRADING_MODE" != "live" ]; then
    echo -e "${RED}Error: Invalid trading mode '$TRADING_MODE'${NC}"
    echo "Usage: $0 [paper|live]"
    exit 1
fi

# Check if deployment directory exists
if [ ! -d "$DEPLOY_DIR" ]; then
    echo -e "${RED}Error: Deployment directory not found: $DEPLOY_DIR${NC}"
    exit 1
fi

# Create backup directory
echo "💾 Creating backup..."
mkdir -p "$BACKUP_DIR"

# Backup current deployment if it exists
if [ -d "$DEPLOY_DIR/docker-ib-gateway" ]; then
    cp -r "$DEPLOY_DIR"/* "$BACKUP_DIR/" || true
    echo -e "${GREEN}✅ Backup created at: $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}⚠️  No existing deployment to backup${NC}"
fi

echo ""
echo "⏸️  Stopping existing services..."
cd "$DEPLOY_DIR/docker-ib-gateway"

# Stop existing services gracefully
docker-compose down --timeout 30 || true
echo -e "${GREEN}✅ Services stopped${NC}"

echo ""
echo "🧹 Cleaning up old containers..."
docker container prune -f || true

echo ""
echo "🏗️  Building and starting services..."

# Build and start services
docker-compose build --no-cache
docker-compose up -d

echo -e "${GREEN}✅ Services started${NC}"

echo ""
echo "⏳ Waiting for services to initialize..."
sleep 10

echo ""
echo "🏥 Running health checks..."

# Run health check script
if [ -f "$SCRIPT_DIR/health-check.sh" ]; then
    bash "$SCRIPT_DIR/health-check.sh"
else
    echo -e "${YELLOW}⚠️  health-check.sh not found, skipping automated health checks${NC}"
    echo "Checking container status manually..."
    docker ps
fi

echo ""
echo "========================================="
echo -e "${GREEN}✅ DEPLOYMENT COMPLETED SUCCESSFULLY!${NC}"
echo "========================================="
echo ""
echo "Deployment Details:"
echo "  - Trading Mode: $TRADING_MODE"
echo "  - Backup Location: $BACKUP_DIR"
echo "  - Deployment Directory: $DEPLOY_DIR"
echo ""
echo "Access Points:"
echo "  - FastAPI Backend: http://localhost:8000"
echo "  - API Documentation: http://localhost:8000/docs"
echo "  - VNC (Gateway GUI): vnc://localhost:5900"
echo ""
echo "Useful Commands:"
echo "  - View logs: cd $DEPLOY_DIR/docker-ib-gateway && docker-compose logs -f"
echo "  - Check status: docker ps"
echo "  - Restart service: docker-compose restart <service-name>"
echo ""
