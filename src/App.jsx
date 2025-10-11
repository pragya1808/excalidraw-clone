import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const toolbarRef = useRef(null);
  const fileInputRef = useRef(null);

  // scene & mutable refs
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef(null);
  const pointerIdRef = useRef(null);
  const redoStackRef = useRef([]);
  const rafPendingRef = useRef(false);
  const selectedElementsRef = useRef([]);
  const dragStartRef = useRef(null);
  const dragOffsetRef = useRef([]);
  const isPanningRef = useRef(false);
  const panStartRef = useRef(null);
  const lastPanRef = useRef({ x: 0, y: 0 });

  // UI state
  const [color, setColor] = useState('#1e1e1e'); // Official Excalidraw black
  const [fillColor, setFillColor] = useState('transparent');
  const [width, setWidth] = useState(3);
  const [tool, setTool] = useState('pen');
  const [showGrid, setShowGrid] = useState(true);
  const [selectedCount, setSelectedCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [theme, setTheme] = useState('light');
  const eraseSize = 15; // fixed eraser size
  const [version, setVersion] = useState(0);
  function bump() { setVersion(v => v + 1); }

  // Resize + DPR handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      const toolbarHeight = toolbarRef.current ? toolbarRef.current.offsetHeight : 0;
      const w = window.innerWidth;
      const h = window.innerHeight - toolbarHeight;
      const DPR = window.devicePixelRatio || 1;

      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width = Math.floor(w * DPR);
      canvas.height = Math.floor(h * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      redraw();
    }

    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Autosave
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        localStorage.setItem('excalidraw_clone_scene', JSON.stringify(strokesRef.current));
      } catch { }
    }, 2000);

    const saved = localStorage.getItem('excalidraw_clone_scene');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const loaded = Array.isArray(parsed) ? parsed : parsed?.strokes || [];
        strokesRef.current = loaded.map(s => (s && s.type) ? s : ({ ...s, type: 'pen' }));
        redraw();
      } catch { }
    }

    return () => clearInterval(interval);
  }, []);

  /* ---------- Drawing helpers ---------- */
  function getPos(evt) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (evt.clientX - rect.left - panX) / zoom;
    const y = (evt.clientY - rect.top - panY) / zoom;
    return { x, y };
  }

  function getScreenPos(worldPos) {
    return {
      x: worldPos.x * zoom + panX,
      y: worldPos.y * zoom + panY
    };
  }

  function constrainAspectRatio(start, end, shapeType) {
    if (!isShiftPressed) return end;

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (shapeType === 'rect') {
      // For rectangles, make it a square
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return {
        x: start.x + (dx >= 0 ? size : -size),
        y: start.y + (dy >= 0 ? size : -size)
      };
    } else if (shapeType === 'circle') {
      // For circles, already naturally constrained, but ensure perfect circle
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return {
        x: start.x + (dx >= 0 ? size : -size),
        y: start.y + (dy >= 0 ? size : -size)
      };
    } else if (shapeType === 'line') {
      // For lines, constrain to 45-degree angles
      const angle = Math.atan2(dy, dx);
      const length = Math.sqrt(dx * dx + dy * dy);
      const constrainedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return {
        x: start.x + Math.cos(constrainedAngle) * length,
        y: start.y + Math.sin(constrainedAngle) * length
      };
    }

    return end;
  }

  function drawGrid(ctx, canvas) {
    if (!showGrid) return;
    const gridSize = 20;
    // Get grid color based on theme
    const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5 / zoom;
    ctx.beginPath();

    // Calculate visible area in world coordinates
    const startX = Math.floor(-panX / zoom / gridSize) * gridSize;
    const endX = Math.ceil((canvas.width - panX) / zoom / gridSize) * gridSize;
    const startY = Math.floor(-panY / zoom / gridSize) * gridSize;
    const endY = Math.ceil((canvas.height - panY) / zoom / gridSize) * gridSize;

    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  function drawPenStroke(ctx, stroke) {
    if (!stroke.points?.length) return;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    const pts = stroke.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawRect(ctx, s) {
    const x = Math.min(s.start.x, s.end.x);
    const y = Math.min(s.start.y, s.end.y);
    const w = Math.abs(s.end.x - s.start.x);
    const h = Math.abs(s.end.y - s.start.y);

    if (s.fillColor && s.fillColor !== 'transparent') {
      ctx.fillStyle = s.fillColor;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeRect(x, y, w, h);
  }

  function drawCircle(ctx, s) {
    const cx = (s.start.x + s.end.x) / 2;
    const cy = (s.start.y + s.end.y) / 2;
    const rx = Math.abs(s.end.x - s.start.x) / 2;
    const ry = Math.abs(s.end.y - s.start.y) / 2;
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    else ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);

    if (s.fillColor && s.fillColor !== 'transparent') {
      ctx.fillStyle = s.fillColor;
      ctx.fill();
    }
    ctx.stroke();
  }

  function drawLine(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s.start.x, s.start.y);
    ctx.lineTo(s.end.x, s.end.y);
    ctx.stroke();
  }

  function isPointInElement(point, element) {
    if (element.type === 'pen') {
      return element.points.some(pt => {
        const dx = pt.x - point.x;
        const dy = pt.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < 10;
      });
    } else if (element.start && element.end) {
      const minX = Math.min(element.start.x, element.end.x);
      const maxX = Math.max(element.start.x, element.end.x);
      const minY = Math.min(element.start.y, element.end.y);
      const maxY = Math.max(element.start.y, element.end.y);
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }
    return false;
  }

  function drawSelectionBox(ctx, elements) {
    if (!elements.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    elements.forEach(element => {
      if (element.type === 'pen') {
        element.points.forEach(pt => {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        });
      } else if (element.start && element.end) {
        minX = Math.min(minX, element.start.x, element.end.x);
        minY = Math.min(minY, element.start.y, element.end.y);
        maxX = Math.max(maxX, element.start.x, element.end.x);
        maxY = Math.max(maxY, element.start.y, element.end.y);
      }
    });

    const padding = 5;
    ctx.strokeStyle = '#5f55ee'; // Official Excalidraw primary color
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX - padding, minY - padding, maxX - minX + padding * 2, maxY - minY + padding * 2);
    ctx.setLineDash([]);
  }

  function drawLastSegment(ctx, stroke) {
    const pts = stroke.points;
    if (pts.length < 2) return drawPenStroke(ctx, stroke);
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Set canvas background based on theme
    const canvasBackground = theme === 'dark' ? '#121212' : '#ffffff';
    ctx.fillStyle = canvasBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save context and apply transformations
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw grid
    drawGrid(ctx, canvas);

    // Draw all strokes
    for (const s of strokesRef.current) {
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = s.color || '#000';
      ctx.lineWidth = (s.width || 1) / zoom; // Adjust line width for zoom

      if (s.type === 'pen') drawPenStroke(ctx, s);
      else if (s.type === 'rect') drawRect(ctx, s);
      else if (s.type === 'circle') drawCircle(ctx, s);
      else if (s.type === 'line') drawLine(ctx, s);
    }

    // Draw selection box
    if (tool === 'select') {
      drawSelectionBox(ctx, selectedElementsRef.current);
    }

    // Restore context
    ctx.restore();
  }

  function drawPreview(ctx, preview) {
    if (!preview) return;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = preview.color;
    ctx.lineWidth = preview.width;
    if (preview.type === 'rect') drawRect(ctx, preview);
    else if (preview.type === 'circle') drawCircle(ctx, preview);
    else if (preview.type === 'line') drawLine(ctx, preview);
  }

  /* ---------- Pointer events ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function eraseAt(p) {
      strokesRef.current = strokesRef.current.filter(stroke => {
        if (stroke.type === 'pen') {
          return !stroke.points.some(pt => {
            const dx = pt.x - p.x;
            const dy = pt.y - p.y;
            return Math.sqrt(dx * dx + dy * dy) < eraseSize;
          });
        } else if (stroke.start && stroke.end) {
          const minX = Math.min(stroke.start.x, stroke.end.x);
          const maxX = Math.max(stroke.start.x, stroke.end.x);
          const minY = Math.min(stroke.start.y, stroke.end.y);
          const maxY = Math.max(stroke.start.y, stroke.end.y);
          return !(
            p.x >= minX - eraseSize &&
            p.x <= maxX + eraseSize &&
            p.y >= minY - eraseSize &&
            p.y <= maxY + eraseSize
          );
        }
        return true;
      });
    }

    function onPointerDown(e) {
      e.preventDefault?.();
      canvas.setPointerCapture?.(e.pointerId);
      pointerIdRef.current = e.pointerId;
      const p = getPos(e);

      // Handle panning with middle mouse button or space+left click
      if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        lastPanRef.current = { x: panX, y: panY };
        canvas.style.cursor = 'grabbing';
        return;
      }

      if (tool === 'select') {
        // Find element under cursor
        const clickedElement = strokesRef.current.find(element => isPointInElement(p, element));

        if (clickedElement) {
          // Multi-select with Ctrl/Cmd or Shift key (Excalidraw behavior)
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            if (selectedElementsRef.current.includes(clickedElement)) {
              // Remove from selection (Ctrl/Cmd+click behavior)
              if (e.ctrlKey || e.metaKey) {
                updateSelection(selectedElementsRef.current.filter(el => el !== clickedElement));
              }
              // Shift+click on already selected item keeps it selected
            } else {
              // Add to selection (both Ctrl/Cmd+click and Shift+click)
              updateSelection([...selectedElementsRef.current, clickedElement]);
            }
          } else {
            // Single select (clear previous selection)
            updateSelection([clickedElement]);
          }

          // Start dragging if we have selected elements
          if (selectedElementsRef.current.length > 0) {
            drawingRef.current = true;
            dragStartRef.current = p;
            dragOffsetRef.current = selectedElementsRef.current.map(element => {
              if (element.type === 'pen') {
                return element.points.map(pt => ({ x: pt.x - p.x, y: pt.y - p.y }));
              } else {
                return {
                  start: { x: element.start.x - p.x, y: element.start.y - p.y },
                  end: { x: element.end.x - p.x, y: element.end.y - p.y }
                };
              }
            });
          }
        } else {
          // Clear selection if not holding Ctrl/Cmd/Shift (Excalidraw behavior)
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            updateSelection([]);
          }
        }
        redraw();
        bump();
        return;
      }

      redoStackRef.current = [];

      if (tool === 'eraser') {
        eraseAt(p);
        redraw();
        bump();
        drawingRef.current = true;
        return;
      }

      drawingRef.current = true;

      if (tool === 'pen') {
        const stroke = { type: 'pen', color, width, points: [p] };
        currentStrokeRef.current = stroke;
        strokesRef.current.push(stroke);
        drawLastSegment(ctx, stroke);
        bump();
      } else {
        const shape = { type: tool, color, width, fillColor, start: p, end: p };
        currentStrokeRef.current = shape;
        redraw();
        drawPreview(ctx, shape);
        bump();
      }
    }

    function onPointerMove(e) {
      // Handle panning
      if (isPanningRef.current && e.pointerId === pointerIdRef.current) {
        const deltaX = e.clientX - panStartRef.current.x;
        const deltaY = e.clientY - panStartRef.current.y;
        setPanX(lastPanRef.current.x + deltaX);
        setPanY(lastPanRef.current.y + deltaY);
        return;
      }

      const p = getPos(e);

      if (tool === 'select' && drawingRef.current && e.pointerId === pointerIdRef.current) {
        // Move selected elements
        selectedElementsRef.current.forEach((element, index) => {
          const offset = dragOffsetRef.current[index];
          if (element.type === 'pen') {
            element.points = offset.map(o => ({ x: p.x + o.x, y: p.y + o.y }));
          } else {
            element.start = { x: p.x + offset.start.x, y: p.y + offset.start.y };
            element.end = { x: p.x + offset.end.x, y: p.y + offset.end.y };
          }
        });

        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => {
            rafPendingRef.current = false;
            redraw();
          });
        }
        return;
      }

      if (tool === 'eraser' && e.pointerId === pointerIdRef.current && drawingRef.current) {
        eraseAt(p);
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => {
            rafPendingRef.current = false;
            redraw();
            bump();
          });
        }
        return;
      }

      if (!drawingRef.current || e.pointerId !== pointerIdRef.current) return;
      const current = currentStrokeRef.current;
      if (!current) return;

      if (current.type === 'pen') {
        current.points.push(p);
        drawLastSegment(ctx, current);
      } else {
        // Apply aspect ratio constraint when Shift is held
        current.end = constrainAspectRatio(current.start, p, current.type);
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => {
            rafPendingRef.current = false;
            redraw();
            drawPreview(ctx, current);
          });
        }
      }
    }

    function onPointerUp(e) {
      if (e.pointerId !== pointerIdRef.current) return;

      // Handle panning end
      if (isPanningRef.current) {
        isPanningRef.current = false;
        panStartRef.current = null;
        canvas.style.cursor = 'default';
        return;
      }

      drawingRef.current = false;
      pointerIdRef.current = null;

      if (tool === 'select') {
        dragStartRef.current = null;
        dragOffsetRef.current = [];
        redraw();
        bump();
        return;
      }

      const current = currentStrokeRef.current;
      currentStrokeRef.current = null;

      if (!current || tool === 'eraser') {
        redraw();
        bump();
        return;
      }

      if (current.type !== 'pen') {
        strokesRef.current.push(current);
      }
      redraw();
      bump();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [tool, color, width]);

  // Redraw when grid setting changes or zoom/pan changes
  useEffect(() => {
    redraw();
  }, [showGrid, zoom, panX, panY]);

  // Theme management
  useEffect(() => {
    // Load theme from localStorage or system preference
    const savedTheme = localStorage.getItem('excalidraw-theme');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initialTheme = savedTheme || systemTheme;

    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e) => {
      if (!localStorage.getItem('excalidraw-theme')) {
        const newTheme = e.matches ? 'dark' : 'light';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    };

    mediaQuery.addEventListener('change', handleThemeChange);
    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  }, []);

  // Update theme when state changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('excalidraw-theme', theme);
    redraw(); // Redraw to update colors
  }, [theme]);

  // Comprehensive Excalidraw-style keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      // Prevent shortcuts when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Space key for pan mode
      if (e.key === ' ' && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      // Track Shift key for constraining aspect ratio
      if (e.key === 'Shift' && !isShiftPressed) {
        setIsShiftPressed(true);
        return;
      }

      // Selection & Deletion shortcuts
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementsRef.current.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (showHelpModal) {
          setShowHelpModal(false);
        } else {
          updateSelection([]);
          setTool('select'); // Switch to selection tool like Excalidraw
          redraw();
          bump();
        }
        return;
      }

      // Modifier key combinations
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          // Undo/Redo
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              redo(); // Ctrl+Shift+Z
            } else {
              undo(); // Ctrl+Z
            }
            break;

          case 'y':
            e.preventDefault();
            redo(); // Ctrl+Y
            break;

          // Selection
          case 'a':
            e.preventDefault();
            updateSelection([...strokesRef.current]);
            setTool('select');
            redraw();
            bump();
            break;

          // Zoom controls
          case '=':
          case '+':
            e.preventDefault();
            zoomIn();
            break;

          case '-':
            e.preventDefault();
            zoomOut();
            break;

          case '0':
            e.preventDefault();
            resetView();
            break;

          case '1':
            e.preventDefault();
            zoomToFit();
            break;

          // File operations (optional - can be added later)
          case 's':
            e.preventDefault();
            // Could trigger save functionality
            break;
        }
        return;
      }

      // Tool switching shortcuts (without modifiers)
      switch (e.key.toLowerCase()) {
        case 'v':
          e.preventDefault();
          setTool('select');
          break;

        case 'p':
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+P opens help menu
            setShowHelpModal(true);
          } else {
            // P sets pen tool
            setTool('pen');
          }
          break;

        case 'd':
          e.preventDefault();
          setTool('pen');
          break;

        case 'r':
          e.preventDefault();
          setTool('rect');
          break;

        case 'o':
          e.preventDefault();
          setTool('circle');
          break;

        case 'l':
          e.preventDefault();
          setTool('line');
          break;

        case 'e':
          e.preventDefault();
          setTool('eraser');
          break;

        // Number keys for quick tool access
        case '1':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setTool('select');
          }
          break;

        case '2':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setTool('pen');
          }
          break;

        case '3':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setTool('rect');
          }
          break;

        case '4':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setTool('circle');
          }
          break;

        case '5':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setTool('line');
          }
          break;

        // Help shortcuts
        case '?':
        case '/':
          if (e.shiftKey) { // Shift+? or Shift+/
            e.preventDefault();
            setShowHelpModal(true);
          }
          break;

        case 'F1':
          e.preventDefault();
          setShowHelpModal(true);
          break;

        // Theme toggle
        case 't':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleTheme();
          }
          break;
      }
    }

    function handleKeyUp(e) {
      if (e.key === ' ') {
        setIsSpacePressed(false);
      }
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Wheel event for zooming and trackpad panning
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleWheel(e) {
      e.preventDefault(); // Always prevent default to avoid page scroll

      if (e.ctrlKey || e.metaKey) {
        // Zoom functionality with Ctrl/Cmd + wheel
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldPos = {
          x: (mouseX - panX) / zoom,
          y: (mouseY - panY) / zoom
        };

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));

        const newPanX = mouseX - worldPos.x * newZoom;
        const newPanY = mouseY - worldPos.y * newZoom;

        setZoom(newZoom);
        setPanX(newPanX);
        setPanY(newPanY);
      } else {
        // Two-finger trackpad scrolling for panning
        const panSpeed = 1; // Adjust this value to control pan sensitivity

        // deltaX for horizontal scrolling, deltaY for vertical scrolling
        const deltaX = e.deltaX * panSpeed;
        const deltaY = e.deltaY * panSpeed;

        setPanX(prevPanX => prevPanX - deltaX);
        setPanY(prevPanY => prevPanY - deltaY);
      }
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [zoom, panX, panY]);

  /* ---------- Pan and Zoom ---------- */
  function zoomIn() {
    setZoom(prevZoom => Math.min(prevZoom * 1.2, 5));
  }

  function zoomOut() {
    setZoom(prevZoom => Math.max(prevZoom / 1.2, 0.1));
  }

  function resetView() {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }

  function zoomToFit() {
    if (strokesRef.current.length === 0) {
      resetView();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    strokesRef.current.forEach(stroke => {
      if (stroke.type === 'pen') {
        stroke.points.forEach(pt => {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        });
      } else if (stroke.start && stroke.end) {
        minX = Math.min(minX, stroke.start.x, stroke.end.x);
        minY = Math.min(minY, stroke.start.y, stroke.end.y);
        maxX = Math.max(maxX, stroke.start.x, stroke.end.x);
        maxY = Math.max(maxY, stroke.start.y, stroke.end.y);
      }
    });

    const canvas = canvasRef.current;
    const padding = 50;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const canvasWidth = canvas.offsetWidth - padding * 2;
    const canvasHeight = canvas.offsetHeight - padding * 2;

    const scaleX = canvasWidth / contentWidth;
    const scaleY = canvasHeight / contentHeight;
    const newZoom = Math.min(scaleX, scaleY, 2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPanX = canvas.offsetWidth / 2 - centerX * newZoom;
    const newPanY = canvas.offsetHeight / 2 - centerY * newZoom;

    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }

  /* ---------- File Operations ---------- */
  function saveAsJSON() {
    const data = {
      version: '1.0',
      strokes: strokesRef.current,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadJSON() {
    fileInputRef.current?.click();
  }

  function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const strokes = data.strokes || data; // Support both formats
        strokesRef.current = Array.isArray(strokes) ? strokes : [];
        redoStackRef.current = [];
        redraw();
        bump();
      } catch (error) {
        alert('Error loading file: Invalid JSON format');
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  }

  function exportAsSVG() {
    const canvas = canvasRef.current;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', canvas.style.width);
    svg.setAttribute('height', canvas.style.height);
    svg.setAttribute('viewBox', `0 0 ${canvas.offsetWidth} ${canvas.offsetHeight}`);

    strokesRef.current.forEach(stroke => {
      if (stroke.type === 'pen') {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = stroke.points.reduce((acc, pt, i) =>
          acc + (i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`), '');
        path.setAttribute('d', d);
        path.setAttribute('stroke', stroke.color);
        path.setAttribute('stroke-width', stroke.width);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      } else if (stroke.type === 'rect') {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const x = Math.min(stroke.start.x, stroke.end.x);
        const y = Math.min(stroke.start.y, stroke.end.y);
        const w = Math.abs(stroke.end.x - stroke.start.x);
        const h = Math.abs(stroke.end.y - stroke.start.y);
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('stroke', stroke.color);
        rect.setAttribute('stroke-width', stroke.width);
        rect.setAttribute('fill', stroke.fillColor || 'none');
        svg.appendChild(rect);
      } else if (stroke.type === 'circle') {
        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        const cx = (stroke.start.x + stroke.end.x) / 2;
        const cy = (stroke.start.y + stroke.end.y) / 2;
        const rx = Math.abs(stroke.end.x - stroke.start.x) / 2;
        const ry = Math.abs(stroke.end.y - stroke.start.y) / 2;
        ellipse.setAttribute('cx', cx);
        ellipse.setAttribute('cy', cy);
        ellipse.setAttribute('rx', rx);
        ellipse.setAttribute('ry', ry);
        ellipse.setAttribute('stroke', stroke.color);
        ellipse.setAttribute('stroke-width', stroke.width);
        ellipse.setAttribute('fill', stroke.fillColor || 'none');
        svg.appendChild(ellipse);
      } else if (stroke.type === 'line') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', stroke.start.x);
        line.setAttribute('y1', stroke.start.y);
        line.setAttribute('x2', stroke.end.x);
        line.setAttribute('y2', stroke.end.y);
        line.setAttribute('stroke', stroke.color);
        line.setAttribute('stroke-width', stroke.width);
        svg.appendChild(line);
      }
    });

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAsPNG() {
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drawing-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  /* ---------- Undo/Redo/Clear ---------- */
  function undo() {
    if (!strokesRef.current.length) return;
    redoStackRef.current.push(strokesRef.current.pop());
    redraw();
    bump();
  }
  function redo() {
    const s = redoStackRef.current.pop();
    if (!s) return;
    strokesRef.current.push(s);
    redraw();
    bump();
  }
  function deleteSelected() {
    if (selectedElementsRef.current.length === 0) return;

    // Remove selected elements from strokes
    strokesRef.current = strokesRef.current.filter(
      stroke => !selectedElementsRef.current.includes(stroke)
    );

    updateSelection([]);
    redoStackRef.current = []; // Clear redo stack after deletion
    redraw();
    bump();
  }

  function updateSelection(newSelection) {
    selectedElementsRef.current = newSelection;
    setSelectedCount(newSelection.length);
  }

  function clear() {
    strokesRef.current = [];
    redoStackRef.current = [];
    updateSelection([]);
    redraw();
    bump();
  }

  function toggleTheme() {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }

  /* ---------- JSX UI ---------- */
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={toolbarRef}
        className="toolbar"
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}
      >
        {/* File Operations */}
        <div className="toolbar-section" style={{ display: 'flex', gap: 6, paddingRight: 16 }}>
          <button onClick={saveAsJSON} title="Save as JSON">💾 Save</button>
          <button onClick={loadJSON} title="Load JSON">📁 Load</button>
          <button onClick={exportAsSVG} title="Export as SVG">🖼️ SVG</button>
          <button onClick={exportAsPNG} title="Export as PNG">📷 PNG</button>
          <button onClick={() => setShowHelpModal(true)} title="Help & Shortcuts">❓ Help</button>
        </div>

        {/* Tools */}
        <div className="toolbar-section" style={{ display: 'flex', gap: 6, paddingRight: 16 }}>
          <button onClick={() => setTool('select')} className={tool === 'select' ? 'tool-active' : ''}>� Select</button>
          <button onClick={() => setTool('pen')} className={tool === 'pen' ? 'tool-active' : ''}>✏️ Pen</button>
          <button onClick={() => setTool('rect')} className={tool === 'rect' ? 'tool-active' : ''}>⬛ Rect</button>
          <button onClick={() => setTool('circle')} className={tool === 'circle' ? 'tool-active' : ''}>⚪ Circle</button>
          <button onClick={() => setTool('line')} className={tool === 'line' ? 'tool-active' : ''}>📏 Line</button>
          <button onClick={() => setTool('eraser')} className={tool === 'eraser' ? 'tool-active' : ''}>🩹 Eraser</button>
        </div>

        {/* Colors and Properties */}
        <div className="toolbar-section" style={{ display: 'flex', gap: 12, alignItems: 'center', paddingRight: 16 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Stroke <input type="color" value={color} onChange={e => setColor(e.target.value)} />
          </label>

          {(tool === 'rect' || tool === 'circle') && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Fill
              <select value={fillColor} onChange={e => setFillColor(e.target.value)} style={{ marginLeft: 4 }}>
                <option value="transparent">None</option>
                <option value="#1e1e1e">Black</option>
                <option value="#6b7280">Gray</option>
                <option value="#e03131">Red</option>
                <option value="#e64980">Pink</option>
                <option value="#be4bdb">Grape</option>
                <option value="#7c3aed">Violet</option>
                <option value="#4c63d2">Indigo</option>
                <option value="#1971c2">Blue</option>
                <option value="#0891b2">Cyan</option>
                <option value="#0d9488">Teal</option>
                <option value="#2f9e44">Green</option>
                <option value="#66a80f">Lime</option>
                <option value="#fab005">Yellow</option>
                <option value="#fd7e14">Orange</option>
              </select>
              {fillColor !== 'transparent' && (
                <input
                  type="color"
                  value={fillColor === 'transparent' ? '#ffffff' : fillColor}
                  onChange={e => setFillColor(e.target.value)}
                  style={{ width: 30, height: 25, marginLeft: 4 }}
                />
              )}
            </label>
          )}

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Width <input type="range" min={1} max={50} value={width} onChange={e => setWidth(+e.target.value)} />
            <span style={{ minWidth: 20, fontSize: '12px' }}>{width}</span>
          </label>
        </div>

        {/* Actions */}
        <div className="toolbar-section" style={{ display: 'flex', gap: 6, paddingRight: 16 }}>
          <button onClick={undo}>↶ Undo</button>
          <button onClick={redo}>↷ Redo</button>
          <button onClick={deleteSelected} disabled={selectedCount === 0}>
            🗑️ Delete
          </button>
          <button onClick={clear}>🧹 Clear All</button>
        </div>

        {/* Zoom Controls */}
        <div className="toolbar-section" style={{ display: 'flex', gap: 6, alignItems: 'center', paddingRight: 16 }}>
          <button onClick={zoomOut} title="Zoom Out">🔍-</button>
          <span style={{ fontSize: '12px', minWidth: 45, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={zoomIn} title="Zoom In">🔍+</button>
          <button onClick={resetView} title="Reset View">🎯</button>
          <button onClick={zoomToFit} title="Zoom to Fit">📐</button>
        </div>

        {/* View Options */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={e => setShowGrid(e.target.checked)}
            />
            Grid
          </label>
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        <div className="status-text" style={{ marginLeft: 'auto' }}>
          <div style={{ fontSize: '14px', fontWeight: '500' }}>
            Tool: <strong>{tool}</strong>
            {selectedCount > 0 && (
              <span style={{ marginLeft: 8 }}>
                Selected: {selectedCount}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', marginTop: 2 }}>
            {isSpacePressed ? 'Space: Pan mode active' :
              isShiftPressed ? 'Shift: Constrain aspect ratio' :
                'V: Select • P: Pen • R: Rect • O: Circle • L: Line • E: Eraser • Esc: Select tool • Shift: Constrain • Space: Pan'}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileLoad}
        style={{ display: 'none' }}
      />

      <canvas
        ref={canvasRef}
        className="canvas-container"
        style={{
          flex: 1,
          touchAction: 'none',
          display: 'block',
          cursor: isSpacePressed ? 'grab' : (tool === 'select' ? 'default' : 'crosshair')
        }}
      />

      {/* Help Modal */}
      {showHelpModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="modal-content"
            style={{
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '700px',
              maxHeight: '85vh',
              overflow: 'auto',
              margin: '20px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '600' }}>Keyboard Shortcuts & Help</h2>
              <button
                onClick={() => setShowHelpModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '14px' }}>
              {/* Selection & Deletion */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Selection & Deletion</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>Delete</kbd> / <kbd>Backspace</kbd> → Delete selected</div>
                  <div><kbd>Ctrl/Cmd + A</kbd> → Select all</div>
                  <div><kbd>Escape</kbd> → Clear selection & select tool</div>
                  <div><kbd>Shift + click</kbd> → Multi-select</div>
                  <div><kbd>Ctrl/Cmd + click</kbd> → Add/remove from selection</div>
                </div>
              </div>

              {/* Undo/Redo */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Undo & Redo</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>Ctrl/Cmd + Z</kbd> → Undo</div>
                  <div><kbd>Ctrl/Cmd + Shift + Z</kbd> → Redo</div>
                  <div><kbd>Ctrl/Cmd + Y</kbd> → Redo (alternative)</div>
                </div>
              </div>

              {/* Tool Switching */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Tool Switching</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>V</kbd> or <kbd>1</kbd> → Selection tool</div>
                  <div><kbd>P</kbd> / <kbd>D</kbd> or <kbd>2</kbd> → Pen tool</div>
                  <div><kbd>R</kbd> or <kbd>3</kbd> → Rectangle tool</div>
                  <div><kbd>O</kbd> or <kbd>4</kbd> → Circle tool</div>
                  <div><kbd>L</kbd> or <kbd>5</kbd> → Line tool</div>
                  <div><kbd>E</kbd> → Eraser tool</div>
                </div>
              </div>

              {/* Zoom & Pan */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Zoom & Pan</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>Ctrl/Cmd + +</kbd> → Zoom in</div>
                  <div><kbd>Ctrl/Cmd + -</kbd> → Zoom out</div>
                  <div><kbd>Ctrl/Cmd + 0</kbd> → Reset view</div>
                  <div><kbd>Ctrl/Cmd + 1</kbd> → Zoom to fit</div>
                  <div><kbd>Space + drag</kbd> → Pan canvas</div>
                  <div><kbd>Middle mouse drag</kbd> → Pan canvas</div>
                  <div><kbd>Two-finger scroll</kbd> → Pan canvas</div>
                  <div><kbd>Ctrl/Cmd + wheel</kbd> → Zoom at cursor</div>
                </div>
              </div>

              {/* Shape Constraints */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Shape Constraints</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>Shift + drag</kbd> → Constrain aspect ratio</div>
                  <div style={{ marginLeft: '16px', fontSize: '12px', color: '#666' }}>
                    • Rectangles → Squares<br />
                    • Circles → Perfect circles<br />
                    • Lines → 45° angles
                  </div>
                </div>
              </div>

              {/* Help */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#333' }}>Help & Misc</h3>
                <div style={{ lineHeight: '1.6' }}>
                  <div><kbd>?</kbd>, <kbd>F1</kbd>, or <kbd>Shift + P</kbd> → Show this help</div>
                  <div><kbd>T</kbd> → Toggle light/dark theme</div>
                  <div><kbd>Ctrl/Cmd + S</kbd> → Save (future)</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600' }}>Tips:</h4>
              <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '13px', lineHeight: '1.5' }}>
                <li>Use the grid for precise alignment</li>
                <li>Hold Shift while drawing shapes to maintain aspect ratio</li>
                <li>Use Ctrl/Cmd+A to select all, then move everything at once</li>
                <li>Two-finger scroll on trackpads provides smooth panning</li>
                <li>Press Escape to quickly switch back to selection tool</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
