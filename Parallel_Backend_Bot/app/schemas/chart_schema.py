from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime

# --- Sub-models for structured layout_data ---

class Point(BaseModel):
    """Defines a single point on the chart with time and price coordinates."""
    time: int  # Unix timestamp for the x-axis
    price: float # Price for the y-axis

class Line(BaseModel):
    """Defines a line by its two anchor points."""
    p1: Point
    p2: Point

class TPSLSettings(BaseModel):
    """Defines the Take-Profit and Stop-Loss settings."""
    tp_type: str  # e.g., 'absolute', 'percent', 'line'
    tp_value: float
    sl_type: str  # e.g., 'absolute', 'percent'
    sl_value: float

class LayoutData(BaseModel):
    """A structured model for the chart's layout and drawing data."""
    entry_line: Optional[Line] = None
    exit_line: Optional[Line] = None
    tpsl_settings: Optional[TPSLSettings] = None
    # This can be extended with other drawings or metadata in the future
    other_drawings: Optional[Dict[str, Any]] = None


# --- Main Chart Schemas ---

class ChartDataBase(BaseModel):
    """Base schema for chart data."""
    name: str # A user-defined name for the chart layout
    symbol: str
    interval: str
    rth: bool = True
    layout_data: LayoutData # Using the new structured model

class ChartCreate(ChartDataBase):
    """Schema for creating a new chart layout."""
    pass

class ChartUpdate(BaseModel):
    """Schema for updating an existing chart layout. All fields are optional."""
    name: Optional[str] = None
    symbol: Optional[str] = None
    interval: Optional[str] = None
    rth: Optional[bool] = None
    layout_data: Optional[LayoutData] = None

class ChartResponse(ChartDataBase):
    """Schema for returning chart data from the API."""
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

