import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ErrorBoundary from '../ErrorBoundary';
import chartService from '../../services/chartService';
import tradingService from '../../services/trading/TradingService.js';

const TradingViewWidget = ({ selectedConfig, onSaveDrawings, onLoadDrawings, onSaveRequested }) => {
  const { symbol } = useParams();
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const loadingConfigIdRef = useRef(null); // Track which config is currently being loaded
  const savingConfigIdRef = useRef(null); // Track which config is currently being saved
  const [isLoading, setIsLoading] = useState(true);
  const [tradingStatus, setTradingStatus] = useState(null);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isDrawingLines, setIsDrawingLines] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading chart...');

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    setRetryKey(prev => prev + 1);
  };

  // Save drawings to backend using TradingView's proper API
  const saveDrawingsToConfig = async (configId, configData) => {
    try {
      if (!widgetRef.current) {
        console.warn('⚠️ Widget not ready, cannot save drawings');
        return;
      }
      
      // Check if this is still the selected config (prevent saving wrong config)
      if (selectedConfig?.id !== configId) {
        console.warn(`⚠️ Config ${configId} is no longer selected, skipping save`);
        return;
      }
      
      // Mark this config as currently being saved
      savingConfigIdRef.current = configId;
      console.log(`🔒 Locked saving for config: ${configId}`);
      
      console.log('💾 Starting save process for config:', configId);
      
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
        console.log('💾 Attempting to capture TradingView drawings...');
        
        // Method 1: Try TradingView's built-in save method (like the working example)
        if (widgetRef.current && typeof widgetRef.current.save === 'function') {
          console.log('💾 Trying widget.save() method...');
          const tradingViewData = widgetRef.current.save();
          
          console.log('💾 Raw TradingView save data:', tradingViewData);
          
          if (tradingViewData) {
            // Check what's in the layout
            const charts = tradingViewData.charts || [];
            console.log('💾 Number of charts:', charts.length);
            
            if (charts.length > 0) {
              const panes = charts[0].panes || [];
              console.log('💾 Number of panes:', panes.length);
              
              if (panes.length > 0) {
                const sources = panes[0].sources || [];
                console.log('💾 Number of sources:', sources.length);
                console.log('💾 Source types:', sources.map(s => s.type));
                
                // Count LineToolTrendLine objects
                const trendLines = sources.filter(s => s.type === 'LineToolTrendLine');
                console.log('💾 Number of trend lines found:', trendLines.length);
                console.log('💾 All source types:', sources.map(s => ({ type: s.type, name: s.name })));
                
                if (trendLines.length > 0) {
                  console.log('💾 Trend line details:', trendLines);
                } else {
                  console.log('⚠️ No trend lines found in sources. Available sources:', sources);
                }
              }
            }
            
            // Store the full TradingView layout like the working example
            layoutData.other_drawings = {
              tradingview_layout: tradingViewData,
              layout_string: JSON.stringify(tradingViewData),
              capture_method: 'widget.save',
              timestamp: Date.now()
            };
            console.log('💾 Captured full TradingView layout via widget.save()');
          } else {
            console.log('⚠️ widget.save() returned null or undefined');
          }
        } 
        // Method 2: Try chart().save() method
        if (!layoutData.other_drawings.tradingview_layout && widgetRef.current && widgetRef.current.chart && typeof widgetRef.current.chart().save === 'function') {
          console.log('💾 Trying chart().save() method...');
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
          console.log('💾 Trying getLayout() method...');
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
          console.log('💾 Trying chart API methods...');
          const chart = widgetRef.current.chart();
          
          // Try different methods to get drawings
          let drawings = [];
          let studies = [];
          let shapes = [];
          
          // Try getAllShapes
          try {
            if (typeof chart.getAllShapes === 'function') {
              shapes = chart.getAllShapes();
              console.log('💾 Got shapes via getAllShapes():', shapes.length);
              console.log('💾 Shape details:', shapes);
              
              // Try to get full shape data for each shape
              const fullShapes = shapes.map(shape => {
                try {
                  if (typeof chart.getShapeById === 'function') {
                    const fullShape = chart.getShapeById(shape.id);
                    console.log('💾 Full shape object for', shape.id, ':', fullShape);
                    
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
                        console.log('💾 Got points for', shape.id, ':', serializableShape.points);
                      } catch (e) {
                        console.log('⚠️ Could not get points:', e.message);
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
                        console.log('💾 Got properties for', shape.id, ':', serializableShape.properties);
                        console.log('💾 Extended properties (infinite lines):', serializableShape.properties);
                      } catch (e) {
                        console.log('⚠️ Could not get properties:', e.message);
                      }
                    }
                    
                    return serializableShape;
                  }
                  return shape;
                } catch (err) {
                  console.log('⚠️ Could not get full shape data for', shape.id, ':', err.message);
                  return shape;
                }
              });
              
              shapes = fullShapes;
            }
          } catch (e) {
            console.log('⚠️ getAllShapes() failed:', e.message);
          }
          
          // Try getAllStudies
          try {
            if (typeof chart.getAllStudies === 'function') {
              studies = chart.getAllStudies();
              console.log('💾 Got studies via getAllStudies():', studies.length);
            }
          } catch (e) {
            console.log('⚠️ getAllStudies() failed:', e.message);
          }
          
          // Try getDrawings
          try {
            if (typeof chart.getDrawings === 'function') {
              drawings = chart.getDrawings();
              console.log('💾 Got drawings via getDrawings():', drawings.length);
            }
          } catch (e) {
            console.log('⚠️ getDrawings() failed:', e.message);
          }
          
          // Try getVisibleRange
          try {
            if (typeof chart.getVisibleRange === 'function') {
              const range = chart.getVisibleRange();
              console.log('💾 Got visible range:', range);
            }
          } catch (e) {
            console.log('⚠️ getVisibleRange() failed:', e.message);
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
            console.log('💾 Processing', allDrawings.length, 'drawings for schema mapping...');
            allDrawings.forEach((drawing, index) => {
              console.log(`💾 Drawing ${index}:`, { type: drawing.type, shape: drawing.shape, name: drawing.name, points: drawing.points?.length });
              
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
          
          console.log('💾 Manual capture result:', {
            drawings: drawings.length,
            studies: studies.length,
            shapes: shapes.length,
            total: drawings.length + studies.length + shapes.length,
            mapped_to_schema: {
              entry_line: layoutData.entry_line ? 'found' : 'null',
              exit_line: layoutData.exit_line ? 'found' : 'null',
              tpsl_settings: layoutData.tpsl_settings ? 'found' : 'null',
              other_drawings: Object.keys(layoutData.other_drawings).length
            }
          });
          
          // If no entry line was found, try to extract from TradingView layout data
          if (!layoutData.entry_line && layoutData.other_drawings?.tradingview_layout) {
            console.log('⚠️ No entry line found in manual capture, checking TradingView layout...');
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
            console.log('⚠️ No entry line found, using first available line as entry line');
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
              console.log('💾 Created entry line from first drawing:', layoutData.entry_line);
            }
          }
        }
        // Method 5: Try to access TradingView's internal state
        else {
          console.log('💾 Trying to access TradingView internal state...');
          
          // Check if we can access the widget's internal data
          if (widgetRef.current && widgetRef.current._data) {
            console.log('💾 Found widget internal data:', widgetRef.current._data);
            layoutData.other_drawings = {
              internal_data: widgetRef.current._data,
              access_method: 'internal_data',
              timestamp: Date.now()
            };
          } else {
            console.log('⚠️ No TradingView API methods available');
            layoutData.other_drawings = {
              error: 'No TradingView API methods available',
              available_methods: Object.keys(widgetRef.current || {}),
              chart_methods: widgetRef.current?.chart ? Object.keys(widgetRef.current.chart()) : [],
              timestamp: Date.now()
            };
          }
        }
      } catch (error) {
        console.warn('⚠️ Error getting TradingView data:', error);
        layoutData.other_drawings = {
          error: error.message,
          stack: error.stack,
          timestamp: Date.now()
        };
      }

      console.log('💾 Final layout data to save (backend schema):', layoutData);
      
      // Final check before saving to backend (prevent race condition)
      if (savingConfigIdRef.current !== configId) {
        console.warn(`⚠️ Config ${configId} is no longer being saved (current: ${savingConfigIdRef.current}), aborting save`);
        return;
      }
      
      // Call parent component's save function and get the updated config back
      if (onSaveDrawings && layoutData) {
        const updatedConfig = await onSaveDrawings(configId, { ...configData, layout_data: layoutData });
        console.log('✅ Layout data saved successfully');
        return updatedConfig; // Return the fresh config from PUT response
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error saving drawings:', error);
    }
  };

  // Load drawings from backend using TradingView's proper API
  // configData parameter allows passing fresh data directly (e.g., from PUT response)
  const loadDrawingsForConfig = async (configId, configData = null) => {
    try {
      if (!widgetRef.current) {
        console.warn('⚠️ Widget not ready, cannot load drawings');
        return;
      }
      
      // Check if this is still the selected config (prevent race conditions)
      if (selectedConfig?.id !== configId) {
        console.warn(`⚠️ Config ${configId} is no longer selected, skipping load`);
        return;
      }
      
      // Mark this config as currently loading
      loadingConfigIdRef.current = configId;
      console.log(`🔒 Locked loading for config: ${configId}`);
      
      setIsDrawingLines(true);
      setLoadingMessage('Loading configuration drawings...');
      
      console.log('📥 Loading layout data for config:', configId);
      console.log('📥 Widget ref available:', !!widgetRef.current);
      console.log('📥 Chart available:', !!widgetRef.current.chart);
      
      // Use provided configData first (e.g., from PUT response), then selectedConfig, then fetch
      let savedData = configData || selectedConfig;
      
      // Only fetch from backend if we don't have layout_data or it's incomplete
      const needsBackendFetch = !savedData?.layout_data || 
                               (savedData.layout_data && 
                                typeof savedData.layout_data === 'object' && 
                                Object.keys(savedData.layout_data).length === 0);
      
      if (needsBackendFetch && onLoadDrawings) {
        console.log('📥 Fetching from backend...');
        savedData = await onLoadDrawings(configId);
      } else {
        console.log('📥 Using existing data (skipping backend fetch)');
      }
      
      if (savedData && savedData.layout_data) {
          console.log('📥 Found saved data from backend:', savedData);
          console.log('📥 Layout data structure:', savedData.layout_data);
          
          // Check if this is the backend schema format (entry_line, exit_line, etc.)
          if (savedData.layout_data.entry_line !== undefined || 
              savedData.layout_data.exit_line !== undefined || 
              savedData.layout_data.tpsl_settings !== undefined ||
              savedData.layout_data.other_drawings !== undefined) {
            
            console.log('📥 Backend schema format detected');
            console.log('📊 Entry line:', savedData.layout_data.entry_line);
            console.log('📊 Exit line:', savedData.layout_data.exit_line);
            console.log('📊 TP/SL settings:', savedData.layout_data.tpsl_settings);
            console.log('📊 Other drawings:', savedData.layout_data.other_drawings);
            
            // Clear existing drawings first
            try {
              if (widgetRef.current && widgetRef.current.chart) {
                const chart = widgetRef.current.chart();
                
                // Remove all existing shapes
                if (typeof chart.removeAllShapes === 'function') {
                  console.log('🧹 Clearing all existing shapes...');
                  chart.removeAllShapes();
                  console.log('✅ All existing shapes cleared');
                } else {
                  console.log('⚠️ removeAllShapes method not available');
                }
              }
            } catch (clearError) {
              console.warn('⚠️ Error clearing existing shapes:', clearError);
            }
            
            // Check if there are saved drawings to restore
            if (savedData.layout_data.other_drawings && savedData.layout_data.other_drawings.tradingview_drawings) {
              console.log('📥 Found saved drawings, attempting to restore...');
              
              try {
                const chart = widgetRef.current.chart();
                const drawings = savedData.layout_data.other_drawings.tradingview_drawings;
                
                console.log('📥 Restoring', drawings.length, 'drawings');
                
                // Restore each drawing
                for (const drawing of drawings) {
                  // Check if this config is still the one being loaded (prevent race conditions)
                  if (loadingConfigIdRef.current !== configId) {
                    console.warn(`⚠️ Config ${configId} is no longer being loaded (current: ${loadingConfigIdRef.current}), aborting`);
                    return;
                  }
                  
                  try {
                    console.log('📥 Restoring drawing:', drawing);
                    console.log('📥 Drawing points:', drawing.points);
                    console.log('📥 Drawing properties:', drawing.properties);
                    
                    if (drawing.points && drawing.points.length >= 2) {
                      // Validate point format
                      const point1 = drawing.points[0];
                      const point2 = drawing.points[1];
                      
                      console.log('📥 Point 1:', point1);
                      console.log('📥 Point 2:', point2);
                      
                      // Ensure points have the correct format (time and price)
                      if (!point1 || !point2 || point1.time === undefined || point1.price === undefined) {
                        console.log('⚠️ Invalid point format, skipping drawing:', drawing.id);
                        return;
                      }
                      
                      // Try different methods to create the shape
                      let createdShape = null;
                      
                           // Method 1: Try passing points array in options
                           try {
                             console.log('📥 Trying createShape with points in options...');
                             // Ensure lines extend infinitely in both directions
                             const extendedProperties = {
                               ...drawing.properties,
                               extendLeft: true,
                               extendRight: true,
                               extend: true
                             };
                             console.log('📥 Extended properties for infinite lines:', extendedProperties);
                             
                             createdShape = chart.createShape(
                               {
                                 shape: drawing.name || 'trend_line',
                                 points: [point1, point2],
                                 lock: false,
                                 overrides: extendedProperties
                               }
                             );
                             console.log('✅ Created shape with points in options');
                           } catch (e1) {
                        console.log('⚠️ Method 1 failed:', e1.message);
                        
                        // Method 2: Try passing first point, then set second point
                        try {
                          console.log('📥 Trying createShape with first point only...');
                          // Ensure lines extend infinitely in both directions
                          const extendedProperties = {
                            ...drawing.properties,
                            extendLeft: true,
                            extendRight: true,
                            extend: true
                          };
                          console.log('📥 Extended properties for infinite lines (Method 2):', extendedProperties);
                          
                          createdShape = chart.createShape(
                            point1,
                            {
                              shape: drawing.name || 'trend_line',
                              lock: false,
                              overrides: extendedProperties
                            }
                          );
                          
                          if (createdShape && typeof createdShape.setPoint === 'function') {
                            console.log('📥 Setting second point...');
                            createdShape.setPoint(1, point2);
                            console.log('✅ Created shape and set second point');
                          }
                        } catch (e2) {
                          console.log('⚠️ Method 2 failed:', e2.message);
                          
                               // Method 3: Try createMultipointShape directly
                               try {
                                 console.log('📥 Trying createMultipointShape...');
                                 if (typeof chart.createMultipointShape === 'function') {
                                   // Ensure lines extend infinitely in both directions
                                   const extendedProperties = {
                                     ...drawing.properties,
                                     extendLeft: true,
                                     extendRight: true,
                                     extend: true
                                   };
                                   console.log('📥 Extended properties for infinite lines (Method 3):', extendedProperties);
                                   
                                   createdShape = chart.createMultipointShape(
                                     [point1, point2],
                                     {
                                       shape: drawing.name || 'trend_line',
                                       overrides: extendedProperties
                                     }
                                   );
                                   console.log('✅ Created shape with createMultipointShape');
                                 }
                               } catch (e3) {
                                 console.log('⚠️ Method 3 failed:', e3.message);
                               }
                        }
                      }
                      
                      if (createdShape) {
                        console.log('✅ Restored drawing:', drawing.id);
                      } else {
                        console.log('❌ Failed to restore drawing:', drawing.id);
                      }
                    } else {
                      console.log('⚠️ Drawing has insufficient points:', drawing.points?.length || 0);
                    }
                  } catch (drawError) {
                    console.error('❌ Error restoring drawing:', drawing.id, drawError);
                    console.error('❌ Drawing data:', drawing);
                  }
                }
                
                console.log('✅ All drawings restored successfully');
                return;
              } catch (loadError) {
                console.error('❌ Error loading drawings:', loadError);
                console.log('⚠️ Falling back to manual line drawing...');
              }
            }
            
            // Fallback: Draw the lines manually on the chart
            try {
              if (widgetRef.current && widgetRef.current.chart) {
                const chart = widgetRef.current.chart();
                
                // Draw entry line
                if (savedData.layout_data.entry_line && savedData.layout_data.entry_line.p1 && savedData.layout_data.entry_line.p2) {
                  console.log('📈 Drawing entry line...');
                  try {
                    const entryLine = chart.createShape(
                      { time: savedData.layout_data.entry_line.p1.time, price: savedData.layout_data.entry_line.p1.price },
                      {
                        shape: 'trend_line',
                        lock: false,
                        disableSelection: false,
                        disableSave: false,
                        disableUndo: false,
                        overrides: {
                          linecolor: '#00ff00',
                          linewidth: 2,
                          linestyle: 0,
                          showLabel: true,
                          textcolor: '#00ff00',
                          text: 'Entry Line'
                        }
                      }
                    );
                    
                    if (entryLine) {
                      entryLine.setPoint(1, { time: savedData.layout_data.entry_line.p2.time, price: savedData.layout_data.entry_line.p2.price });
                      console.log('✅ Entry line drawn successfully');
                    }
                  } catch (error) {
                    console.error('❌ Error drawing entry line:', error.message);
                  }
                }
                
                // Draw exit line
                if (savedData.layout_data.exit_line && savedData.layout_data.exit_line.p1 && savedData.layout_data.exit_line.p2) {
                  console.log('📈 Drawing exit line...');
                  try {
                    const exitLine = chart.createShape(
                      { time: savedData.layout_data.exit_line.p1.time, price: savedData.layout_data.exit_line.p1.price },
                      {
                        shape: 'trend_line',
                        lock: false,
                        disableSelection: false,
                        disableSave: false,
                        disableUndo: false,
                        overrides: {
                          linecolor: '#ff0000',
                          linewidth: 2,
                          linestyle: 0,
                          showLabel: true,
                          textcolor: '#ff0000',
                          text: 'Exit Line'
                        }
                      }
                    );
                    
                    if (exitLine) {
                      exitLine.setPoint(1, { time: savedData.layout_data.exit_line.p2.time, price: savedData.layout_data.exit_line.p2.price });
                      console.log('✅ Exit line drawn successfully');
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
                
                console.log('✅ All lines drawn successfully');
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
      setIsDrawingLines(false);
      setLoadingMessage('Loading chart...');
    }
  };

  useEffect(() => {
    // Initialize trading service
    tradingService.initialize({
      onBotStatusChange: (configId, status, data) => {
        console.log(`🤖 Bot status change for config ${configId}:`, status, data);
        setTradingStatus({ configId, status, data });
      },
      onOrderUpdate: (configId, type, order) => {
        console.log(`📈 Order ${type} for config ${configId}:`, order);
      },
      onError: (configId, error) => {
        console.error(`❌ Trading error for config ${configId}:`, error);
        setError(`Trading Error: ${error}`);
      }
    });

    let mounted = true;
    let widget = null;
    let isInitializing = false;

    const initChart = async () => {
      if (isInitializing) {
        console.log('⏳ Already initializing, skipping...');
        return;
      }

      isInitializing = true;

      try {
        // Clean up any existing widget first
        if (widgetRef.current) {
          try {
            console.log('🧹 Removing existing widget...');
            widgetRef.current.remove();
          } catch (e) {
            console.warn('Error removing old widget:', e);
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
          console.log('📚 Loading TradingView library...');
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

        console.log('🚀 Creating TradingView widget with custom UDF datafeed');
        
        // Store active subscriptions for real-time updates
        const subscribers = {};
        
        // Custom UDF-compatible datafeed
        const datafeed = {
          onReady: (callback) => {
            console.log('[onReady]: Method called');
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
            console.log('[searchSymbols]: Method called');
            fetch(`http://localhost:8000/udf/search?query=${userInput}&limit=50`)
              .then(response => response.json())
              .then(data => onResultReadyCallback(data))
              .catch(() => onResultReadyCallback([]));
          },

          resolveSymbol: (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
            console.log('[resolveSymbol]: Method called', symbolName);
            
            fetch(`http://localhost:8000/udf/symbol?symbol=${symbolName}`)
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
                console.log('[resolveSymbol]: Symbol resolved', symbolInfo);
                onSymbolResolvedCallback(symbolInfo);
              })
              .catch(error => {
                console.error('[resolveSymbol]: Error', error);
                onResolveErrorCallback('Cannot resolve symbol');
              });
          },

          getBars: (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) => {
            const { from, to, firstDataRequest, countBack } = periodParams;
            
            const daysDiff = (to - from) / 86400;
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[getBars]: Called', {
              symbol: symbolInfo.name,
              resolution,
              from: new Date(from * 1000).toISOString(),
              to: new Date(to * 1000).toISOString(),
              daysDiff: daysDiff.toFixed(2),
              firstDataRequest,
              countBack
            });
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            fetch(`http://localhost:8000/udf/history?symbol=${symbolInfo.name}&from_timestamp=${from}&to_timestamp=${to}&resolution=${resolution}`)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
              })
              .then(data => {
                console.log('[getBars]: Data received', {
                  status: data.s,
                  bars: data.t?.length || 0,
                  firstTime: data.t?.[0] ? new Date(data.t[0] * 1000).toISOString() : null,
                  lastTime: data.t?.[data.t.length - 1] ? new Date(data.t[data.t.length - 1] * 1000).toISOString() : null
                });
                
                if (data.s === 'ok' && data.t && data.t.length > 0) {
                  const bars = data.t.map((time, index) => ({
                    time: time * 1000,
                    open: data.o[index],
                    high: data.h[index],
                    low: data.l[index],
                    close: data.c[index],
                    volume: data.v[index]
                  }));
                  
                  // Sort bars by time (ascending)
                  bars.sort((a, b) => a.time - b.time);
                  
                  console.log('[getBars]: Returning', bars.length, 'bars');
                  console.log('[getBars]: First bar:', new Date(bars[0].time).toISOString());
                  console.log('[getBars]: Last bar:', new Date(bars[bars.length - 1].time).toISOString());
                  console.log('[getBars]: Requested from:', new Date(from * 1000).toISOString());
                  console.log('[getBars]: Requested to:', new Date(to * 1000).toISOString());
                  
                  // Always tell TradingView there might be more data (noData: false)
                  // This allows continuous loading when panning
                  onHistoryCallback(bars, { noData: false });
                } else if (data.s === 'no_data') {
                  console.log('[getBars]: No data available');
                  onHistoryCallback([], { noData: true });
                } else if (data.s === 'error') {
                  console.error('[getBars]: Server error:', data.errmsg);
                  onErrorCallback(data.errmsg || 'Unknown error');
                } else {
                  onErrorCallback('Invalid data format');
                }
              })
              .catch(error => {
                console.error('[getBars]: Error', error);
                onErrorCallback(error.message);
              });
          },

          subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
            // Helper function to feed price data to trading bot
            const updateTradingBot = (bar) => {
              if (selectedConfig?.id && tradingService) {
                tradingService.processMarketData(selectedConfig.id, {
                  price: bar.close,
                  time: bar.time,
                  volume: bar.volume,
                  high: bar.high,
                  low: bar.low,
                  open: bar.open
                });
              }
            };
            console.log('[subscribeBars]: Method called', {
              subscriberUID,
              symbol: symbolInfo.name,
              resolution: resolution,
              resolutionType: typeof resolution
            });
            
            // Set up polling for real-time updates based on resolution
            // For 1-minute charts, we need very frequent updates (every 1-5 seconds)
            // For other intervals, we can update less frequently
            let pollInterval;
            if (resolution === '1' || resolution === 1 || resolution === '1m') {
              pollInterval = 5000; // 5 seconds for 1-minute charts
              console.log('⏰ Using 1-minute polling interval (5s)');
            } else if (resolution === '5' || resolution === 5 || resolution === '5m') {
              pollInterval = 15000; // 15 seconds for 5-minute charts
              console.log('⏰ Using 5-minute polling interval (15s)');
            } else {
              pollInterval = 30000; // 30 seconds for other intervals
              console.log('⏰ Using default polling interval (30s)');
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
                
                console.log(`🔄 [subscribeBars] Fetching real-time data for ${resolution}-min chart:`, {
                  resolutionMinutes,
                  timeWindow,
                  from: new Date(from * 1000).toISOString(),
                  to: new Date(to * 1000).toISOString()
                });
                
                // For 1-minute charts, always request more recent data and use countback
                const countback = resolution === '1' || resolution === 1 ? 10 : 5;
                
                const response = await fetch(
                  `http://localhost:8000/udf/history?symbol=${symbolInfo.name}&from_timestamp=${from}&to_timestamp=${to}&resolution=${resolution}&countback=${countback}`
                );
                
                if (!response.ok) {
                  console.warn('[subscribeBars]: HTTP error', response.status);
                  return;
                }
                
                const data = await response.json();
                
                console.log('[subscribeBars]: Polling response', {
                  symbol: symbolInfo.name,
                  resolution: resolution,
                  status: data.s,
                  barsCount: data.t?.length || 0,
                  currentTime: new Date().toISOString(),
                  lastTimestamp: data.t && data.t.length > 0 ? new Date(data.t[data.t.length - 1] * 1000).toISOString() : 'none'
                });
                
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
                  
                  // Enhanced logging for debugging
                  const barTime = new Date(bar.time);
                  const lastBarTime = lastBar ? new Date(lastBar.time) : null;
                  
                  console.log('[subscribeBars]: Processing bar', {
                    resolution: resolution,
                    barTime: barTime.toISOString(),
                    barTimeMinutes: barTime.getMinutes(),
                    barTimeSeconds: barTime.getSeconds(),
                    lastBarTime: lastBarTime ? lastBarTime.toISOString() : 'none',
                    lastBarTimeMinutes: lastBarTime ? lastBarTime.getMinutes() : 'none',
                    timeDiff: lastBar ? (bar.time - lastBar.time) / 1000 : 'first',
                    close: bar.close
                  });
                  
                  // Check if this is a new bar or an update to the current bar
                  if (!lastBar) {
                    // First bar - always send it
                    console.log('[subscribeBars]: ✅ Initial bar sent', {
                      time: barTime.toISOString(),
                      close: bar.close,
                      volume: bar.volume
                    });
                    onRealtimeCallback(bar);
                    updateTradingBot(bar);
                    lastBar = bar;
                  } else if (bar.time > lastBar.time) {
                    // New bar started - this should happen every minute for 1-min charts
                    console.log('[subscribeBars]: ✅ NEW BAR detected', {
                      resolution: resolution,
                      oldTime: lastBarTime.toISOString(),
                      newTime: barTime.toISOString(),
                      timeDiffSeconds: (bar.time - lastBar.time) / 1000,
                      close: bar.close
                    });
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
                      console.log('[subscribeBars]: ✅ Current bar updated', {
                        resolution: resolution,
                        time: barTime.toISOString(),
                        oldClose: lastBar.close,
                        newClose: bar.close,
                        oldVolume: lastBar.volume,
                        newVolume: bar.volume,
                        changed: hasChanged,
                        forcedUpdate: isOneMinute && !hasChanged
                      });
                      onRealtimeCallback(bar);
                      updateTradingBot(bar);
                      lastBar = bar;
                    } else {
                      console.log('[subscribeBars]: ⏸️ No changes detected for current bar', {
                        resolution: resolution,
                        time: barTime.toISOString(),
                        close: bar.close,
                        volume: bar.volume
                      });
                    }
                  } else {
                    // This shouldn't happen - bar.time < lastBar.time
                    console.warn('[subscribeBars]: ⚠️ Received older bar', {
                      receivedTime: barTime.toISOString(),
                      lastBarTime: lastBarTime.toISOString(),
                      skipping: true
                    });
                  }
                }
              } catch (error) {
                console.error('[subscribeBars]: Error fetching real-time data', error);
              }
            };
            
            // Initial update - faster for shorter timeframes
            const initialDelay = resolution === '1' || resolution === 1 ? 500 : 1000;
            setTimeout(updateBar, initialDelay);
            
            // Set up polling interval
            const intervalId = setInterval(updateBar, pollInterval);
            
            // Store subscription
            subscribers[subscriberUID] = {
              intervalId,
              symbolInfo,
              resolution,
              lastBar: lastBar
            };
            
            console.log(`[subscribeBars]: Started polling for ${symbolInfo.name} every ${pollInterval}ms`);
          },

          unsubscribeBars: (subscriberUID) => {
            console.log('[unsubscribeBars]: Method called', subscriberUID);
            
            const subscription = subscribers[subscriberUID];
            if (subscription) {
              clearInterval(subscription.intervalId);
              delete subscribers[subscriberUID];
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
          return '1'; // Default to 1 minute
        };

        const initialInterval = selectedConfig?.interval ? convertInterval(selectedConfig.interval) : '1';
        
        const widgetOptions = {
          symbol: symbol || selectedConfig?.symbol || 'AAPL',
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
        console.log('✅ TradingView widget created');

        widget.onChartReady(() => {
          if (mounted) {
            console.log('🎉 Chart is ready!');
            setIsLoading(false);
            setLoadingMessage('Chart ready');
            setError(null);
            
            // Debug: Log available methods
            console.log('🔍 TradingView widget methods:', Object.keys(widget));
            if (widget.chart) {
              console.log('🔍 Chart methods:', Object.keys(widget.chart()));
            }
            
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
              
              // Listen for study events
              if (typeof chart.onStudyAdded === 'function') {
                chart.onStudyAdded((study) => {
                  console.log('📊 Study added:', study);
                });
              }
              
              console.log('✅ Event listeners set up for drawing detection');
            } catch (error) {
              console.warn('⚠️ Could not set up event listeners:', error);
            }
            
            // Load drawings for the selected configuration
            if (selectedConfig && selectedConfig.id && onLoadDrawings) {
              console.log('🎉 Chart ready, loading drawings for config:', selectedConfig.id);
              
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
      console.log('🔄 Component unmounting or re-rendering...');
      mounted = false;
      
      // Use setTimeout to defer cleanup and avoid React conflicts
      setTimeout(() => {
        // Clear all subscriptions
        Object.keys(subscribers || {}).forEach(subscriberUID => {
          const subscription = subscribers[subscriberUID];
          if (subscription && subscription.intervalId) {
            clearInterval(subscription.intervalId);
            console.log(`🧹 Cleared subscription ${subscriberUID}`);
          }
        });
        
        if (widget) {
          try {
            console.log('🧹 Cleaning up widget (deferred)');
            widget.remove();
          } catch (e) {
            console.warn('Cleanup error:', e);
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
      console.log('🔄 Config changed, loading drawings and initializing trading bot for:', selectedConfig.id);
      
      // Cancel any ongoing save/load operations for previous configs
      if (savingConfigIdRef.current && savingConfigIdRef.current !== selectedConfig.id) {
        console.log(`🚫 Cancelling save for config ${savingConfigIdRef.current}`);
        savingConfigIdRef.current = null;
      }
      if (loadingConfigIdRef.current && loadingConfigIdRef.current !== selectedConfig.id) {
        console.log(`🚫 Cancelling load for config ${loadingConfigIdRef.current}`);
        loadingConfigIdRef.current = null;
      }
      
      // Load drawings immediately - the widget is already ready
      const loadImmediately = async () => {
        console.log('⚡ Loading configuration immediately...');
        setLoadingMessage('Switching configuration...');
        
        // Set symbol and interval from the selected configuration
        if (selectedConfig.symbol || selectedConfig.interval) {
          try {
            const symbol = selectedConfig.symbol || 'AAPL';
            const interval = selectedConfig.interval || '1M';
            
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
            console.log(`🔄 Setting symbol to ${symbol} and interval to ${interval} (converted: ${convertedInterval})`);
            widgetRef.current.setSymbol(symbol, convertedInterval, () => {
              console.log('✅ Symbol and interval updated successfully');
            });
          } catch (error) {
            console.warn('⚠️ Could not update symbol/interval:', error);
          }
        }
        
        await loadDrawingsForConfig(selectedConfig.id);
        
        // Initialize trading bot with configuration
        const bot = tradingService.createBotFromConfig(selectedConfig);
        if (bot) {
          console.log('🤖 Trading bot created for config:', selectedConfig.id);
          
          // Update bot with chart lines immediately after drawings are loaded
          if (selectedConfig.layout_data) {
            tradingService.updateBotWithChartLines(selectedConfig.id, selectedConfig.layout_data);
            console.log('📊 Trading bot updated with chart lines');
          }
        }
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
        console.log('⏭️ Skipping duplicate save request');
        return;
      }
      
      lastSaveRequestRef.current = onSaveRequested;
      console.log('💾 Save requested for config:', selectedConfig.id);
      console.log('💾 onSaveRequested value:', onSaveRequested);
      
      // Save drawings and then reload them to redraw on chart
      const saveAndReload = async () => {
        // Double-check config is still selected before starting save
        if (!selectedConfig?.id) {
          console.warn('⚠️ Config changed before save could start, aborting');
          return;
        }
        
        // Save to backend and get the updated config from PUT response
        const freshConfig = await saveDrawingsToConfig(selectedConfig.id, selectedConfig);
        
        if (freshConfig && freshConfig.layout_data) {
          console.log('📥 Got fresh config from save, reloading drawings to redraw on chart...');
          
          // Pass the fresh data directly to loadDrawingsForConfig (no GET needed!)
          await loadDrawingsForConfig(freshConfig.id, freshConfig);
          
          // Update the bot with the line data from PUT response
          console.log('🤖 Updating bot with fresh line data after save...');
          tradingService.updateBotWithChartLines(freshConfig.id, freshConfig.layout_data);
        } else {
          console.warn('⚠️ No fresh config data returned from save');
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