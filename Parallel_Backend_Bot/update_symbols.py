#!/usr/bin/env python3
"""
Script to update symbols in the symbol_info table.
Replaces old default symbols with new ones.

To run this script:
1. Inside Docker container:
   docker exec -it fastapi-app python3 update_symbols.py

2. Or use the SQL script directly:
   docker exec -i postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> < update_symbols.sql
"""
import asyncio
import sys
from sqlalchemy import select, delete
from app.db.postgres import AsyncSessionLocal
from app.models.market_data import SymbolInfo

# Old symbols to remove
OLD_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']

# New symbols to add
NEW_SYMBOLS = [
    {'symbol': 'NU', 'name': 'Nu Holdings Ltd.', 'description': 'Nu Holdings Ltd. Common Stock'},
    {'symbol': 'OSCR', 'name': 'Oscar Health, Inc.', 'description': 'Oscar Health, Inc. Common Stock'},
    {'symbol': 'JOBY', 'name': 'Joby Aviation, Inc.', 'description': 'Joby Aviation, Inc. Common Stock'},
    {'symbol': 'ACHR', 'name': 'Archer Aviation Inc.', 'description': 'Archer Aviation Inc. Common Stock'},
    {'symbol': 'SOFI', 'name': 'SoFi Technologies, Inc.', 'description': 'SoFi Technologies, Inc. Common Stock'},
    {'symbol': 'GME', 'name': 'GameStop Corp.', 'description': 'GameStop Corp. Common Stock'},
    {'symbol': 'SMCI', 'name': 'Super Micro Computer, Inc.', 'description': 'Super Micro Computer, Inc. Common Stock'},
]

async def update_symbols():
    """Update symbols in the database"""
    async with AsyncSessionLocal() as session:
        try:
            # Delete old symbols
            print("🗑️  Removing old symbols...")
            for symbol in OLD_SYMBOLS:
                result = await session.execute(
                    select(SymbolInfo).where(SymbolInfo.symbol == symbol.upper())
                )
                symbol_info = result.scalar_one_or_none()
                if symbol_info:
                    await session.delete(symbol_info)
                    print(f"   ✓ Deleted {symbol}")
                else:
                    print(f"   ⊘ {symbol} not found (already removed)")
            
            await session.commit()
            print("✅ Old symbols removed\n")
            
            # Add new symbols
            print("➕ Adding new symbols...")
            added_count = 0
            skipped_count = 0
            
            for symbol_data in NEW_SYMBOLS:
                symbol = symbol_data['symbol'].upper()
                
                # Check if symbol already exists
                result = await session.execute(
                    select(SymbolInfo).where(SymbolInfo.symbol == symbol)
                )
                existing = result.scalar_one_or_none()
                
                if existing:
                    print(f"   ⊘ {symbol} already exists, skipping")
                    skipped_count += 1
                    continue
                
                # Create new symbol info
                symbol_info = SymbolInfo(
                    symbol=symbol,
                    ticker=symbol,
                    name=symbol_data['name'],
                    description=symbol_data['description'],
                    exchange="SMART",
                    currency="USD",
                    min_tick=0.01,
                    min_size=1,
                    pricescale=100,
                    session="0930-1600",
                    timezone="America/New_York",
                    has_intraday="true",
                    has_daily="true",
                    has_weekly_and_monthly="true",
                    data_status="streaming"
                )
                
                session.add(symbol_info)
                print(f"   ✓ Added {symbol} - {symbol_data['name']}")
                added_count += 1
            
            await session.commit()
            print(f"\n✅ Successfully added {added_count} new symbols")
            if skipped_count > 0:
                print(f"   Skipped {skipped_count} symbols (already exist)")
            
            # Verify final state
            print("\n📊 Verifying symbols in database...")
            result = await session.execute(select(SymbolInfo))
            all_symbols = result.scalars().all()
            print(f"   Total symbols in database: {len(all_symbols)}")
            print("   Symbols:", ", ".join([s.symbol for s in all_symbols]))
            
        except Exception as e:
            await session.rollback()
            print(f"❌ Error updating symbols: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

if __name__ == "__main__":
    print("🔄 Updating symbols in database...\n")
    asyncio.run(update_symbols())
    print("\n✨ Done!")

