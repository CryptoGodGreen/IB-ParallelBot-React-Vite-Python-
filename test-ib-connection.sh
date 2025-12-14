#!/bin/bash
#
# test-ib-connection.sh - Test IB Gateway connectivity from FastAPI container
#
# Usage: ./test-ib-connection.sh
#

echo "========================================="
echo "🔍 IB Gateway Connection Diagnostics"
echo "========================================="
echo ""

# Check if containers are running
echo "1. Checking container status..."
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAME|gateway|fastapi"
echo ""

# Check IB Gateway logs
echo "2. Recent IB Gateway logs (last 30 lines)..."
echo ""
docker logs ib-gateway --tail 30 2>&1 | grep -v "^$"
echo ""

# Check environment variables in FastAPI
echo "3. IB connection settings in fastapi-app..."
echo ""
docker exec fastapi-app env | grep -E '^IB_' | sort
echo ""

# Test network connectivity from FastAPI to Gateway
echo "4. Testing network connectivity from fastapi-app to gateway..."
echo ""
echo -n "  - Ping gateway: "
if docker exec fastapi-app ping -c 2 gateway >/dev/null 2>&1; then
    echo "✅ Success"
else
    echo "❌ Failed"
fi

echo -n "  - Gateway hostname resolves to: "
docker exec fastapi-app getent hosts gateway 2>/dev/null || echo "❌ Cannot resolve"
echo ""

# Check if IB Gateway is listening on the port
echo "5. Checking if IB Gateway is listening on port 4002..."
echo ""
docker exec ib-gateway netstat -tuln 2>/dev/null | grep -E "4001|4002" || echo "⚠️  netstat not available in gateway container"
echo ""

# Check FastAPI logs for connection attempts
echo "6. FastAPI logs related to IB connection (last 50 lines)..."
echo ""
docker logs fastapi-app --tail 50 2>&1 | grep -i -E "(ibkr|gateway|connect|ib_)" || echo "No IB connection logs found"
echo ""

# Test connection from Python
echo "7. Testing IB connection from Python inside fastapi-app..."
echo ""
docker exec fastapi-app python3 -c "
import os
import sys
import asyncio
from ib_async import IB

async def test_connection():
    ib = IB()

    host = os.environ.get('IB_HOST', 'gateway')
    port = int(os.environ.get('IB_PORT', '4002'))
    client_id = int(os.environ.get('IB_CLIENT_ID', '42'))
    timeout = int(os.environ.get('IB_CONNECT_TIMEOUT', '6'))

    print(f'🔌 Attempting connection to {host}:{port} (clientId={client_id}, timeout={timeout}s)')
    print('')

    try:
        await ib.connectAsync(host, port, clientId=client_id, timeout=timeout)
        print('✅ Connection successful!')
        print(f'   Server version: {ib.serverVersion()}')
        print(f'   Connection time: {ib.client.connTime}')
        print(f'   Managed accounts: {ib.managedAccounts()}')

        # Try a simple request
        print('')
        print('🔍 Testing contract details request...')
        from ib_async import Stock
        contract = Stock('AAPL', 'SMART', 'USD')
        details = await ib.reqContractDetailsAsync(contract)
        if details:
            print(f'✅ Contract details retrieved: {len(details)} results')
        else:
            print('⚠️  No contract details returned')

        ib.disconnect()
        print('')
        print('✅ Disconnected successfully')
        return True
    except asyncio.TimeoutError:
        print(f'❌ Connection timeout after {timeout}s')
        print('   Possible causes:')
        print('   - IB Gateway not fully started')
        print('   - Port not exposed correctly')
        print('   - Network connectivity issue')
        return False
    except ConnectionRefusedError:
        print(f'❌ Connection refused to {host}:{port}')
        print('   Possible causes:')
        print('   - IB Gateway not listening on this port')
        print('   - Wrong port number (paper=4002, live=4001)')
        print('   - API not enabled in IB Gateway')
        return False
    except Exception as e:
        print(f'❌ Connection failed: {type(e).__name__}: {e}')
        return False

try:
    result = asyncio.run(test_connection())
    sys.exit(0 if result else 1)
except Exception as e:
    print(f'❌ Test script failed: {e}')
    sys.exit(1)
" 2>&1
PYTHON_TEST_RESULT=$?

echo ""
echo "========================================="
echo "📊 Summary"
echo "========================================="
echo ""

if [ $PYTHON_TEST_RESULT -eq 0 ]; then
    echo "✅ IB Gateway connection is working!"
    echo ""
    echo "If FastAPI isn't showing activity, check:"
    echo "  1. Application startup logs: docker logs fastapi-app"
    echo "  2. Streaming service might have failed to start"
    echo "  3. Bot service might have failed to start"
else
    echo "❌ IB Gateway connection is NOT working"
    echo ""
    echo "Common fixes:"
    echo "  1. Ensure IB Gateway container is fully started (check logs)"
    echo "  2. Verify .env file has correct IB_PORT (4002 for paper, 4001 for live)"
    echo "  3. Check IB Gateway API is enabled (should be by default)"
    echo "  4. Restart containers: docker-compose down && docker-compose up -d"
fi
echo ""
