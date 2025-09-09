from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

async def health_check(db: AsyncSession):
    result = await db.execute(text("SELECT NOW()"))
    row = result.fetchone()
    return {"status": "ok", "time": row[0]}
