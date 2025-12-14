#!/bin/bash
#
# check-gateway.sh - Detailed IB Gateway diagnostics
#

echo "========================================="
echo "🔍 IB Gateway Detailed Diagnostics"
echo "========================================="
echo ""

# Check container status
echo "1. Container Status:"
docker ps -a | grep -E "NAMES|gateway"
echo ""

# Check if Java process is running
echo "2. Java Process Check:"
docker exec ib-gateway ps aux | grep -i java || echo "❌ No Java process found"
echo ""

# Check listening ports
echo "3. Listening Ports in Gateway Container:"
docker exec ib-gateway netstat -tuln 2>/dev/null | grep -E "Proto|LISTEN" || \
docker exec ib-gateway ss -tuln 2>/dev/null | grep -E "State|LISTEN" || \
echo "⚠️  Cannot check ports (netstat/ss not available)"
echo ""

# Check if API ports are open
echo "4. Checking Specific API Ports:"
for port in 4001 4002; do
    echo -n "  Port $port: "
    if docker exec ib-gateway netstat -tuln 2>/dev/null | grep -q ":$port "; then
        echo "✅ LISTENING"
    elif docker exec ib-gateway ss -tuln 2>/dev/null | grep -q ":$port "; then
        echo "✅ LISTENING"
    else
        echo "❌ NOT LISTENING"
    fi
done
echo ""

# Check last 100 lines of gateway logs
echo "5. Recent IB Gateway Logs (last 100 lines):"
echo "-------------------------------------------"
docker logs ib-gateway --tail 100
echo ""

# Check IB Gateway configuration
echo "6. IB Gateway Configuration Files:"
echo "-------------------------------------------"
echo "Checking config.ini for API settings..."
docker exec ib-gateway cat /opt/ibc/config.ini 2>/dev/null | grep -E "^[^#]" | grep -v "^$" || echo "Cannot read config.ini"
echo ""

# Check if VNC is accessible (another sign gateway is running)
echo "7. VNC Server Status:"
echo -n "  Port 5900 (VNC): "
if docker exec ib-gateway netstat -tuln 2>/dev/null | grep -q ":5900 "; then
    echo "✅ LISTENING"
elif docker exec ib-gateway ss -tuln 2>/dev/null | grep -q ":5900 "; then
    echo "✅ LISTENING"
else
    echo "❌ NOT LISTENING"
fi
echo ""

# Test connection from FastAPI container
echo "8. Connection Test from FastAPI Container:"
docker exec fastapi-app sh -c '
import socket
import sys

def test_port(host, port):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception as e:
        return False

ports = [4001, 4002]
for port in ports:
    if test_port("gateway", port):
        print(f"  ✅ gateway:{port} - Connection successful")
    else:
        print(f"  ❌ gateway:{port} - Connection refused")
' 2>/dev/null || echo "❌ Python test failed"
echo ""

# Check environment variables
echo "9. Environment Variables in Gateway:"
docker exec ib-gateway env | grep -E "(TRADING_MODE|IB_)" | sed 's/PASSWORD=.*/PASSWORD=***/'
echo ""

echo "========================================="
echo "📊 Analysis"
echo "========================================="
echo ""

# Analyze if ports are listening
PORTS_OK=false
if docker exec ib-gateway netstat -tuln 2>/dev/null | grep -q ":4002 \|:4001 "; then
    PORTS_OK=true
elif docker exec ib-gateway ss -tuln 2>/dev/null | grep -q ":4002 \|:4001 "; then
    PORTS_OK=true
fi

if [ "$PORTS_OK" = true ]; then
    echo "✅ IB Gateway is listening on API ports"
    echo ""
    echo "If FastAPI still can't connect, check:"
    echo "  1. Docker network configuration"
    echo "  2. Firewall rules within containers"
    echo "  3. API settings in IB Gateway config"
else
    echo "❌ IB Gateway is NOT listening on API ports"
    echo ""
    echo "Possible causes:"
    echo "  1. Gateway is still starting up (wait 1-2 minutes)"
    echo "  2. Gateway crashed during startup (check logs above)"
    echo "  3. API not enabled in configuration"
    echo "  4. Wrong trading mode or credentials"
    echo ""
    echo "Try:"
    echo "  1. Wait 2 minutes and run this script again"
    echo "  2. Check gateway logs: docker logs ib-gateway | tail -50"
    echo "  3. Restart gateway: docker-compose restart ib-gateway"
    echo "  4. Check VNC to see GUI: vnc://localhost:5900 (password: test)"
fi
