#!/bin/bash
#
# rollback.sh - Rollback to previous deployment
#
# Usage: ./rollback.sh [backup-directory]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="/opt/trading-bot"
BACKUP_BASE="/opt/trading-bot-backups"
BACKUP_DIR="$1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "🔄 Trading Bot Rollback"
echo "========================================="
echo ""

# If no backup directory specified, find the latest
if [ -z "$BACKUP_DIR" ]; then
    echo "🔍 Finding latest backup..."
    LATEST=$(ls -t "$BACKUP_BASE" 2>/dev/null | head -1)

    if [ -z "$LATEST" ]; then
        echo -e "${RED}Error: No backups found in $BACKUP_BASE${NC}"
        exit 1
    fi

    BACKUP_DIR="$BACKUP_BASE/$LATEST"
    echo -e "${BLUE}Found latest backup: $LATEST${NC}"
else
    # If relative path provided, make it absolute
    if [[ "$BACKUP_DIR" != /* ]]; then
        BACKUP_DIR="$BACKUP_BASE/$BACKUP_DIR"
    fi
fi

# Verify backup exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}Error: Backup directory not found: $BACKUP_DIR${NC}"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_BASE" 2>/dev/null || echo "  (none)"
    exit 1
fi

echo "Backup Location: $BACKUP_DIR"
echo "Timestamp: $(date)"
echo ""

# Confirm rollback
if [ -t 0 ]; then
    # Interactive terminal
    read -p "⚠️  This will stop current services and restore from backup. Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Rollback cancelled"
        exit 0
    fi
else
    # Non-interactive (CI/CD)
    echo "⚠️  Running in non-interactive mode, proceeding with rollback..."
fi

echo ""
echo "⏸️  Stopping current deployment..."

# Stop current deployment
if [ -d "$DEPLOY_DIR/docker-ib-gateway" ]; then
    cd "$DEPLOY_DIR/docker-ib-gateway"
    docker-compose down --timeout 30 || true
    echo -e "${GREEN}✅ Current services stopped${NC}"
else
    echo -e "${YELLOW}⚠️  No active deployment found${NC}"
fi

echo ""
echo "🔄 Restoring from backup..."

# Remove current deployment
cd /opt
rm -rf "$DEPLOY_DIR"

# Check if backup is a tarball or directory
if [ -f "$BACKUP_DIR/backup.tar.gz" ]; then
    echo "Extracting tarball backup..."
    tar -xzf "$BACKUP_DIR/backup.tar.gz"
elif [ -d "$BACKUP_DIR/docker-ib-gateway" ]; then
    echo "Copying directory backup..."
    cp -r "$BACKUP_DIR" "$DEPLOY_DIR"
else
    echo -e "${RED}Error: Invalid backup format${NC}"
    echo "Expected either:"
    echo "  - $BACKUP_DIR/backup.tar.gz"
    echo "  - $BACKUP_DIR/docker-ib-gateway/"
    exit 1
fi

echo -e "${GREEN}✅ Backup restored${NC}"

echo ""
echo "▶️  Starting services..."

# Start services
cd "$DEPLOY_DIR/docker-ib-gateway"
docker-compose up -d

echo -e "${GREEN}✅ Services started${NC}"

echo ""
echo "⏳ Waiting for services to initialize..."
sleep 10

echo ""
echo "🏥 Running health checks..."

# Run health check script
if [ -f "$SCRIPT_DIR/health-check.sh" ]; then
    if bash "$SCRIPT_DIR/health-check.sh"; then
        echo ""
        echo "========================================="
        echo -e "${GREEN}✅ ROLLBACK COMPLETED SUCCESSFULLY!${NC}"
        echo "========================================="
    else
        echo ""
        echo "========================================="
        echo -e "${YELLOW}⚠️  ROLLBACK COMPLETED WITH WARNINGS${NC}"
        echo "========================================="
        echo ""
        echo "Some services may not be healthy."
        echo "Please check the logs and service status."
    fi
else
    echo -e "${YELLOW}⚠️  health-check.sh not found, skipping automated health checks${NC}"
    echo ""
    echo "Checking container status manually..."
    docker ps
    echo ""
    echo "========================================="
    echo -e "${GREEN}✅ ROLLBACK COMPLETED${NC}"
    echo "========================================="
    echo ""
    echo "⚠️  Please manually verify service health"
fi

echo ""
echo "Rollback Details:"
echo "  - Restored from: $BACKUP_DIR"
echo "  - Deployment Directory: $DEPLOY_DIR"
echo ""
echo "Useful Commands:"
echo "  - View logs: cd $DEPLOY_DIR/docker-ib-gateway && docker-compose logs -f"
echo "  - Check status: docker ps"
echo "  - Restart service: docker-compose restart <service-name>"
echo ""
