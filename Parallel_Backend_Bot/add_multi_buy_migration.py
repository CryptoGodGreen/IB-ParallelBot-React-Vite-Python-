#!/usr/bin/env python3
"""
Migration: Add multi_buy field to user_charts and bot_instances tables
"""
import asyncio
import asyncpg
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@postgres:{os.getenv('POSTGRES_PORT', '5432')}/{os.getenv('POSTGRES_DB')}"
)

async def run_migration():
    """Run the migration to add multi_buy columns"""
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        
        print("🔄 Starting migration: Add multi_buy field...")
        
        # Check if column already exists in user_charts
        check_user_charts = await conn.fetchval("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'user_charts' 
            AND column_name = 'multi_buy'
        """)
        
        if check_user_charts:
            print("✅ Column 'multi_buy' already exists in user_charts table")
        else:
            # Add multi_buy to user_charts
            await conn.execute("""
                ALTER TABLE user_charts 
                ADD COLUMN multi_buy VARCHAR DEFAULT 'disabled'
            """)
            print("✅ Added 'multi_buy' column to user_charts table")
        
        # Check if column already exists in bot_instances
        check_bot_instances = await conn.fetchval("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'bot_instances' 
            AND column_name = 'multi_buy'
        """)
        
        if check_bot_instances:
            print("✅ Column 'multi_buy' already exists in bot_instances table")
        else:
            # Add multi_buy to bot_instances
            await conn.execute("""
                ALTER TABLE bot_instances 
                ADD COLUMN multi_buy VARCHAR DEFAULT 'disabled'
            """)
            print("✅ Added 'multi_buy' column to bot_instances table")
        
        print("🎉 Migration completed successfully!")
        await conn.close()
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(run_migration())

