from sqlalchemy import Column, String, Enum
from sqlalchemy.orm import declarative_base
import enum

Base = declarative_base()

class TrendStrategy(str, enum.Enum):
    uptrend = "uptrend"  # Use spot/equity trading
    downtrend = "downtrend"  # Use options trading

# Migration to add trend_strategy field to user_charts table
def upgrade():
    # Add trend_strategy column with default 'uptrend'
    op.add_column('user_charts', 
        Column('trend_strategy', 
               Enum(TrendStrategy), 
               nullable=False, 
               default=TrendStrategy.uptrend,
               server_default='uptrend'))

def downgrade():
    op.drop_column('user_charts', 'trend_strategy')
