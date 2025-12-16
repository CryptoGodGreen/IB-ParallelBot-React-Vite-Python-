import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ErrorBoundary from '../common/ErrorBoundary';
import chartService from '../../services/chartService';
import tradingService from '../../services/trading/TradingService.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const TradingViewWidget = ({ selectedConfig, onSaveDrawings, onLoadDrawings, onSaveRequested }) => {
  const { symbol } = useParams();
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const loadingConfigIdRef = useRef(null); // Track which config is currently being loaded
  const savingConfigIdRef = useRef(null); // Track which config is currently being saved
  const subscribersRef = useRef({}); // Store active subscriptions for real-time updates
  const [isLoading, setIsLoading] = useState(true);
  const [tradingStatus, setTradingStatus] = useState(null);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isDrawingLines, setIsDrawingLines] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading chart...');

  // Debug selectedConfig changes and add fallback
  useEffect(() => {
    if (selectedConfig) {
      // Store the selected config in localStorage as backup
      localStorage.setItem('lastSelectedConfig', JSON.stringify(selectedConfig));
    }
  }, [selectedConfig]);

  // Helper: wait until the TradingView widget/chart is ready before operating on it
  const waitForWidgetReady = async (maxAttempts = 10, delayMs = 300) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const widget = widgetRef.current;
      if (widget && typeof widget.chart === 'function') {
        const chart = widget.chart();
        if (chart) {
          return true;
        }
      }
      // Small delay before next attempt
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
  };

  // Save drawings to backend using TradingView's proper API
  const saveDrawingsToConfig = async (configId, configData) => {
    try {
      if (!widgetRef.current) {
        return;
      }
      
      // Check if this is still the selected config (prevent saving wrong config)
      if (selectedConfig?.id !== configId) {
        return;
      }
      
      // Mark this config as currently being saved
      savingConfigIdRef.current = configId;
      
      // Wait for widget to be fully ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to capture actual TradingView drawings and map to backend schema
      let layoutData = {
        entry_line: null,
        exit_line: null,
        tpsl_settings: null,
        other_drawings: {},
        timestamp: Date.now(),
        configId: configId
      };
      
      try {
        
        // Method 1: Get only the shapes that are currently visible on the chart
        if (widgetRef.current && widgetRef.current.chart) {
          const chart = widgetRef.current.chart();
          
          // Just capture the current shapes without clearing them
          
          // First, get all currently visible shapes
          if (typeof chart.getAllShapes === 'function') {
            try {
              const allShapes = chart.getAllShapes();
              
              // Try to filter only visible shapes
              const visibleShapes = allShapes.filter(shape => {
                // Check if shape is actually visible
                return shape && shape.id && !shape.isHidden && shape.visible !== false;
              });
              
              // Check for accumulation - if we have more than 3 shapes, something is wrong
              if (allShapes.length > 3) {
                console.log('⚠️ WARNING: Detected', allShapes.length, 'shapes - possible accumulation detected!');
                console.log('⚠️ This suggests the clearing in loadDrawingsForConfig is not working properly');
              }
              
              // Use visible shapes, or fallback to last 3 if still too many
              const shapesToUse = visibleShapes.length <= 3 ? visibleShapes : visibleShapes.slice(-3);
              
              // Always use active_shapes, even if empty (to prevent fallback to old method)
              layoutData.other_drawings = {
                active_shapes: shapesToUse,
                capture_method: 'chart.getAllShapes',
                timestamp: Date.now()
              };
              console.log('💾 Captured shapes via chart.getAllShapes() - count:', shapesToUse.length);
            } catch (error) {
              // Fallback to widget.save() method
            }
          }
        }
        
        // Method 2: Try TradingView's built-in save method (ONLY if getAllShapes failed)
        if (!layoutData.other_drawings.active_shapes && widgetRef.current && typeof widgetRef.current.save === 'function') {
          const tradingViewData = widgetRef.current.save();
          
          if (tradingViewData) {
            // Check what's in the layout
            const charts = tradingViewData.charts || [];
            
            if (charts.length > 0) {
              const panes = charts[0].panes || [];
              
              if (panes.length > 0) {
                const sources = panes[0].sources || [];
                
                // Count LineToolTrendLine objects
                const trendLines = sources.filter(s => s.type === 'LineToolTrendLine');
                console.log('💾 Number of trend lines found:', trendLines.length);
              }
            }
            
            // Store the full TradingView layout like the working example
            layoutData.other_drawings = {
              tradingview_layout: tradingViewData,
              layout_string: JSON.stringify(tradingViewData),
              capture_method: 'widget.save',
              timestamp: Date.now()
            };
          }
        } 
        // Method 2: Try chart().save() method
        if (!layoutData.other_drawings.tradingview_layout && widgetRef.current && widgetRef.current.chart && typeof widgetRef.current.chart().save === 'function') {
          const tradingViewData = widgetRef.current.chart().save();
          
          // Map chart save data to backend schema
          if (tradingViewData && tradingViewData.shapes) {
            layoutData.other_drawings = {
              tradingview_layout: tradingViewData,
              shapes: tradingViewData.shapes,
              capture_method: 'chart.save',
              timestamp: Date.now()
            };
            console.log('💾 Mapped chart.save() data to schema:', tradingViewData.shapes.length, 'shapes');
          }
        }
        // Method 3: Try TradingView's layout API
        if (!layoutData.other_drawings.tradingview_layout && widgetRef.current && typeof widgetRef.current.getLayout === 'function') {
          const layout = widgetRef.current.getLayout();
          
          // Map layout data to backend schema
          if (layout && layout.shapes) {
            layoutData.other_drawings = {
              tradingview_layout: layout,
              shapes: layout.shapes,
              capture_method: 'getLayout',
              timestamp: Date.now()
            };
            console.log('💾 Mapped getLayout() data to schema:', layout.shapes.length, 'shapes');
          }
        }
        // Method 4: Try to access drawings through chart API
        if (!layoutData.other_drawings.tradingview_layout && widgetRef.current && widgetRef.current.chart) {
          const chart = widgetRef.current.chart();
          
          // Try different methods to get drawings
          let drawings = [];
          let studies = [];
          let shapes = [];
          
          // Try getAllShapes
          try {
            if (typeof chart.getAllShapes === 'function') {
              shapes = chart.getAllShapes();
              
              // Try to get full shape data for each shape
              const fullShapes = shapes.map(shape => {
                try {
                  if (typeof chart.getShapeById === 'function') {
                    const fullShape = chart.getShapeById(shape.id);
                    
                    // Extract only serializable properties
                    const serializableShape = {
                      id: shape.id,
                      name: shape.name,
                      // Try to get points
                      points: [],
                      // Try to get properties
                      properties: {}
                    };
                    
                    // Try to get points from the shape
                    if (fullShape && typeof fullShape.getPoints === 'function') {
                      try {
                        serializableShape.points = fullShape.getPoints();
                      } catch (e) {
                        // Ignore errors
                      }
                    }
                    
                    // Try to get properties from the shape
                    if (fullShape && typeof fullShape.getProperties === 'function') {
                      try {
                        const originalProperties = fullShape.getProperties();
                        // Ensure lines extend infinitely in both directions
                        serializableShape.properties = {
                          ...originalProperties,
                          extendLeft: true,
                          extendRight: true,
                          extend: true  // Alternative property name
                        };
                      } catch (e) {
                        // Ignore errors
                      }
                    }
                    
                    return serializableShape;
                  }
                  return shape;
                } catch (err) {
                  return shape;
                }
              });
              
              shapes = fullShapes;
            }
          } catch (e) {
            // Ignore errors
          }
          
          // Try getAllStudies
          try {
            if (typeof chart.getAllStudies === 'function') {
              studies = chart.getAllStudies();
            }
          } catch (e) {
            // Ignore errors
          }
          
          // Try getDrawings
          try {
            if (typeof chart.getDrawings === 'function') {
              drawings = chart.getDrawings();
            }
          } catch (e) {
            // Ignore errors
          }
          
          // Map TradingView data to backend schema
          const allDrawings = [...drawings, ...shapes];
          
          if (allDrawings.length > 0) {
            console.log('💾 Mapping', allDrawings.length, 'drawings to backend schema...');
            
            // Store all drawings in other_drawings
            layoutData.other_drawings = {
              tradingview_drawings: allDrawings,
              studies: studies,
              capture_method: 'manual',
              timestamp: Date.now()
            };
            
            // Try to identify specific types of drawings and map to backend schema
            allDrawings.forEach((drawing, index) => {
              
              if (drawing && typeof drawing === 'object') {
                // Check if it's a trend line (common entry/exit line) - be more flexible with detection
                const isTrendLine = drawing.type === 'trend_line' || 
                                  drawing.shape === 'trend_line' || 
                                  drawing.name === 'trend_line' ||
                                  drawing.type === 'LineToolTrendLine' ||
                                  drawing.name === 'LineToolTrendLine' ||
                                  (drawing.points && drawing.points.length >= 2); // Any drawing with 2+ points
                
                if (isTrendLine) {
                  // Convert TradingView drawing to backend Line schema
                  if (drawing.points && drawing.points.length >= 2) {
                    const lineData = {
                      p1: { 
                        time: Math.floor(drawing.points[0].time || drawing.points[0].x || Date.now() / 1000), 
                        price: parseFloat(drawing.points[0].price || drawing.points[0].y || 0) 
                      },
                      p2: { 
                        time: Math.floor(drawing.points[1].time || drawing.points[1].x || Date.now() / 1000), 
                        price: parseFloat(drawing.points[1].price || drawing.points[1].y || 0) 
                      }
                    };
                    
                    if (!layoutData.entry_line) {
                      layoutData.entry_line = lineData;
                      console.log('💾 Identified entry line:', lineData);
                    } else if (!layoutData.exit_line) {
                      layoutData.exit_line = lineData;
                      console.log('💾 Identified exit line:', lineData);
                    }
                  }
                }
                // Check if it's a horizontal line (support/resistance)
                else if (drawing.type === 'horizontal_line' || drawing.shape === 'horizontal_line') {
                  if (!layoutData.tpsl_settings) {
                    layoutData.tpsl_settings = {
                      tp_type: 'absolute',
                      tp_value: parseFloat(drawing.price || drawing.y || 270.0),
                      sl_type: 'absolute',
                      sl_value: parseFloat(drawing.price || drawing.y || 240.0)
                    };
                    console.log('💾 Identified support/resistance line:', layoutData.tpsl_settings);
                  }
                }
              }
            });
          }
          
          // If no entry line was found, try to extract from TradingView layout data
          if (!layoutData.entry_line && layoutData.other_drawings?.tradingview_layout) {
            const tvLayout = layoutData.other_drawings.tradingview_layout;
            
            // Extract trend lines from TradingView layout structure
            if (tvLayout.charts && tvLayout.charts.length > 0) {
              const panes = tvLayout.charts[0].panes || [];
              if (panes.length > 0) {
                const sources = panes[0].sources || [];
                const trendLines = sources.filter(s => s.type === 'LineToolTrendLine');
                
                console.log(`💾 Found ${trendLines.length} trend lines in TradingView layout`);
                
                if (trendLines.length > 0) {
                  // Extract points from the first trend line for entry
                  const firstLine = trendLines[0];
                  if (firstLine.state && firstLine.state.points && firstLine.state.points.length >= 2) {
                    const points = firstLine.state.points;
                    layoutData.entry_line = {
                      p1: { 
                        time: Math.floor(points[0].time || points[0].timestamp || Date.now() / 1000), 
                        price: parseFloat(points[0].price || points[0].value || 0) 
                      },
                      p2: { 
                        time: Math.floor(points[1].time || points[1].timestamp || Date.now() / 1000), 
                        price: parseFloat(points[1].price || points[1].value || 0) 
                      }
                    };
                    console.log('💾 Created entry line from TradingView layout:', layoutData.entry_line);
                  }
                  
                  // Extract additional lines as exit lines
                  for (let i = 1; i < trendLines.length && i < 5; i++) {
                    const line = trendLines[i];
                    if (line.state && line.state.points && line.state.points.length >= 2) {
                      const points = line.state.points;
                      if (!layoutData.exit_line) {
                        layoutData.exit_line = {
                          p1: { 
                            time: Math.floor(points[0].time || points[0].timestamp || Date.now() / 1000), 
                            price: parseFloat(points[0].price || points[0].value || 0) 
                          },
                          p2: { 
                            time: Math.floor(points[1].time || points[1].timestamp || Date.now() / 1000), 
                            price: parseFloat(points[1].price || points[1].value || 0) 
                          }
                        };
                        console.log('💾 Created exit line from TradingView layout:', layoutData.exit_line);
                      }
                    }
                  }
                }
              }
            }
          }
          
          // Fallback: If still no entry line, use first available drawing
          if (!layoutData.entry_line && allDrawings.length > 0) {
            const firstDrawing = allDrawings[0];
            if (firstDrawing.points && firstDrawing.points.length >= 2) {
              layoutData.entry_line = {
                p1: { 
                  time: Math.floor(firstDrawing.points[0].time || firstDrawing.points[0].x || Date.now() / 1000), 
                  price: parseFloat(firstDrawing.points[0].price || firstDrawing.points[0].y || 0) 
                },
                p2: { 
                  time: Math.floor(firstDrawing.points[1].time || firstDrawing.points[1].x || Date.now() / 1000), 
                  price: parseFloat(firstDrawing.points[1].price || firstDrawing.points[1].y || 0) 
                }
              };
            }
          }
        }
      } catch (error) {
        // Ignore errors
      }
      
      // Final check before saving to backend (prevent race condition)
      if (savingConfigIdRef.current !== configId) {
        return;
      }
      
      // Call parent component's save function and get the updated config back
      if (onSaveDrawings && layoutData) {
        const updatedConfig = await onSaveDrawings(configId, { ...configData, layout_data: layoutData });
        return updatedConfig; // Return the fresh config from PUT response
      }
      
      return null;
    } catch (error) {
      // Ignore errors
    }
  };

  // Load drawings from backend using TradingView's proper API
  // configData parameter allows passing fresh data directly (e.g., from PUT response)
  const loadDrawingsForConfig = async (configId, configData = null) => {
    try {
      console.log('📥 loadDrawingsForConfig called for config:', configId);
      
      // Ensure the widget/chart is actually ready before we try to load anything.
      // This prevents "sometimes works, sometimes not" behaviour when switching configs quickly.
      if (!widgetRef.current || !widgetRef.current.chart) {
        console.log('⏳ Widget not ready, waiting...');
        const ready = await waitForWidgetReady();
        if (!ready) {
          console.warn('⚠️ Widget not ready after waiting, aborting');
          return;
        }
        console.log('✅ Widget is now ready');
      }
      
      // Check if this is still the selected config (prevent race conditions)
      if (selectedConfig?.id !== configId) {
        console.warn(`⚠️ Config ${configId} is no longer selected (current: ${selectedConfig?.id}), aborting`);
        return;
      }
      
      // Mark this config as currently loading
      loadingConfigIdRef.current = configId;
      console.log(`🔒 Locked loading for config: ${configId}`);
      
      setIsDrawingLines(true);
      setLoadingMessage('Loading configuration drawings...');
      
      // Use provided configData first (e.g., from PUT response), then selectedConfig, then fetch
      let savedData = configData || selectedConfig;
      console.log('📥 Initial savedData:', savedData ? 'exists' : 'null', savedData?.layout_data ? 'has layout_data' : 'no layout_data');
      
      // Only fetch from backend if we don't have layout_data or it's incomplete
      const needsBackendFetch = !savedData?.layout_data || 
                               (savedData.layout_data && 
                                typeof savedData.layout_data === 'object' && 
                                Object.keys(savedData.layout_data).length === 0);
      
      if (needsBackendFetch && onLoadDrawings) {
        console.log('📥 Fetching from backend...');
        savedData = await onLoadDrawings(configId);
        console.log('📥 Backend data received:', savedData ? 'exists' : 'null', savedData?.layout_data ? 'has layout_data' : 'no layout_data');
      } else {
        console.log('📥 Using existing data (skipping backend fetch)');
      }
      
      if (savedData && savedData.layout_data) {
          console.log('📥 Found layout_data, checking format...');
          console.log('📥 Layout data keys:', Object.keys(savedData.layout_data));
          
          // Check if this is the backend schema format (entry_line, exit_line, etc.)
          if (savedData.layout_data.entry_line !== undefined || 
              savedData.layout_data.exit_line !== undefined || 
              savedData.layout_data.tpsl_settings !== undefined ||
              savedData.layout_data.other_drawings !== undefined) {
            console.log('📥 Backend schema format detected');
            console.log('📥 Entry line:', savedData.layout_data.entry_line ? 'exists' : 'null');
            console.log('📥 Exit line:', savedData.layout_data.exit_line ? 'exists' : 'null');
            console.log('📥 Other drawings:', savedData.layout_data.other_drawings ? Object.keys(savedData.layout_data.other_drawings) : 'null');
            
            // Clear existing drawings first
            try {
              // Clear all existing shapes first - be more aggressive
              if (widgetRef.current && widgetRef.current.chart) {
                const chart = widgetRef.current.chart();
                
                // Get all current shapes before clearing
                const currentShapes = chart.getAllShapes ? chart.getAllShapes() : [];
                
                // Remove all existing shapes
                if (typeof chart.removeAllShapes === 'function') {
                  chart.removeAllShapes();
                  
                  // Wait a moment for the clearing to take effect
                  await new Promise(resolve => setTimeout(resolve, 500));
                  
                  // Double-check that shapes are cleared
                  const remainingShapes = chart.getAllShapes ? chart.getAllShapes() : [];
                  
                  if (remainingShapes.length > 0) {
                    // Try multiple clearing methods
                    remainingShapes.forEach(shape => {
                      if (shape.id && typeof chart.removeShape === 'function') {
                        try {
                          chart.removeShape(shape.id);
                        } catch (e) {
                          // Ignore errors
                        }
                      }
                    });
                    
                    // Try removeAllShapes again
                    if (typeof chart.removeAllShapes === 'function') {
                      chart.removeAllShapes();
                      await new Promise(resolve => setTimeout(resolve, 200));
                    }
                  }
                }
              }
            } catch (clearError) {
              console.warn('⚠️ Error clearing existing shapes:', clearError);
            }
            
            // Track which lines have been restored to avoid duplicates
            // Declare these OUTSIDE all if blocks so fallback code can access them
            let entryLineRestored = false;
            let exitLineRestored = false;
            
            // Check if there are saved drawings to restore
            if (savedData.layout_data.other_drawings) {
              // First, try to use TradingView's built-in load method if we have the full layout
              if (savedData.layout_data.other_drawings.tradingview_layout) {
                console.log('📥 Found TradingView layout data, attempting to load via widget.load()...');
                try {
                  // Wait for chart to be ready with data
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  
                  if (widgetRef.current && typeof widgetRef.current.load === 'function') {
                    widgetRef.current.load(savedData.layout_data.other_drawings.tradingview_layout);
                    console.log('✅ Loaded TradingView layout via widget.load()');
                    // Don't return here - continue to fallback for entry/exit lines
                  } else if (widgetRef.current && widgetRef.current.chart && typeof widgetRef.current.chart().load === 'function') {
                    widgetRef.current.chart().load(savedData.layout_data.other_drawings.tradingview_layout);
                    console.log('✅ Loaded TradingView layout via chart().load()');
                    // Don't return here - continue to fallback for entry/exit lines
                  }
                } catch (loadError) {
                  console.log('⚠️ Failed to load via widget.load(), falling back to manual restoration:', loadError.message);
                }
              }
              
              // Restore all drawings from tradingview_drawings
              if (savedData.layout_data.other_drawings.tradingview_drawings) {
                console.log('📥 Found saved drawings, attempting to restore all lines...');
                
                try {
                  const chart = widgetRef.current.chart();
                  const drawings = savedData.layout_data.other_drawings.tradingview_drawings;
                  
                  console.log('📥 Restoring', drawings.length, 'drawings');
                  
                  // Wait for chart to be ready with data
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  
                  // Restore each drawing
                  for (const drawing of drawings) {
                    // Check if this config is still the one being loaded
                    if (loadingConfigIdRef.current !== configId) {
                      return;
                    }
                    
                    try {
                      if (drawing.points && drawing.points.length >= 2) {
                        const point1 = drawing.points[0];
                        const point2 = drawing.points[1];
                        
                        // Validate points
                        if (!point1 || !point2 || 
                            point1.time === undefined || point1.price === undefined ||
                            point2.time === undefined || point2.price === undefined) {
                          console.warn('⚠️ Invalid drawing points:', drawing.id);
                          continue;
                        }
                        
                        // Validate timestamp and price values
                        const time1 = Number(point1.time);
                        const price1 = Number(point1.price);
                        const time2 = Number(point2.time);
                        const price2 = Number(point2.price);
                        
                        if (!isFinite(time1) || !isFinite(price1) || !isFinite(time2) || !isFinite(price2)) {
                          console.warn('⚠️ Invalid drawing point values:', drawing.id, { time1, price1, time2, price2 });
                          continue;
                        }
                        
                        // Validate timestamp is not too old or in the future
                        const now = Date.now() / 1000;
                        const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds
                        if (time1 < now - maxAge || time1 > now + 86400 || 
                            time2 < now - maxAge || time2 > now + 86400) {
                          console.warn('⚠️ Drawing timestamp out of range:', drawing.id, {
                            time1: new Date(time1 * 1000).toISOString(),
                            time2: new Date(time2 * 1000).toISOString()
                          });
                          continue;
                        }
                        
                        // Check if this drawing matches entry or exit line coordinates BEFORE restoring
                        let isEntryLine = false;
                        let isExitLine = false;
                        
                        if (savedData.layout_data.entry_line) {
                          const entryP1 = savedData.layout_data.entry_line.p1;
                          const entryP2 = savedData.layout_data.entry_line.p2;
                          if (entryP1 && entryP2) {
                            const timeMatch = Math.abs(time1 - entryP1.time) < 60 &&
                                             Math.abs(time2 - entryP2.time) < 60;
                            const priceMatch = Math.abs(price1 - entryP1.price) < 0.01 &&
                                              Math.abs(price2 - entryP2.price) < 0.01;
                            if (timeMatch && priceMatch) {
                              isEntryLine = true;
                            }
                          }
                        }
                        
                        if (savedData.layout_data.exit_line) {
                          const exitP1 = savedData.layout_data.exit_line.p1;
                          const exitP2 = savedData.layout_data.exit_line.p2;
                          if (exitP1 && exitP2) {
                            const timeMatch = Math.abs(time1 - exitP1.time) < 60 &&
                                             Math.abs(time2 - exitP2.time) < 60;
                            const priceMatch = Math.abs(price1 - exitP1.price) < 0.01 &&
                                              Math.abs(price2 - exitP2.price) < 0.01;
                            if (timeMatch && priceMatch) {
                              isExitLine = true;
                            }
                          }
                        }
                        
                        // Use createMultipointShape if available (most reliable)
                        let shapeCreated = false;
                        if (typeof chart.createMultipointShape === 'function') {
                          const shape = chart.createMultipointShape(
                            [
                              { time: time1, price: price1 },
                              { time: time2, price: price2 }
                            ],
                            {
                              shape: drawing.name || 'trend_line',
                              overrides: {
                                extendLeft: true,
                                extendRight: true,
                                showLabel: false
                              }
                            }
                          );
                          if (shape) {
                            shapeCreated = true;
                            console.log('✅ Restored drawing:', drawing.id);
                            // Only set flags if shape was actually created
                            if (isEntryLine) {
                              entryLineRestored = true;
                              console.log('📌 Entry line successfully restored from tradingview_drawings');
                            }
                            if (isExitLine) {
                              exitLineRestored = true;
                              console.log('📌 Exit line successfully restored from tradingview_drawings');
                            }
                          } else {
                            console.warn('⚠️ createMultipointShape returned null/undefined for drawing:', drawing.id);
                          }
                        } else if (typeof chart.createShape === 'function') {
                          // Fallback to createShape + setPoint
                          const shape = chart.createShape(
                            { time: time1, price: price1 },
                            {
                              shape: drawing.name || 'trend_line',
                              lock: false,
                              overrides: {
                                extendLeft: true,
                                extendRight: true,
                                showLabel: false
                              }
                            }
                          );
                          
                          if (shape && typeof shape.setPoint === 'function') {
                            shape.setPoint(1, { time: time2, price: price2 });
                            if (typeof shape.complete === 'function') {
                              shape.complete();
                            }
                            shapeCreated = true;
                            console.log('✅ Restored drawing:', drawing.id);
                            // Only set flags if shape was actually created
                            if (isEntryLine) {
                              entryLineRestored = true;
                              console.log('📌 Entry line successfully restored from tradingview_drawings');
                            }
                            if (isExitLine) {
                              exitLineRestored = true;
                              console.log('📌 Exit line successfully restored from tradingview_drawings');
                            }
                          } else if (shape) {
                            // Remove incomplete shape
                            if (shape.id && typeof chart.removeShape === 'function') {
                              chart.removeShape(shape.id);
                            }
                            console.warn('⚠️ Shape created but setPoint failed for drawing:', drawing.id);
                          } else {
                            console.warn('⚠️ createShape returned null/undefined for drawing:', drawing.id);
                          }
                        }
                      }
                    } catch (drawError) {
                      console.error('❌ Error restoring drawing:', drawing.id, drawError.message);
                    }
                  }
                  
                  // Verify shapes were actually created
                  await new Promise(resolve => setTimeout(resolve, 500));
                  if (typeof chart.getAllShapes === 'function') {
                    const shapesAfterRestore = chart.getAllShapes();
                    console.log('🔍 Shapes count after restore:', shapesAfterRestore.length);
                    console.log('🔍 Expected drawings count:', drawings.length);
                    if (shapesAfterRestore.length < drawings.length) {
                      console.warn(`⚠️ Only ${shapesAfterRestore.length} shapes created out of ${drawings.length} drawings - restoration may have failed`);
                      // Reset flags if not enough shapes were created
                      entryLineRestored = false;
                      exitLineRestored = false;
                      console.log('🔄 Reset entryLineRestored and exitLineRestored to false - will use fallback for all lines');
                    } else if (shapesAfterRestore.length === 0) {
                      console.warn('⚠️ No shapes found after restore - restoration may have failed');
                      // Reset flags if no shapes were created
                      entryLineRestored = false;
                      exitLineRestored = false;
                      console.log('🔄 Reset entryLineRestored and exitLineRestored to false - will use fallback');
                    } else {
                      console.log(`✅ Successfully restored ${shapesAfterRestore.length} shapes`);
                    }
                  }
                  
                  console.log('✅ All drawings restored');
                } catch (restoreError) {
                  console.log('⚠️ Error restoring drawings:', restoreError.message);
                }
              } else {
                console.log('📥 No tradingview_drawings found, will use fallback manual drawing');
              }
            }
            
            // Fallback: Draw the lines manually on the chart (entry/exit lines)
            console.log('📥 Starting fallback manual drawing...');
            console.log('📥 entryLineRestored:', entryLineRestored, 'exitLineRestored:', exitLineRestored);
            console.log('📥 Has entry_line:', !!savedData.layout_data.entry_line);
            console.log('📥 Has exit_line:', !!savedData.layout_data.exit_line);
            // Wait for chart to be fully ready and data to be loaded before drawing
            try {
              if (widgetRef.current && widgetRef.current.chart) {
                // Wait longer for chart to be ready and initial data to load
                // This ensures TradingView has finished loading data before we draw
                console.log('⏳ Waiting 2 seconds for chart to be ready...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check again if chart is still available
                if (!widgetRef.current || !widgetRef.current.chart) {
                  console.log('⚠️ Chart no longer available after wait');
                  return;
                }
                
                const chart = widgetRef.current.chart();
                console.log('📥 Chart object obtained');
                
                // Verify chart methods are available
                if (!chart || (typeof chart.createMultipointShape !== 'function' && typeof chart.createShape !== 'function')) {
                  console.log('⚠️ Chart drawing methods not available');
                  console.log('📥 Chart methods:', {
                    createMultipointShape: typeof chart.createMultipointShape,
                    createShape: typeof chart.createShape
                  });
                  return;
                }
                
                console.log('✅ Chart drawing methods available');
                
                // Wait for chart to have visible range (data is loaded)
                let retries = 0;
                while (retries < 10) {
                  try {
                    if (typeof chart.getVisibleRange === 'function') {
                      const visibleRange = chart.getVisibleRange();
                      if (visibleRange && visibleRange.from && visibleRange.to) {
                        console.log('✅ Chart has visible range, ready to draw');
                        break;
                      }
                    }
                  } catch (e) {
                    // getVisibleRange might not be available or might throw
                  }
                  await new Promise(resolve => setTimeout(resolve, 200));
                  retries++;
                }
                
                if (retries >= 10) {
                  console.log('⚠️ Chart visible range not available after waiting, proceeding anyway');
                }
                
                // Draw entry line (only if not already restored from tradingview_drawings)
                if (!entryLineRestored && savedData.layout_data.entry_line && savedData.layout_data.entry_line.p1 && savedData.layout_data.entry_line.p2) {
                  console.log('📈 Drawing entry line...');
                  console.log('📈 Entry line points:', {
                    p1: savedData.layout_data.entry_line.p1,
                    p2: savedData.layout_data.entry_line.p2
                  });
                  console.log('📈 Drawing entry line...');
                  try {
                      // Use createMultipointShape if available to create complete line in one call
                    if (typeof chart.createMultipointShape === 'function') {
                      chart.createMultipointShape(
                        [
                          { time: savedData.layout_data.entry_line.p1.time, price: savedData.layout_data.entry_line.p1.price },
                          { time: savedData.layout_data.entry_line.p2.time, price: savedData.layout_data.entry_line.p2.price }
                        ],
                        {
                          shape: 'trend_line',
                          lock: false,
                          disableSelection: false,
                          disableSave: false,
                          disableUndo: false,
                          overrides: {
                            showLabel: false,
                            extendLeft: true,
                            extendRight: true
                          }
                        }
                      );
                      console.log('✅ Entry line drawn successfully');
                    } else {
                      // Fallback to createShape + setPoint
                      const entryLine = chart.createShape(
                        { time: savedData.layout_data.entry_line.p1.time, price: savedData.layout_data.entry_line.p1.price },
                        {
                          shape: 'trend_line',
                          lock: false,
                          disableSelection: false,
                          disableSave: false,
                          disableUndo: false,
                          overrides: {
                            showLabel: false,
                            extendLeft: true,
                            extendRight: true
                          }
                        }
                      );
                      
                      if (entryLine && typeof entryLine.setPoint === 'function') {
                        entryLine.setPoint(1, { time: savedData.layout_data.entry_line.p2.time, price: savedData.layout_data.entry_line.p2.price });
                        // Ensure the shape is completed/closed
                        if (typeof entryLine.complete === 'function') {
                          entryLine.complete();
                        }
                        console.log('✅ Entry line drawn successfully');
                      } else if (entryLine) {
                        // If setPoint doesn't work, try to remove the incomplete shape
                        if (typeof chart.removeShape === 'function' && entryLine.id) {
                          chart.removeShape(entryLine.id);
                        }
                        console.log('⚠️ Entry line created but could not set second point');
                      }
                    }
                  } catch (error) {
                    console.error('❌ Error drawing entry line:', error.message);
                  }
                }
                
                // Draw exit line (only if not already restored from tradingview_drawings)
                if (!exitLineRestored && savedData.layout_data.exit_line && savedData.layout_data.exit_line.p1 && savedData.layout_data.exit_line.p2) {
                  console.log('📈 Drawing exit line...');
                  console.log('📈 Exit line points:', {
                    p1: savedData.layout_data.exit_line.p1,
                    p2: savedData.layout_data.exit_line.p2
                  });
                  try {
                      // Use createMultipointShape if available to create complete line in one call
                    if (typeof chart.createMultipointShape === 'function') {
                      console.log('📈 Using createMultipointShape for exit line...');
                      chart.createMultipointShape(
                        [
                          { time: savedData.layout_data.exit_line.p1.time, price: savedData.layout_data.exit_line.p1.price },
                          { time: savedData.layout_data.exit_line.p2.time, price: savedData.layout_data.exit_line.p2.price }
                        ],
                        {
                          shape: 'trend_line',
                          lock: false,
                          disableSelection: false,
                          disableSave: false,
                          disableUndo: false,
                          overrides: {
                            showLabel: false,
                            extendLeft: true,
                            extendRight: true
                          }
                        }
                      );
                      console.log('✅ Exit line drawn successfully');
                    } else {
                      // Fallback to createShape + setPoint
                      const exitLine = chart.createShape(
                        { time: savedData.layout_data.exit_line.p1.time, price: savedData.layout_data.exit_line.p1.price },
                        {
                          shape: 'trend_line',
                          lock: false,
                          disableSelection: false,
                          disableSave: false,
                          disableUndo: false,
                          overrides: {
                            showLabel: false,
                            extendLeft: true,
                            extendRight: true
                          }
                        }
                      );
                      
                      if (exitLine && typeof exitLine.setPoint === 'function') {
                        exitLine.setPoint(1, { time: savedData.layout_data.exit_line.p2.time, price: savedData.layout_data.exit_line.p2.price });
                        // Ensure the shape is completed/closed
                        if (typeof exitLine.complete === 'function') {
                          exitLine.complete();
                        }
                        console.log('✅ Exit line drawn successfully');
                      } else if (exitLine) {
                        // If setPoint doesn't work, try to remove the incomplete shape
                        if (typeof chart.removeShape === 'function' && exitLine.id) {
                          chart.removeShape(exitLine.id);
                        }
                        console.log('⚠️ Exit line created but could not set second point');
                      }
                    }
                  } catch (error) {
                    console.error('❌ Error drawing exit line:', error.message);
                  }
                }
                
                // Draw TP/SL horizontal lines if available
                if (savedData.layout_data.tpsl_settings) {
                  console.log('📈 Drawing TP/SL lines...');
                  
                  // Draw TP line
                  if (savedData.layout_data.tpsl_settings.tp_value) {
                    try {
                      chart.createShape(
                        { time: Date.now() / 1000, price: savedData.layout_data.tpsl_settings.tp_value },
                        {
                          shape: 'horizontal_line',
                          lock: false,
                          overrides: {
                            linecolor: '#00ff00',
                            linewidth: 1,
                            linestyle: 2,
                            showLabel: true,
                            text: `TP: ${savedData.layout_data.tpsl_settings.tp_value}`
                          }
                        }
                      );
                      console.log('✅ TP line drawn successfully');
                    } catch (error) {
                      console.error('❌ Error drawing TP line:', error.message);
                    }
                  }
                  
                  // Draw SL line
                  if (savedData.layout_data.tpsl_settings.sl_value) {
                    try {
                      chart.createShape(
                        { time: Date.now() / 1000, price: savedData.layout_data.tpsl_settings.sl_value },
                        {
                          shape: 'horizontal_line',
                          lock: false,
                          overrides: {
                            linecolor: '#ff0000',
                            linewidth: 1,
                            linestyle: 2,
                            showLabel: true,
                            text: `SL: ${savedData.layout_data.tpsl_settings.sl_value}`
                          }
                        }
                      );
                      console.log('✅ SL line drawn successfully');
                    } catch (error) {
                      console.error('❌ Error drawing SL line:', error.message);
                    }
                  }
                }
                
                // Draw all other lines from tradingview_drawings that weren't entry/exit lines
                // This ensures all 4 lines are drawn, not just entry/exit
                if (savedData.layout_data.other_drawings && savedData.layout_data.other_drawings.tradingview_drawings) {
                  const drawings = savedData.layout_data.other_drawings.tradingview_drawings;
                  console.log('📥 Drawing additional lines from tradingview_drawings:', drawings.length);
                  
                  for (const drawing of drawings) {
                    // Skip if this is the entry or exit line (already drawn above)
                    let isEntryOrExit = false;
                    
                    if (savedData.layout_data.entry_line && drawing.points && drawing.points.length >= 2) {
                      const entryP1 = savedData.layout_data.entry_line.p1;
                      const entryP2 = savedData.layout_data.entry_line.p2;
                      const drawP1 = drawing.points[0];
                      const drawP2 = drawing.points[1];
                      if (entryP1 && entryP2 && drawP1 && drawP2) {
                        const timeMatch = Math.abs((drawP1.time || drawP1.x) - entryP1.time) < 60 &&
                                         Math.abs((drawP2.time || drawP2.x) - entryP2.time) < 60;
                        const priceMatch = Math.abs((drawP1.price || drawP1.y) - entryP1.price) < 0.01 &&
                                          Math.abs((drawP2.price || drawP2.y) - entryP2.price) < 0.01;
                        if (timeMatch && priceMatch) {
                          isEntryOrExit = true;
                        }
                      }
                    }
                    
                    if (savedData.layout_data.exit_line && drawing.points && drawing.points.length >= 2) {
                      const exitP1 = savedData.layout_data.exit_line.p1;
                      const exitP2 = savedData.layout_data.exit_line.p2;
                      const drawP1 = drawing.points[0];
                      const drawP2 = drawing.points[1];
                      if (exitP1 && exitP2 && drawP1 && drawP2) {
                        const timeMatch = Math.abs((drawP1.time || drawP1.x) - exitP1.time) < 60 &&
                                         Math.abs((drawP2.time || drawP2.x) - exitP2.time) < 60;
                        const priceMatch = Math.abs((drawP1.price || drawP1.y) - exitP1.price) < 0.01 &&
                                          Math.abs((drawP2.price || drawP2.y) - exitP2.price) < 0.01;
                        if (timeMatch && priceMatch) {
                          isEntryOrExit = true;
                        }
                      }
                    }
                    
                    // Only draw if it's not entry/exit (those are drawn above) and not already restored
                    if (!isEntryOrExit && drawing.points && drawing.points.length >= 2) {
                      const point1 = drawing.points[0];
                      const point2 = drawing.points[1];
                      
                      if (point1 && point2 && point1.time !== undefined && point1.price !== undefined &&
                          point2.time !== undefined && point2.price !== undefined) {
                        const time1 = Number(point1.time);
                        const price1 = Number(point1.price);
                        const time2 = Number(point2.time);
                        const price2 = Number(point2.price);
                        
                        if (isFinite(time1) && isFinite(price1) && isFinite(time2) && isFinite(price2)) {
                          try {
                            console.log('📈 Drawing additional line from tradingview_drawings:', drawing.id);
                            if (typeof chart.createMultipointShape === 'function') {
                              chart.createMultipointShape(
                                [
                                  { time: time1, price: price1 },
                                  { time: time2, price: price2 }
                                ],
                                {
                                  shape: drawing.name || 'trend_line',
                                  lock: false,
                                  overrides: {
                                    extendLeft: true,
                                    extendRight: true,
                                    showLabel: false
                                  }
                                }
                              );
                              console.log('✅ Additional line drawn:', drawing.id);
                            } else if (typeof chart.createShape === 'function') {
                              const shape = chart.createShape(
                                { time: time1, price: price1 },
                                {
                                  shape: drawing.name || 'trend_line',
                                  lock: false,
                                  overrides: {
                                    extendLeft: true,
                                    extendRight: true,
                                    showLabel: false
                                  }
                                }
                              );
                              if (shape && typeof shape.setPoint === 'function') {
                                shape.setPoint(1, { time: time2, price: price2 });
                                if (typeof shape.complete === 'function') {
                                  shape.complete();
                                }
                                console.log('✅ Additional line drawn:', drawing.id);
                              }
                            }
                          } catch (error) {
                            console.error('❌ Error drawing additional line:', drawing.id, error.message);
                          }
                        }
                      }
                    }
                  }
                }
                
                console.log('✅ All lines drawn successfully');
                
                // Verify shapes were actually created
                await new Promise(resolve => setTimeout(resolve, 500));
                if (typeof chart.getAllShapes === 'function') {
                  const shapesAfterDraw = chart.getAllShapes();
                  console.log('🔍 Shapes count after drawing:', shapesAfterDraw.length);
                  if (shapesAfterDraw.length === 0) {
                    console.warn('⚠️ No shapes found after drawing - shapes may have been cleared');
                  } else {
                    console.log('✅ Shapes successfully created:', shapesAfterDraw.length);
                  }
                }
              } else {
                console.log('⚠️ Chart not available for drawing');
              }
            } catch (error) {
              console.error('❌ Error drawing lines on chart:', error);
            }
            
            console.log('✅ Load completed');
            return;
          }
          
          // Check if this is TradingView layout format (charts, drawings, etc.)
          if (savedData.layout_data.charts || savedData.layout_data.drawings || savedData.layout_data.timestamp) {
            console.log('📥 TradingView layout format detected');
            
            try {
              // Try to load the layout back into TradingView
              if (widgetRef.current && typeof widgetRef.current.load === 'function') {
                console.log('📥 Attempting to load layout with widget.load()');
                widgetRef.current.load(savedData.layout_data);
                console.log('✅ Layout loaded successfully with widget.load()');
              } else if (widgetRef.current && widgetRef.current.chart && typeof widgetRef.current.chart().load === 'function') {
                console.log('📥 Attempting to load layout with chart().load()');
                widgetRef.current.chart().load(savedData.layout_data);
                console.log('✅ Layout loaded successfully with chart().load()');
              } else {
                console.log('⚠️ TradingView load methods not available - layout data found but cannot restore');
                console.log('📊 Layout data contains:', {
                  charts: savedData.layout_data.charts?.length || 0,
                  drawings: savedData.layout_data.drawings?.length || 0,
                  timestamp: savedData.layout_data.timestamp
                });
              }
            } catch (loadError) {
              console.error('❌ Error loading layout into TradingView:', loadError);
              console.log('📊 Layout data was retrieved but could not be applied to chart');
            }
          } else {
            console.log('📥 Unknown layout data format:', savedData.layout_data);
            console.log('✅ Load completed - unknown format, no action taken');
          }
        } else {
          console.log('📥 No layout data found for config:', configId);
        }
    } catch (error) {
      console.error('❌ Error loading drawings:', error);
    } finally {
      // DEBUG: Check how many shapes exist after loading
      if (widgetRef.current && widgetRef.current.chart) {
        const chart = widgetRef.current.chart();
        if (typeof chart.getAllShapes === 'function') {
          const shapesAfterLoad = chart.getAllShapes();
          console.log('🔍 Shapes count after loading:', shapesAfterLoad.length);
        }
      }
      
      setIsDrawingLines(false);
      setLoadingMessage('Loading chart...');
    }
  };

  useEffect(() => {
    // Initialize trading service
    tradingService.initialize({
      onBotStatusChange: (configId, status, data) => {
        setTradingStatus({ configId, status, data });
      },
      onOrderUpdate: (configId, type, order) => {
        // Order updates not related to drawing
      },
      onError: (configId, error) => {
        setError(`Trading Error: ${error}`);
      }
    });

    let mounted = true;
    let widget = null;
    let isInitializing = false;

    const initChart = async () => {
      if (isInitializing) {
        return;
      }

      isInitializing = true;

      try {
        // Clean up any existing widget first
        if (widgetRef.current) {
          try {
            widgetRef.current.remove();
          } catch (e) {
            // Ignore errors
          }
          widgetRef.current = null;
        }

        // Clear the container completely
        if (containerRef.current) {
          while (containerRef.current.firstChild) {
            containerRef.current.removeChild(containerRef.current.firstChild);
          }
        }

        // Load TradingView library
        if (!window.TradingView) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/charting_library/charting_library.standalone.js';
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        if (!mounted) {
          isInitializing = false;
          return;
        }

        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 200));

        if (!mounted) {
          isInitializing = false;
          return;
        }

        // Reset subscribers for this widget instance
        subscribersRef.current = {};
        
        // Custom UDF-compatible datafeed
        const datafeed = {
          onReady: (callback) => {
            setTimeout(() => {
              callback({
                supports_search: true,
                supports_group_request: false,
                supports_marks: false,
                supports_timescale_marks: false,
                supports_time: true,
                supported_resolutions: ['1', '5', '15', '30', '60', 'D', 'W', 'M']
              });
            }, 0);
          },

          searchSymbols: (userInput, exchange, symbolType, onResultReadyCallback) => {
            fetch(`${API_BASE_URL}/udf/search?query=${userInput}&limit=50`)
              .then(response => response.json())
              .then(data => onResultReadyCallback(data))
              .catch(() => onResultReadyCallback([]));
          },

          resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
            fetch(`${API_BASE_URL}/udf/symbol?symbol=${symbolName}`)
              .then(response => response.json())
              .then(data => {
                const symbolInfo = {
                  name: data.name || symbolName,
                  ticker: data.ticker || symbolName,
                  description: data.description || `${symbolName} Stock`,
                  type: data.type || 'stock',
                  session: data.session || '0930-1600',
                  timezone: data.timezone || 'America/New_York',
                  exchange: data.exchange || 'SMART',
                  minmov: data.minmov || 1,
                  pricescale: data.pricescale || 100,
                  has_intraday: Boolean(data.has_intraday),
                  has_daily: Boolean(data.has_daily),
                  has_weekly_and_monthly: Boolean(data.has_weekly_and_monthly),
                  supported_resolutions: data.supported_resolutions || ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
                  volume_precision: data.volume_precision || 0,
                  data_status: data.data_status || 'streaming',
                  autosize: data.autosize || true
                };
                onSymbolResolvedCallback(symbolInfo);
              })
              .catch(error => {
                onResolveErrorCallback('Cannot resolve symbol');
              });
          },

          getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
            const { from, to, firstDataRequest, countBack } = periodParams;
            
            // For the first request, use what TradingView asks for (or slightly more)
            // For subsequent requests (scrolling), expand more aggressively
            let adjustedFrom = from;
            let adjustedTo = to;
            const resolutionMinutes = parseInt(resolution) || 1;
            const timeWindow = to - from;
            const now = Math.floor(Date.now() / 1000);
            
            if (firstDataRequest) {
              // First request: request a reasonable amount of data upfront to avoid multiple small requests
              // For 5-minute charts, request ~2 days of data (about 500-600 bars)
              // This is enough to show a good initial view without being too slow
              const resolutionMinutes = parseInt(resolution) || 1;
              let initialDays = 1; // Default to 1 day
              
              if (resolutionMinutes <= 1) {
                initialDays = 0.5; // 12 hours for 1-minute charts
              } else if (resolutionMinutes <= 5) {
                initialDays = 2; // 2 days for 5-minute charts (~576 bars)
              } else if (resolutionMinutes <= 15) {
                initialDays = 3; // 3 days for 15-minute charts
              } else if (resolutionMinutes <= 60) {
                initialDays = 7; // 1 week for hourly charts
              } else {
                initialDays = 30; // 1 month for daily charts
              }
              
              const initialWindow = initialDays * 86400; // Convert days to seconds
              adjustedFrom = Math.max(from, now - initialWindow);
              adjustedTo = Math.min(to, now);
              
              // Ensure we don't request more than what TradingView asked for on the "to" side
              // But expand backward to get more historical data
              if (to < now) {
                adjustedTo = to;
                adjustedFrom = Math.max(from, adjustedTo - initialWindow);
              }
            } else {
              // Subsequent requests (user scrolling): expand to ensure we get enough data
              // When scrolling left, we need to request older data
              const maxExpansionDays = resolutionMinutes <= 5 ? 5 : resolutionMinutes <= 15 ? 10 : 20;
              const maxExpansion = maxExpansionDays * 86400;
              
              // When requesting older data (scrolling left), expand backward significantly
              if (from < now - 86400) {
                // For older data requests, expand backward more aggressively
                // Request at least 2-3 days of data to ensure continuity
                const backwardExpansion = Math.min(maxExpansion, (now - from) * 0.5);
                adjustedFrom = from - backwardExpansion;
                adjustedTo = to + Math.min(86400, timeWindow * 0.2); // Small forward buffer
                
                // Don't go into the future
                if (adjustedTo > now) {
                  adjustedTo = now;
                  adjustedFrom = Math.max(from - backwardExpansion, adjustedTo - maxExpansion);
                }
              } else {
                // Recent data: add moderate buffer
                const buffer = Math.min(timeWindow * 0.5, 86400);
                adjustedFrom = from - buffer;
                adjustedTo = to + buffer;
                
                if (adjustedTo > now) {
                  adjustedTo = now;
                  adjustedFrom = from - buffer;
                }
              }
            }
            
            // Use countback if provided and reasonable (for bar count requests)
            const countbackParam = countBack && countBack > 0 && countBack <= 500 ? `&countback=${countBack}` : '';

            console.log('[getBars]: Request', {
              symbol: symbolInfo.name,
              resolution,
              firstDataRequest,
              from: new Date(from * 1000).toISOString(),
              to: new Date(to * 1000).toISOString(),
              adjustedFrom: new Date(adjustedFrom * 1000).toISOString(),
              adjustedTo: new Date(adjustedTo * 1000).toISOString(),
              timeWindow: `${((adjustedTo - adjustedFrom) / 86400).toFixed(1)} days`
            });

            // Add timeout to prevent hanging requests (longer for initial load)
            const controller = new AbortController();
            const timeoutDuration = firstDataRequest ? 60000 : 30000; // 60s for first, 30s for subsequent
            const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

            fetch(`${API_BASE_URL}/udf/history?symbol=${symbolInfo.name}&from_timestamp=${Math.floor(adjustedFrom)}&to_timestamp=${Math.floor(adjustedTo)}&resolution=${resolution}${countbackParam}`, {
              signal: controller.signal
            })
              .then(response => {
                clearTimeout(timeoutId);
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
              })
              .then(data => {
                clearTimeout(timeoutId);
                console.log('[getBars]: Data received', {
                  status: data.s,
                  bars: data.t?.length || 0,
                  firstTime: data.t?.[0] ? new Date(data.t[0] * 1000).toISOString() : null,
                  lastTime: data.t?.[data.t.length - 1] ? new Date(data.t[data.t.length - 1] * 1000).toISOString() : null
                });
                
                if (data.s === 'ok' && data.t && data.t.length > 0) {
                  try {
                    const bars = data.t.map((time, index) => {
                      // Validate and convert timestamp
                      const timestamp = time * 1000;
                      if (!isFinite(timestamp) || timestamp < 0) {
                        console.warn('[getBars]: Invalid timestamp:', time);
                        return null;
                      }
                      
                      // Validate OHLCV data
                      const open = parseFloat(data.o[index]);
                      const high = parseFloat(data.h[index]);
                      const low = parseFloat(data.l[index]);
                      const close = parseFloat(data.c[index]);
                      const volume = parseFloat(data.v?.[index] || 0);
                      
                      if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) {
                        console.warn('[getBars]: Invalid OHLC data at index:', index);
                        return null;
                      }
                      
                      return {
                        time: timestamp,
                        open,
                        high,
                        low,
                        close,
                        volume: isFinite(volume) ? volume : 0
                      };
                    }).filter(bar => bar !== null); // Remove invalid bars
                    
                    if (bars.length === 0) {
                      console.warn('[getBars]: No valid bars after filtering');
                      onHistoryCallback([], { noData: true });
                      return;
                    }
                    
                    // Sort bars by time (ascending)
                    bars.sort((a, b) => a.time - b.time);
                    
                    // Filter bars to match the requested range
                    // TradingView expects data within the requested range for incremental updates
                    const requestedFromMs = from * 1000;
                    const requestedToMs = to * 1000;
                    
                    // Filter bars that are within the requested range
                    // Don't add buffer - TradingView needs exact range for incremental updates
                    const filteredBars = bars.filter(bar => {
                      return bar.time >= requestedFromMs && bar.time <= requestedToMs;
                    });
                    
                    // Check if we have data that goes beyond the requested range
                    // This helps TradingView know there's more data available
                    const firstBarTime = bars[0].time / 1000;
                    const lastBarTime = bars[bars.length - 1].time / 1000;
                    const hasOlderData = firstBarTime < from;
                    const hasNewerData = lastBarTime > to;
                    
                    // Use filtered bars if we have any, otherwise use all bars (for first request)
                    const barsToReturn = filteredBars.length > 0 ? filteredBars : (firstDataRequest ? bars : []);
                    
                    console.log('[getBars]: Raw bars:', bars.length, 'Filtered bars:', filteredBars.length, 'Returning:', barsToReturn.length);
                    if (barsToReturn.length > 0) {
                      console.log('[getBars]: First bar:', new Date(barsToReturn[0].time).toISOString());
                      console.log('[getBars]: Last bar:', new Date(barsToReturn[barsToReturn.length - 1].time).toISOString());
                      console.log('[getBars]: Requested from:', new Date(requestedFromMs).toISOString());
                      console.log('[getBars]: Requested to:', new Date(requestedToMs).toISOString());
                      console.log('[getBars]: Has older data:', hasOlderData, 'Has newer data:', hasNewerData);
                    }
                    
                    // Always indicate noData: false when we have any bars at all
                    // This tells TradingView the datafeed is working and more data might be available
                    // TradingView will continue requesting data when scrolling if noData is false
                    // Even if filtered bars are empty, if we have raw bars, there might be more data
                    const hasData = bars.length > 0;
                    onHistoryCallback(barsToReturn, { 
                      noData: !hasData
                    });
                  } catch (processError) {
                    console.error('[getBars]: Error processing bars:', processError);
                    onHistoryCallback([], { noData: true });
                  }
                } else if (data.s === 'no_data') {
                  console.log('[getBars]: No data available');
                  onHistoryCallback([], { noData: true });
                } else if (data.s === 'error') {
                  console.error('[getBars]: Backend error:', data.errmsg);
                  // For first request errors, return empty data instead of error to allow chart to initialize
                  if (firstDataRequest) {
                    console.warn('[getBars]: First request error, returning empty data to allow initialization');
                    onHistoryCallback([], { noData: true });
                  } else {
                    onErrorCallback(data.errmsg || 'Unknown error');
                  }
                } else {
                  console.error('[getBars]: Invalid data format:', data);
                  // For first request, return empty data instead of error
                  if (firstDataRequest) {
                    console.warn('[getBars]: Invalid data format on first request, returning empty data');
                    onHistoryCallback([], { noData: true });
                  } else {
                    onErrorCallback('Invalid data format');
                  }
                }
              })
              .catch(error => {
                clearTimeout(timeoutId);
                console.error('[getBars]: Fetch error:', error);
                // For first request errors, return empty data to allow chart to initialize
                if (firstDataRequest) {
                  console.warn('[getBars]: First request fetch error, returning empty data to allow initialization:', error.message);
                  onHistoryCallback([], { noData: true });
                } else {
                  if (error.name === 'AbortError') {
                    onErrorCallback('Request timeout - data range may be too large');
                  } else {
                    onErrorCallback(error.message || 'Failed to fetch historical data');
                  }
                }
              });
          },

          subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
            // Helper function to feed price data to trading bot
            const updateTradingBot = (bar) => {
              // Try to get config ID from selectedConfig first, then from active bots
              let configId = selectedConfig?.id;
              if (!configId && tradingService) {
                configId = tradingService.getCurrentActiveConfigId();
              }
              
              // If still no configId, try to get it from localStorage backup
              if (!configId) {
                const lastConfig = localStorage.getItem('lastSelectedConfig');
                if (lastConfig) {
                  try {
                    const parsedConfig = JSON.parse(lastConfig);
                    configId = parsedConfig.id;
                  } catch (error) {
                    // Ignore errors
                  }
                }
              }
            };
            
            // Set up polling for real-time updates based on resolution
            // For 1-minute charts, we need very frequent updates (every 5-10 seconds)
            // For 5-minute charts, update every 10 seconds to ensure current price updates
            // For other intervals, we can update less frequently
            let pollInterval;
            const resolutionStr = String(resolution).toLowerCase();
            if (resolutionStr === '1' || resolutionStr === '1m') {
              pollInterval = 10000; // 10 seconds for 1-minute charts
            } else if (resolutionStr === '5' || resolutionStr === '5m') {
              pollInterval = 10000; // 10 seconds for 5-minute charts - same as 1m for consistent updates
            } else if (resolutionStr === '15' || resolutionStr === '15m') {
              pollInterval = 15000; // 15 seconds for 15-minute charts
            } else if (resolutionStr === '30' || resolutionStr === '30m') {
              pollInterval = 20000; // 20 seconds for 30-minute charts
            } else {
              pollInterval = 30000; // 30 seconds for other intervals (hourly, daily, etc.)
            }
            let lastBar = null;
            
            const updateBar = async () => {
              try {
                const now = Math.floor(Date.now() / 1000);
                // For real-time updates, we only need the most recent bars
                // Use a smaller time window based on resolution
                const resolutionMinutes = parseInt(resolution) || 1;
                const timeWindow = resolutionMinutes * 60 * 10; // 10x the resolution in seconds
                const from = now - timeWindow;
                const to = now;
                
                // Request recent bars based on resolution - use countback for better real-time updates
                const resolutionStr = String(resolution).toLowerCase();
                let countback;
                if (resolutionStr === '1' || resolutionStr === '1m') {
                  countback = 10; // 10 bars for 1-minute charts
                } else if (resolutionStr === '5' || resolutionStr === '5m') {
                  countback = 12; // 12 bars (1 hour) for 5-minute charts - ensures we get current bar
                } else {
                  countback = 5; // 5 bars for other resolutions
                }
                
                const response = await fetch(
                  `${API_BASE_URL}/udf/history?symbol=${symbolInfo.name}&from_timestamp=${from}&to_timestamp=${to}&resolution=${resolution}&countback=${countback}`
                );
                
                if (!response.ok) {
                  return;
                }
                
                const data = await response.json();
                
                if (data.s === 'ok' && data.t && data.t.length > 0) {
                  // Get the latest bar (most recent)
                  const lastIndex = data.t.length - 1;
                  const bar = {
                    time: data.t[lastIndex] * 1000, // Convert to milliseconds
                    open: parseFloat(data.o[lastIndex]),
                    high: parseFloat(data.h[lastIndex]),
                    low: parseFloat(data.l[lastIndex]),
                    close: parseFloat(data.c[lastIndex]),
                    volume: parseFloat(data.v[lastIndex]) || 0
                  };
                  
                  // Check if this is a new bar or an update to the current bar
                  if (!lastBar) {
                    // First bar - always send it
                    onRealtimeCallback(bar);
                    updateTradingBot(bar);
                    lastBar = bar;
                  } else if (bar.time > lastBar.time) {
                    // New bar started - this should happen every minute for 1-min charts
                    onRealtimeCallback(bar);
                    updateTradingBot(bar);
                    lastBar = bar;
                  } else if (bar.time === lastBar.time) {
                    // Same timestamp - update current bar if data changed
                    const hasChanged = 
                      Math.abs(bar.close - lastBar.close) > 0.0001 ||
                      Math.abs(bar.high - lastBar.high) > 0.0001 ||
                      Math.abs(bar.low - lastBar.low) > 0.0001 ||
                      Math.abs(bar.volume - lastBar.volume) > 0.0001;
                    
                    // For 1-minute charts, be more aggressive about updates
                    const isOneMinute = resolution === '1' || resolution === 1;
                    
                    if (hasChanged || isOneMinute) {
                      onRealtimeCallback(bar);
                      updateTradingBot(bar);
                      lastBar = bar;
                    }
                  }
                }
              } catch (error) {
                // Ignore errors
              }
            };
            
            // Initial update - faster for shorter timeframes (1m and 5m)
            const resolutionStrForDelay = String(resolution).toLowerCase();
            const initialDelay = (resolutionStrForDelay === '1' || resolutionStrForDelay === '1m' || resolutionStrForDelay === '5' || resolutionStrForDelay === '5m') ? 500 : 1000;
            setTimeout(updateBar, initialDelay);
            
            // Set up polling interval
            const intervalId = setInterval(updateBar, pollInterval);
            
            // Store subscription
            subscribersRef.current[subscriberUID] = {
              intervalId,
              symbolInfo,
              resolution,
              lastBar: lastBar
            };
            
            console.log(`[subscribeBars]: Started polling for ${symbolInfo.name} every ${pollInterval}ms`);
          },

          unsubscribeBars: (subscriberUID) => {
            console.log('[unsubscribeBars]: Method called', subscriberUID);
            
            const subscription = subscribersRef.current[subscriberUID];
            if (subscription) {
              clearInterval(subscription.intervalId);
              delete subscribersRef.current[subscriberUID];
              console.log(`[unsubscribeBars]: Stopped polling for subscriber ${subscriberUID}`);
            }
          },

          calculateHistoryDepth: (resolution, resolutionBack, intervalBack) => {
            console.log('[calculateHistoryDepth]: Called', { resolution, resolutionBack, intervalBack });
            
            // Tell TradingView how much historical data to initially request
            // This controls the initial visible range
            if (resolution === '1') {
              // For 1-minute: request only 1 day initially
              return { resolutionBack: 'D', intervalBack: 1 };
            } else if (['3', '5', '15', '30'].includes(resolution)) {
              // For intraday: request 3 days
              return { resolutionBack: 'D', intervalBack: 3 };
            } else if (['60', '120', '240'].includes(resolution)) {
              // For hourly: request 1 week
              return { resolutionBack: 'D', intervalBack: 7 };
            } else {
              // For daily+: request 3 months
              return { resolutionBack: 'M', intervalBack: 3 };
            }
          }
        };

        // Helper function to convert interval format (1M -> 1, 5M -> 5, 1D -> D, etc.)
        const convertInterval = (interval) => {
          if (interval === '1M') return '1';
          if (interval === '5M') return '5';
          if (interval === '15M') return '15';
          if (interval === '30M') return '30';
          if (interval === '1H') return '60';
          if (interval === '4H') return '240';
          if (interval === '1D') return 'D';
          if (interval === '1W') return 'W';
          return '5'; // Default to 5 minutes
        };

        const initialInterval = selectedConfig?.interval ? convertInterval(selectedConfig.interval) : '5';

        const widgetOptions = {
          symbol: symbol || selectedConfig?.symbol || 'NU',
          datafeed: datafeed,
          interval: initialInterval,
          container: containerRef.current,
          library_path: '/charting_library/',
          locale: 'en',
          client_id: 'ib_parallel_bot',
          user_id: 'user_1',
          disabled_features: ['use_localstorage_for_settings'],
          enabled_features: ['study_templates'],
          fullscreen: false,
          autosize: true,
          theme: 'Dark',
          debug: true,
          // Enable auto-save to capture drawings
          auto_save_delay: 5,
          // Set initial visible range to 1 day for 1-minute chart
          time_frames: [
            { text: "1d", resolution: "1", description: "1 Day" },
            { text: "5d", resolution: "1", description: "5 Days" },
            { text: "1m", resolution: "5", description: "1 Month" },
            { text: "3m", resolution: "60", description: "3 Months" },
            { text: "6m", resolution: "D", description: "6 Months" },
            { text: "1y", resolution: "D", description: "1 Year" },
          ]
        };

        widget = new window.TradingView.widget(widgetOptions);
        widgetRef.current = widget;

        widget.onChartReady(() => {
          if (mounted) {
            setIsLoading(false);
            setLoadingMessage('Chart ready');
            setError(null);
            
            // Set up event listeners to detect drawing changes
            try {
              const chart = widget.chart();
              
              // Listen for drawing events
              if (typeof chart.onShapeCreated === 'function') {
                chart.onShapeCreated((shape) => {
                  console.log('🎨 Shape created:', shape);
                });
              }
              
              if (typeof chart.onShapeRemoved === 'function') {
                chart.onShapeRemoved((shape) => {
                  console.log('🗑️ Shape removed:', shape);
                });
              }
              
              if (typeof chart.onShapeChanged === 'function') {
                chart.onShapeChanged((shape) => {
                  console.log('✏️ Shape changed:', shape);
                });
              }
            } catch (error) {
              // Ignore errors
            }
            
            // Load drawings for the selected configuration
            if (selectedConfig && selectedConfig.id && onLoadDrawings) {
              // Load drawings with a delay to ensure chart is fully ready
              setTimeout(() => {
                loadDrawingsForConfig(selectedConfig.id);
              }, 1500); // Longer delay for initial load
            }
          }
        });

      } catch (err) {
        console.error('❌ Error initializing chart:', err);
        if (mounted) {
          setError(err.message || 'Failed to initialize chart');
          setIsLoading(false);
        }
      } finally {
        isInitializing = false;
      }
    };

    // Reset error state when starting
    setError(null);
    setIsLoading(true);
    setLoadingMessage('Initializing chart...');
    
    initChart();

    return () => {
      mounted = false;
      
      // Use setTimeout to defer cleanup and avoid React conflicts
      setTimeout(() => {
        // Clear all subscriptions
        Object.keys(subscribersRef.current || {}).forEach(subscriberUID => {
          const subscription = subscribersRef.current[subscriberUID];
          if (subscription && subscription.intervalId) {
            clearInterval(subscription.intervalId);
          }
        });
        subscribersRef.current = {};
        
        if (widget) {
          try {
            widget.remove();
          } catch (e) {
            // Ignore errors
          }
        }
        if (widgetRef.current && widgetRef.current !== widget) {
          try {
            widgetRef.current.remove();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        widgetRef.current = null;
      }, 0);
    };
  }, [symbol, retryKey]);

  // Load drawings and initialize trading bot when selected config changes
  useEffect(() => {
    if (selectedConfig && selectedConfig.id && widgetRef.current && !isLoading) {
      // Cancel any ongoing save/load operations for previous configs
      if (savingConfigIdRef.current && savingConfigIdRef.current !== selectedConfig.id) {
        savingConfigIdRef.current = null;
      }
      if (loadingConfigIdRef.current && loadingConfigIdRef.current !== selectedConfig.id) {
        loadingConfigIdRef.current = null;
      }
      
      // Load drawings immediately - the widget is already ready
      const loadImmediately = async () => {
        setLoadingMessage('Switching configuration...');
        
        // Set symbol and interval from the selected configuration
        if (selectedConfig.symbol || selectedConfig.interval) {
          try {
            const symbol = selectedConfig.symbol || 'NU';
            const interval = selectedConfig.interval || '5M';
            
            // Convert interval format for TradingView (1M -> 1, etc.)
            const convertInterval = (interval) => {
              if (interval === '1M') return '1';
              if (interval === '5M') return '5';
              if (interval === '15M') return '15';
              if (interval === '30M') return '30';
              if (interval === '1H') return '60';
              if (interval === '4H') return '240';
              if (interval === '1D') return 'D';
              if (interval === '1W') return 'W';
              return '1'; // Default to 1 minute
            };
            
            const convertedInterval = convertInterval(interval);
            widgetRef.current.setSymbol(symbol, convertedInterval, () => {
              // Symbol updated
            });
          } catch (error) {
            // Ignore errors
          }
        }
        
        await loadDrawingsForConfig(selectedConfig.id);
      };
      
      loadImmediately();
    }
  }, [selectedConfig?.id]); // Only depend on the ID, not the entire object

  // Handle save requests from parent component
  // Track the last processed save request to avoid duplicate saves
  const lastSaveRequestRef = useRef(0);
  
  useEffect(() => {
    if (onSaveRequested > 0 && selectedConfig && selectedConfig.id) {
      // Only process if this is a new save request (not a re-render with old value)
      if (onSaveRequested === lastSaveRequestRef.current) {
        return;
      }
      
      lastSaveRequestRef.current = onSaveRequested;
      
      // Save drawings and then reload them to redraw on chart
      const saveAndReload = async () => {
        // Double-check config is still selected before starting save
        if (!selectedConfig?.id) {
          return;
        }
        
        // Save to backend and get the updated config from PUT response
        const freshConfig = await saveDrawingsToConfig(selectedConfig.id, selectedConfig);
        
        if (freshConfig && freshConfig.layout_data) {
          // Pass the fresh data directly to loadDrawingsForConfig (no GET needed!)
          await loadDrawingsForConfig(freshConfig.id, freshConfig);
          
          // Update the bot with the line data from PUT response
          tradingService.updateBotWithChartLines(freshConfig.id, freshConfig);
        }
      };
      
      saveAndReload();
    }
  }, [onSaveRequested, selectedConfig?.id]);

  return (
    <ErrorBoundary>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', backgroundColor: '#1e293b' }}>
        <div
          style={{
            flex: 1,
            backgroundColor: '#0f172a',
            border: "1px solid #334155",
            position: 'relative',
            minHeight: '400px',
            overflow: 'hidden'
          }}
        >
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0
            }}
            suppressHydrationWarning
          />
          {(isLoading || isDrawingLines) && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              color: '#e2e8f0',
              zIndex: 10,
              pointerEvents: 'none'
            }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #334155',
                  borderTop: '4px solid #3b82f6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <div style={{
                  fontSize: '18px',
                  fontWeight: '500',
                  color: '#e2e8f0'
                }}>
                  {loadingMessage}
                </div>
                
                {/* Additional Info for Drawing Lines */}
                {isDrawingLines && (
                  <div style={{
                    fontSize: '14px',
                    color: '#94a3b8',
                    textAlign: 'center',
                    maxWidth: '300px'
                  }}>
                    Please wait while we load your configuration drawings...
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Debug buttons hidden to allow access to TradingView drawing tools */}
          {false && !isLoading && selectedConfig && (
            <div style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              zIndex: 20
            }}>
              <button
                onClick={async () => {
                  console.log('🧪 Manual save test triggered');
                  try {
                    await saveDrawingsToConfig(selectedConfig.id, selectedConfig);
                    console.log('✅ Save test completed successfully');
                  } catch (error) {
                    console.error('❌ Save test failed:', error);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Test Save (Safe)
              </button>
              <button
                onClick={async () => {
                  console.log('🧪 Manual load test triggered');
                  try {
                    await loadDrawingsForConfig(selectedConfig.id);
                    console.log('✅ Load test completed successfully');
                  } catch (error) {
                    console.error('❌ Load test failed:', error);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Test Load (Safe)
              </button>
              <button
                onClick={async () => {
                  console.log('🔍 Inspecting saved data for config:', selectedConfig.id);
                  try {
                    const savedData = await onLoadDrawings(selectedConfig.id);
                    console.log('📊 Saved data structure:', savedData);
                    console.log('📊 Layout data:', savedData?.layout_data);
                    console.log('📊 Drawings array:', savedData?.layout_data?.drawings);
                    console.log('📊 Drawings count:', savedData?.layout_data?.drawings?.length || 0);
                  } catch (error) {
                    console.error('❌ Error inspecting data:', error);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Inspect Data
              </button>
              <button
                onClick={async () => {
                  console.log('🔐 Testing authentication...');
                  try {
                    const authResult = await chartService.testAuth();
                    console.log('🔐 Auth test result:', authResult ? 'SUCCESS' : 'FAILED');
                  } catch (error) {
                    console.error('❌ Auth test error:', error);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Test Auth
              </button>
              <button
                onClick={() => {
                  console.log('🧹 Manually clearing token...');
                  chartService.clearInvalidToken();
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Clear Token
              </button>
              <button
                onClick={() => {
                  console.log('🔍 Inspecting TradingView widget methods...');
                  if (widgetRef.current) {
                    console.log('📊 Widget methods:', Object.keys(widgetRef.current));
                    console.log('📊 Widget type:', typeof widgetRef.current);
                    
                    if (widgetRef.current.chart) {
                      console.log('📊 Chart methods:', Object.keys(widgetRef.current.chart()));
                      console.log('📊 Chart type:', typeof widgetRef.current.chart());
                    }
                    
                    // Check for specific methods
                    console.log('📊 Has save method:', typeof widgetRef.current.save === 'function');
                    console.log('📊 Has load method:', typeof widgetRef.current.load === 'function');
                    console.log('📊 Has chart method:', typeof widgetRef.current.chart === 'function');
                    console.log('📊 Has getLayout method:', typeof widgetRef.current.getLayout === 'function');
                    
                    if (widgetRef.current.chart) {
                      const chart = widgetRef.current.chart();
                      console.log('📊 Chart has getAllShapes:', typeof chart.getAllShapes === 'function');
                      console.log('📊 Chart has getAllStudies:', typeof chart.getAllStudies === 'function');
                      console.log('📊 Chart has getDrawings:', typeof chart.getDrawings === 'function');
                      console.log('📊 Chart has save method:', typeof chart.save === 'function');
                      console.log('📊 Chart has getVisibleRange:', typeof chart.getVisibleRange === 'function');
                    }
                  } else {
                    console.log('❌ Widget not ready');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#06b6d4',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Inspect Widget
              </button>
              <button
                onClick={() => {
                  console.log('🔍 Deep inspection of TradingView state...');
                  if (widgetRef.current) {
                    // Try to access internal state
                    console.log('📊 Widget internal properties:');
                    Object.keys(widgetRef.current).forEach(key => {
                      if (key.startsWith('_') || key.includes('data') || key.includes('state')) {
                        console.log(`  ${key}:`, widgetRef.current[key]);
                      }
                    });
                    
                    if (widgetRef.current.chart) {
                      const chart = widgetRef.current.chart();
                      console.log('📊 Chart internal properties:');
                      Object.keys(chart).forEach(key => {
                        if (key.startsWith('_') || key.includes('data') || key.includes('state') || key.includes('drawing')) {
                          console.log(`  ${key}:`, chart[key]);
                        }
                      });
                    }
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#7c3aed',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Deep Inspect
              </button>
              <button
                onClick={async () => {
                  console.log('🧪 Testing drawing capture methods...');
                  if (selectedConfig && selectedConfig.id) {
                    await saveDrawingsToConfig(selectedConfig.id, selectedConfig);
                  } else {
                    console.log('❌ No selected config to test with');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f97316',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '10px'
                }}
              >
                Test Capture
              </button>
              <button
                onClick={() => {
                  console.log('📏 Creating test entry line...');
                  if (widgetRef.current && widgetRef.current.chart) {
                    try {
                      const chart = widgetRef.current.chart();
                      
                      // Instead of creating shapes, let's focus on detecting existing ones
                      console.log('🔍 TradingView createShape method not working, focusing on detection...');
                      
                      // Try to access TradingView's internal drawing system
                      console.log('📊 Chart methods available:', Object.keys(chart));
                      
                      // Check if there are alternative methods
                      const alternativeMethods = [
                        'createMultipointShape',
                        'createStudy',
                        'addShape',
                        'drawShape',
                        'createDrawing'
                      ];
                      
                      alternativeMethods.forEach(method => {
                        if (typeof chart[method] === 'function') {
                          console.log(`✅ Found alternative method: ${method}`);
                        } else {
                          console.log(`❌ Method not available: ${method}`);
                        }
                      });
                      
                      // Try to access the widget's internal state
                      if (widgetRef.current) {
                        console.log('📊 Widget internal properties:');
                        Object.keys(widgetRef.current).forEach(key => {
                          if (key.includes('draw') || key.includes('shape') || key.includes('chart')) {
                            console.log(`  ${key}:`, typeof widgetRef.current[key]);
                          }
                        });
                      }
                    } catch (error) {
                      console.error('❌ Error creating test line:', error);
                    }
                  } else {
                    console.log('❌ Chart not ready');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Debug Drawing API
              </button>
              <button
                onClick={() => {
                  console.log('🔍 Reading current chart state...');
                  if (widgetRef.current && widgetRef.current.chart) {
                    try {
                      const chart = widgetRef.current.chart();
                      
                      // Try to read current drawings without creating new ones
                      console.log('📊 Attempting to read existing drawings...');
                      
                      // Method 1: Try getAllShapes
                      try {
                        if (typeof chart.getAllShapes === 'function') {
                          const shapes = chart.getAllShapes();
                          console.log('📊 Current shapes:', shapes);
                          console.log('📊 Shapes count:', shapes.length);
                        }
                      } catch (e) {
                        console.log('⚠️ getAllShapes failed:', e.message);
                      }
                      
                      // Method 2: Try getAllStudies
                      try {
                        if (typeof chart.getAllStudies === 'function') {
                          const studies = chart.getAllStudies();
                          console.log('📊 Current studies:', studies);
                          console.log('📊 Studies count:', studies.length);
                        }
                      } catch (e) {
                        console.log('⚠️ getAllStudies failed:', e.message);
                      }
                      
                      // Method 3: Try getDrawings
                      try {
                        if (typeof chart.getDrawings === 'function') {
                          const drawings = chart.getDrawings();
                          console.log('📊 Current drawings:', drawings);
                          console.log('📊 Drawings count:', drawings.length);
                        }
                      } catch (e) {
                        console.log('⚠️ getDrawings failed:', e.message);
                      }
                      
                      // Method 4: Try to access internal state
                      console.log('📊 Chart object keys:', Object.keys(chart));
                      console.log('📊 Chart object:', chart);
                      
                    } catch (error) {
                      console.error('❌ Error reading chart state:', error);
                    }
                  } else {
                    console.log('❌ Chart not ready');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Read Chart State
              </button>
              <button
                onClick={async () => {
                  console.log('🧪 Testing save with simulated drawing data...');
                  if (selectedConfig && selectedConfig.id) {
                    // Simulate having drawings by manually creating test data
                    // Using the correct backend schema: Line objects with p1 and p2 points
                    const testLayoutData = {
                      entry_line: {
                        p1: { time: Math.floor(Date.now() / 1000) - 86400, price: 250.0 },
                        p2: { time: Math.floor(Date.now() / 1000), price: 255.0 }
                      },
                      exit_line: {
                        p1: { time: Math.floor(Date.now() / 1000) - 43200, price: 260.0 },
                        p2: { time: Math.floor(Date.now() / 1000), price: 265.0 }
                      },
                      tpsl_settings: {
                        tp_type: 'absolute',
                        tp_value: 270.0,
                        sl_type: 'absolute',
                        sl_value: 240.0
                      },
                      other_drawings: {
                        tradingview_drawings: [
                          {
                            id: 'test_drawing_1',
                            type: 'trend_line',
                            points: [
                              { time: Math.floor(Date.now() / 1000) - 172800, price: 240.0 },
                              { time: Math.floor(Date.now() / 1000) - 86400, price: 250.0 }
                            ],
                            style: { color: '#ffff00', linewidth: 1 }
                          }
                        ],
                        capture_method: 'simulated',
                        timestamp: Date.now()
                      }
                    };
                    
                    console.log('🧪 Saving simulated drawing data:', testLayoutData);
                    
                    // Call the save function with simulated data
                    if (onSaveDrawings) {
                      await onSaveDrawings(selectedConfig.id, { 
                        ...selectedConfig, 
                        layout_data: testLayoutData 
                      });
                      console.log('✅ Simulated drawing data saved successfully');
                    }
                  } else {
                    console.log('❌ No selected config to test with');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Test Save (Simulated)
              </button>
            </div>
          )}
      </div>

        {error && (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '24px',
            backgroundColor: '#1e293b',
            border: '2px solid #ef4444',
            color: '#e2e8f0',
            borderRadius: '12px',
            minWidth: '320px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            zIndex: 1000
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h3 style={{ margin: '0 0 8px 0', color: '#ef4444' }}>Chart Error</h3>
            <p style={{ margin: '0 0 20px 0', color: '#94a3b8' }}>{error}</p>
            <button
              onClick={handleRetry}
              style={{
                padding: '10px 24px',
                backgroundColor: '#3b82f6',
                border: 'none',
                color: 'white',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default TradingViewWidget;