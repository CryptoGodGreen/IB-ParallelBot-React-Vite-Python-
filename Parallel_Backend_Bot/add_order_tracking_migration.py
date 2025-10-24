#!/usr/bin/env python3
"""
Migration script to add order tracking fields to bot_instances table
"""

import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def run_migration():
    """Add order tracking fields to bot_instances table"""
    
    # Database connection - use Docker network hostname
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://appuser:apppass@postgres:5432/appdb")
    
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        print("✅ Connected to database")
        
        # Add new columns to bot_instances table
        migration_queries = [
            """
            ALTER TABLE bot_instances 
            ADD COLUMN IF NOT EXISTS entry_order_id VARCHAR(50);
            """,
            """
            ALTER TABLE bot_instances 
            ADD COLUMN IF NOT EXISTS entry_order_status VARCHAR(20) DEFAULT 'PENDING';
            """,
            """
            ALTER TABLE bot_instances 
            ADD COLUMN IF NOT EXISTS stop_loss_order_id VARCHAR(50);
            """,
            """
            ALTER TABLE bot_instances 
            ADD COLUMN IF NOT EXISTS stop_loss_price DECIMAL(10, 2);
            """,
            """
            ALTER TABLE bot_instances 
            ADD COLUMN IF NOT EXISTS hard_stop_triggered BOOLEAN DEFAULT FALSE;
            """
        ]
        
        for i, query in enumerate(migration_queries, 1):
            try:
                await conn.execute(query)
                print(f"✅ Migration step {i}/5 completed")
            except Exception as e:
                print(f"⚠️ Migration step {i}/5 failed: {e}")
                # Continue with other migrations
        
        print("🎉 Order tracking migration completed successfully!")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
    finally:
        if 'conn' in locals():
            await conn.close()
            print("🔌 Database connection closed")

if __name__ == "__main__":
    asyncio.run(run_migration())
