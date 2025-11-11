#!/usr/bin/env python3
"""
Test script to check if an option contract exists in IBKR
"""
import asyncio
import sys
import os

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Override IB_HOST if running directly (not in Docker)
if os.getenv("IB_HOST") == "host.docker.internal":
    # If running directly, try localhost instead
    os.environ["IB_HOST"] = "127.0.0.1"
    print(f"⚠️  Running outside Docker, using IB_HOST=127.0.0.1")
    print(f"⚠️  Make sure IBKR TWS/Gateway is running and API is enabled")
    print(f"⚠️  Default port: 7497 (paper) or 7496 (live)\n")

# Use a unique client ID for testing (different from backend)
os.environ["IB_CLIENT_ID"] = "999"

from app.utils.ib_client import ib_client
from app.config import settings
from ib_async import Option

async def test_option_contract(symbol: str, expiry: str, strike: float, right: str = 'P'):
    """Test if an option contract exists"""
    try:
        print(f"\n🔍 Testing option contract:")
        print(f"   Symbol: {symbol}")
        print(f"   Expiry: {expiry}")
        print(f"   Strike: ${strike}")
        print(f"   Right: {right}")
        print(f"   Exchange: SMART")
        
        # Connect to IBKR
        print(f"\n📡 Connecting to IBKR at {settings.IB_HOST}:{settings.IB_PORT}...")
        print(f"   (Make sure TWS/Gateway is running with API enabled)")
        await ib_client.connect()
        print("✅ Connected to IBKR")
        
        # Create option contract
        contract = Option(
            symbol=symbol,
            lastTradeDateOrContractMonth=expiry,
            strike=strike,
            right=right,
            exchange='SMART'
        )
        
        print(f"\n📋 Created contract: {contract}")
        
        # Try to qualify the contract
        print("\n🔍 Attempting to qualify contract...")
        details_list = await ib_client.ib.reqContractDetailsAsync(contract)
        
        if details_list and len(details_list) > 0:
            print(f"✅ Contract EXISTS! Found {len(details_list)} matching contract(s)")
            for i, details in enumerate(details_list):
                print(f"\n   Contract {i+1}:")
                print(f"   - Symbol: {details.contract.symbol}")
                print(f"   - Expiry: {details.contract.lastTradeDateOrContractMonth}")
                print(f"   - Strike: ${details.contract.strike}")
                print(f"   - Right: {details.contract.right}")
                print(f"   - Exchange: {details.contract.exchange}")
                print(f"   - ConId: {details.contract.conId}")
                if hasattr(details, 'marketName'):
                    print(f"   - Market Name: {details.marketName}")
            return True
        else:
            print("❌ Contract DOES NOT EXIST - No contract details returned")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Disconnect
        if ib_client.ib.isConnected():
            await ib_client.disconnect()
            print("\n📡 Disconnected from IBKR")

async def test_multiple_expiries(symbol: str, strike: float, right: str = 'P', expiries: list = None):
    """Test multiple expiration dates to find which ones have the strike"""
    if expiries is None:
        # Get option chain first
        print(f"\n📡 Getting option chain for {symbol}...")
        await ib_client.connect()
        option_chain = await ib_client.get_option_chain(symbol)
        
        if not option_chain:
            print("❌ Could not get option chain")
            return
        
        expiries = option_chain.get('expiration_dates', [])[:10]  # Test first 10
        print(f"📋 Found {len(expiries)} expiration dates, testing first 10...")
    
    results = []
    for expiry in expiries:
        expiry_str = str(expiry)
        print(f"\n{'='*60}")
        exists = await test_option_contract(symbol, expiry_str, strike, right)
        results.append((expiry_str, exists))
        await asyncio.sleep(0.5)  # Small delay between requests
    
    print(f"\n{'='*60}")
    print("\n📊 SUMMARY:")
    print(f"{'Expiry':<12} {'Exists':<10}")
    print("-" * 25)
    for expiry, exists in results:
        status = "✅ YES" if exists else "❌ NO"
        print(f"{expiry:<12} {status:<10}")
    
    # Find which dates have the contract
    valid_dates = [expiry for expiry, exists in results if exists]
    if valid_dates:
        print(f"\n✅ Valid expiration dates for strike ${strike}: {valid_dates}")
    else:
        print(f"\n❌ No valid expiration dates found for strike ${strike}")

async def main():
    """Main test function"""
    if len(sys.argv) < 4:
        print("Usage: python test_option_contract.py <symbol> <expiry> <strike> [right]")
        print("   or: python test_option_contract.py <symbol> <strike> [right] --test-multiple")
        print("\nExamples:")
        print("  python test_option_contract.py AAPL 20251212 257.5 P")
        print("  python test_option_contract.py AAPL 257.5 P --test-multiple")
        sys.exit(1)
    
    symbol = sys.argv[1].upper()
    
    if '--test-multiple' in sys.argv:
        # Test multiple expiries
        strike = float(sys.argv[2])
        right = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '--test-multiple' else 'P'
        await test_multiple_expiries(symbol, strike, right)
    else:
        # Test single contract
        expiry = sys.argv[2]
        strike = float(sys.argv[3])
        right = sys.argv[4] if len(sys.argv) > 4 else 'P'
        await test_option_contract(symbol, expiry, strike, right)

if __name__ == "__main__":
    asyncio.run(main())

