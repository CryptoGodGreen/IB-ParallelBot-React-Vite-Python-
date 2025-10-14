#!/bin/bash

echo "🔧 Applying database optimizations..."

# Check if PostgreSQL is running
if ! docker ps | grep -q postgres; then
    echo "❌ PostgreSQL container is not running. Please start it first."
    exit 1
fi

# Apply the index migration
echo "📊 Creating composite index..."
docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d tradingbot << SQL
CREATE INDEX IF NOT EXISTS idx_user_charts_user_id_id ON user_charts(user_id, id);
ANALYZE user_charts;
SELECT 'Index created successfully!' as status;
SQL

echo "✅ Database optimizations applied!"
echo ""
echo "🔄 Now restart your FastAPI backend to apply connection pool changes:"
echo "   1. Stop the current backend (Ctrl+C)"
echo "   2. Run: cd Parallel_Backend_Bot && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
