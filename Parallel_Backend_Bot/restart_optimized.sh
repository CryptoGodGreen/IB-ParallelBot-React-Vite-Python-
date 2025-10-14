#!/bin/bash

echo "🚀 Applying Docker networking optimizations..."
echo ""

# Stop the containers
echo "⏸️  Stopping containers..."
docker-compose down

# Remove the old network
echo "🗑️  Removing old network..."
docker network rm IB-ParallelBot-React-Vite-Python-_appnet 2>/dev/null || true

# Recreate containers with new network settings
echo "🔄 Recreating containers with optimized network..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check status
echo ""
echo "📊 Container status:"
docker-compose ps

echo ""
echo "🔍 Testing database connection speed..."
docker exec fastapi-app python -c "
import time
import asyncio
from app.db.postgres import engine

async def test_connection():
    start = time.time()
    async with engine.begin() as conn:
        await conn.execute('SELECT 1')
    elapsed = (time.time() - start) * 1000
    print(f'✅ Database connection test: {elapsed:.2f}ms')

asyncio.run(test_connection())
" 2>/dev/null || echo "⚠️  Backend not ready yet, wait a moment and check logs"

echo ""
echo "✅ Optimization complete!"
echo ""
echo "📝 Check backend logs with: docker-compose logs -f fastapi-app"
echo "🔍 Look for these log lines:"
echo "   - '🔍 Resolved postgres to X.X.X.X'"
echo "   - '✅ Database engine created...'"
echo "   - '⚡ Chart query for ID X took Y.XXms'"
