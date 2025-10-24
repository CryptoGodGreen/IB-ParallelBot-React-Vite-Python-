#!/usr/bin/env python3
"""
Migration script to add status column to bot_instances table
"""

import asyncio
import asyncpg
import os
from datetime import datetime

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://appuser:apppass@postgres:5432/appdb")

async def run_migration():
    """Run the migration to add status column"""
    try:
        print("🔄 Starting migration: Add status column to bot_instances...")
        
        # Connect to database
        conn = await asyncpg.connect(DATABASE_URL)
        
        # Add status column
        await conn.execute("""
            ALTER TABLE bot_instances
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';
        """)
        
        print("✅ Migration completed successfully!")
        
        # Close connection
        await conn.close()
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(run_migration())
