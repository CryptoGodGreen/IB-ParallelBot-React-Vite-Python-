#!/bin/bash
#
# debug-fastapi.sh - Debug FastAPI container startup issues
#

echo "========================================="
echo "🔍 FastAPI Container Debug"
echo "========================================="
echo ""

# Check all container statuses
echo "1. All Container Status:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.State}}"
echo ""

# Check if fastapi-app exists at all
echo "2. FastAPI Container Details:"
if docker ps -a --format '{{.Names}}' | grep -q "^fastapi-app$"; then
    docker inspect fastapi-app --format='
Container: {{.Name}}
State: {{.State.Status}}
Exit Code: {{.State.ExitCode}}
Error: {{.State.Error}}
Started At: {{.State.StartedAt}}
Finished At: {{.State.FinishedAt}}
Health: {{.State.Health.Status}}
'
    echo ""
else
    echo "❌ fastapi-app container does not exist!"
    echo ""
fi

# Check docker-compose status
echo "3. Docker Compose Status:"
cd /mnt/c/Users/nikox/Desktop/Repos/Parallelbot2.0/docker-ib-gateway
docker-compose ps
echo ""

# Check FastAPI logs (all of them)
echo "4. FastAPI Container Logs (ALL):"
echo "-------------------------------------------"
docker logs fastapi-app 2>&1 || echo "❌ Cannot retrieve logs (container may not exist or never started)"
echo ""

# Check if build succeeded
echo "5. Checking if FastAPI image exists:"
docker images | grep -E "IMAGE|fastapi|parallel" || echo "No FastAPI related images found"
echo ""

# Check docker-compose config for syntax errors
echo "6. Validating docker-compose.yaml:"
cd /mnt/c/Users/nikox/Desktop/Repos/Parallelbot2.0/docker-ib-gateway
docker-compose config >/dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ docker-compose.yaml syntax is valid"
else
    echo "❌ docker-compose.yaml has syntax errors:"
    docker-compose config 2>&1
fi
echo ""

# Check if dependencies are healthy
echo "7. Dependency Status:"
for dep in postgres redis ib-gateway; do
    if docker ps --format '{{.Names}}' | grep -q "^${dep}$"; then
        health=$(docker inspect ${dep} --format='{{.State.Health.Status}}' 2>/dev/null || echo "no healthcheck")
        echo "  ${dep}: ✅ running (health: ${health})"
    else
        echo "  ${dep}: ❌ not running"
    fi
done
echo ""

# Try to manually start the container
echo "8. Attempting manual container start:"
echo "Running: docker-compose up fastapi-app (detached)"
cd /mnt/c/Users/nikox/Desktop/Repos/Parallelbot2.0/docker-ib-gateway
docker-compose up -d fastapi-app 2>&1
echo ""

echo "Waiting 5 seconds..."
sleep 5
echo ""

echo "Container status after manual start:"
docker ps -a | grep fastapi-app || echo "Container still not visible"
echo ""

if docker ps -a --format '{{.Names}}' | grep -q "^fastapi-app$"; then
    echo "Latest logs after manual start:"
    docker logs fastapi-app --tail 50 2>&1
fi

echo ""
echo "========================================="
echo "📊 Analysis"
echo "========================================="

# Determine the issue
if ! docker ps -a --format '{{.Names}}' | grep -q "^fastapi-app$"; then
    echo ""
    echo "❌ ISSUE: Container was never created"
    echo ""
    echo "Possible causes:"
    echo "  1. Docker Compose build failed"
    echo "  2. Syntax error in docker-compose.yaml"
    echo "  3. Dockerfile has errors"
    echo "  4. Missing required files"
    echo ""
    echo "Try:"
    echo "  cd docker-ib-gateway"
    echo "  docker-compose build fastapi-app --no-cache"
elif docker ps --format '{{.Names}}' | grep -q "^fastapi-app$"; then
    echo ""
    echo "✅ Container is running now!"
else
    exit_code=$(docker inspect fastapi-app --format='{{.State.ExitCode}}' 2>/dev/null)
    echo ""
    echo "❌ ISSUE: Container exists but is not running (Exit code: ${exit_code})"
    echo ""
    echo "Check the logs above for the error message."
    echo ""
    echo "Common issues:"
    echo "  - Python import errors (missing dependencies)"
    echo "  - Database connection failures"
    echo "  - Missing environment variables"
    echo "  - Application crash on startup"
fi
echo ""
