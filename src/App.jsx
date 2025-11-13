import { useEffect, useRef, useState } from 'react';
import './App.css';
import { useShortcuts, createShortcut, formatShortcut } from './hooks/useShortcuts';

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
  const lastDrawTimeRef = useRef(0);
  const drawingContextRef = useRef(null);
  const redrawTimeoutRef = useRef(null);
  const selectedElementsRef = useRef([]);
  const dragStartRef = useRef(null);
  const dragOffsetRef = useRef([]);
  const isPanningRef = useRef(false);
  const panStartRef = useRef(null);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const lassoPathRef = useRef([]);

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
  const [lassoPath, setLassoPath] = useState([]);
  const eraseSize = 15; // fixed eraser size
  const [version, setVersion] = useState(0);
  function bump() { setVersion(v => v + 1); }

  // Helper function to update selection
  function updateSelection(elements) {
    selectedElementsRef.current = elements;
    setSelectedCount(elements.length);
  }

  // Resize + DPR handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get context with performance optimizations
    const ctx = canvas.getContext('2d', {
      alpha: true, // Enable transparency for gradient background
      desynchronized: true, // Better performance
      willReadFrequently: false // We don't read pixels frequently
    });

    drawingContextRef.current = ctx;

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

      // Use RAF for resize redraw to avoid blocking
      requestAnimationFrame(() => redraw());
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

    // Excalidraw-style dotted grid - light theme only
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';

    // Calculate visible area in world coordinates
    const startX = Math.floor(-panX / zoom / gridSize) * gridSize;
    const endX = Math.ceil((canvas.width - panX) / zoom / gridSize) * gridSize;
    const startY = Math.floor(-panY / zoom / gridSize) * gridSize;
    const endY = Math.ceil((canvas.height - panY) / zoom / gridSize) * gridSize;

    // Draw dots at grid intersections (Excalidraw style)
    const dotSize = 1 / zoom;
    for (let x = startX; x <= endX; x += gridSize) {
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPenStroke(ctx, stroke) {
    if (!stroke.points?.length) return;

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;

    const pts = stroke.points;
    if (pts.length < 2) {
      // Single point
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (pts.length === 2) {
      // Simple line for two points
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      return;
    }

    // Smooth curve for multiple points using quadratic curves
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const currentPoint = pts[i];
      const nextPoint = pts[i + 1];
      const controlX = (currentPoint.x + nextPoint.x) / 2;
      const controlY = (currentPoint.y + nextPoint.y) / 2;
      ctx.quadraticCurveTo(currentPoint.x, currentPoint.y, controlX, controlY);
    }

    // Draw to the last point
    const lastPoint = pts[pts.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
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

  function drawArrow(ctx, s) {
    const dx = s.end.x - s.start.x;
    const dy = s.end.y - s.start.y;
    const angle = Math.atan2(dy, dx);
    const length = Math.sqrt(dx * dx + dy * dy);

    // Draw the main line
    ctx.beginPath();
    ctx.moveTo(s.start.x, s.start.y);
    ctx.lineTo(s.end.x, s.end.y);
    ctx.stroke();

    // Draw arrowhead
    const headLength = Math.min(20, length * 0.3);
    const headAngle = Math.PI / 6; // 30 degrees

    ctx.beginPath();
    ctx.moveTo(s.end.x, s.end.y);
    ctx.lineTo(
      s.end.x - headLength * Math.cos(angle - headAngle),
      s.end.y - headLength * Math.sin(angle - headAngle)
    );
    ctx.moveTo(s.end.x, s.end.y);
    ctx.lineTo(
      s.end.x - headLength * Math.cos(angle + headAngle),
      s.end.y - headLength * Math.sin(angle + headAngle)
    );
    ctx.stroke();
  }

  function drawDiamond(ctx, s) {
    const cx = (s.start.x + s.end.x) / 2;
    const cy = (s.start.y + s.end.y) / 2;
    const w = Math.abs(s.end.x - s.start.x) / 2;
    const h = Math.abs(s.end.y - s.start.y) / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy - h); // top
    ctx.lineTo(cx + w, cy); // right
    ctx.lineTo(cx, cy + h); // bottom
    ctx.lineTo(cx - w, cy); // left
    ctx.closePath();

    if (s.fillColor && s.fillColor !== 'transparent') {
      ctx.fillStyle = s.fillColor;
      ctx.fill();
    }
    ctx.stroke();
  }

  function drawText(ctx, s) {
    if (!s.text) return;

    ctx.font = `${s.fontSize || 16}px Arial`;
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Split text into lines and draw each line
    const lines = s.text.split('\n');
    const lineHeight = (s.fontSize || 16) * 1.2;

    lines.forEach((line, index) => {
      ctx.fillText(line, s.start.x, s.start.y + (index * lineHeight));
    });
  }

  function drawStickyNote(ctx, s) {
    const x = Math.min(s.start.x, s.end.x);
    const y = Math.min(s.start.y, s.end.y);
    const w = Math.abs(s.end.x - s.start.x);
    const h = Math.abs(s.end.y - s.start.y);

    // Draw sticky note background
    ctx.fillStyle = s.fillColor || '#fef3c7'; // Default yellow
    ctx.fillRect(x, y, w, h);

    // Draw border
    ctx.strokeStyle = s.color;
    ctx.strokeRect(x, y, w, h);

    // Draw text if present
    if (s.text) {
      ctx.fillStyle = '#374151'; // Dark gray text
      ctx.font = `${s.fontSize || 14}px Arial`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const lines = s.text.split('\n');
      const lineHeight = (s.fontSize || 14) * 1.2;
      const padding = 8;

      lines.forEach((line, index) => {
        if (y + padding + (index * lineHeight) < y + h - padding) {
          ctx.fillText(line, x + padding, y + padding + (index * lineHeight));
        }
      });
    }
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
    ctx.strokeStyle = '#6965db'; // Official Excalidraw primary color
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX - padding, minY - padding, maxX - minX + padding * 2, maxY - minY + padding * 2);
    ctx.setLineDash([]);
  }

  function drawLassoPath(ctx, path) {
    if (!path || path.length < 2) return;

    ctx.strokeStyle = '#6965db';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);

    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }

    // Close the path if we have enough points
    if (path.length > 2) {
      ctx.lineTo(path[0].x, path[0].y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  function isPointInLasso(point, lassoPath) {
    if (!lassoPath || lassoPath.length < 3) return false;

    // Ray casting algorithm to determine if point is inside polygon
    let inside = false;
    for (let i = 0, j = lassoPath.length - 1; i < lassoPath.length; j = i++) {
      if (((lassoPath[i].y > point.y) !== (lassoPath[j].y > point.y)) &&
        (point.x < (lassoPath[j].x - lassoPath[i].x) * (point.y - lassoPath[i].y) / (lassoPath[j].y - lassoPath[i].y) + lassoPath[i].x)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function selectElementsInLasso(lassoPath) {
    const selectedElements = [];

    strokesRef.current.forEach(element => {
      let isSelected = false;

      if (element.type === 'pen') {
        // Check if any point of the pen stroke is inside the lasso
        isSelected = element.points.some(point => isPointInLasso(point, lassoPath));
      } else if (element.start && element.end) {
        // Check if the center or corners of the shape are inside the lasso
        const centerX = (element.start.x + element.end.x) / 2;
        const centerY = (element.start.y + element.end.y) / 2;

        isSelected = isPointInLasso({ x: centerX, y: centerY }, lassoPath) ||
          isPointInLasso(element.start, lassoPath) ||
          isPointInLasso(element.end, lassoPath);
      }

      if (isSelected) {
        selectedElements.push(element);
      }
    });

    return selectedElements;
  }

  function drawLastSegment(ctx, stroke) {
    const pts = stroke.points;
    if (pts.length < 2) return;

    // Save context state
    ctx.save();

    // Apply transformations
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width / zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Restore context state
    ctx.restore();
  }

  function drawIncrementalPenStroke(ctx, stroke, fromIndex = 0) {
    if (!stroke.points?.length || fromIndex >= stroke.points.length) return;

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width / zoom;
    ctx.beginPath();

    if (fromIndex === 0) {
      const pts = stroke.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    } else {
      // Draw only new segments
      const pts = stroke.points;
      ctx.moveTo(pts[fromIndex - 1].x, pts[fromIndex - 1].y);
      for (let i = fromIndex; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  function redraw(skipCurrentStroke = false) {
    const canvas = canvasRef.current;
    const ctx = drawingContextRef.current || canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Canvas is transparent to show the gradient background

    // Save context and apply transformations
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw grid
    drawGrid(ctx, canvas);

    // Draw all strokes (skip current stroke if specified for performance)
    const strokes = skipCurrentStroke && currentStrokeRef.current
      ? strokesRef.current.filter(s => s !== currentStrokeRef.current)
      : strokesRef.current;

    for (const s of strokes) {
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = s.color || '#000';
      ctx.lineWidth = (s.width || 1) / zoom; // Adjust line width for zoom

      if (s.type === 'pen') drawPenStroke(ctx, s);
      else if (s.type === 'rect') drawRect(ctx, s);
      else if (s.type === 'circle') drawCircle(ctx, s);
      else if (s.type === 'line') drawLine(ctx, s);
      else if (s.type === 'arrow') drawArrow(ctx, s);
      else if (s.type === 'diamond') drawDiamond(ctx, s);
      else if (s.type === 'text') drawText(ctx, s);
      else if (s.type === 'sticky') drawStickyNote(ctx, s);
    }

    // Draw selection box
    if (tool === 'select') {
      drawSelectionBox(ctx, selectedElementsRef.current);
    }

    // Draw lasso path while drawing
    if (tool === 'lasso' && lassoPath.length > 0) {
      drawLassoPath(ctx, lassoPath);
    }

    // Restore context
    ctx.restore();
  }

  function debouncedRedraw(delay = 16) {
    if (redrawTimeoutRef.current) {
      clearTimeout(redrawTimeoutRef.current);
    }
    redrawTimeoutRef.current = setTimeout(() => {
      redraw();
      redrawTimeoutRef.current = null;
    }, delay);
  }

  function drawPreview(ctx, preview) {
    if (!preview) return;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = preview.color;
    ctx.lineWidth = preview.width;
    if (preview.type === 'rect') drawRect(ctx, preview);
    else if (preview.type === 'circle') drawCircle(ctx, preview);
    else if (preview.type === 'line') drawLine(ctx, preview);
    else if (preview.type === 'arrow') drawArrow(ctx, preview);
    else if (preview.type === 'diamond') drawDiamond(ctx, preview);
    else if (preview.type === 'sticky') drawStickyNote(ctx, preview);
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

      if (tool === 'lasso') {
        // Start lasso selection
        drawingRef.current = true;
        lassoPathRef.current = [p];
        setLassoPath([p]);
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
      } else if (tool === 'text') {
        // For text tool, immediately create a text element and prompt for input
        const textElement = {
          type: 'text',
          color,
          width,
          start: p,
          end: p,
          text: '',
          fontSize: 16,
          isEditing: true
        };
        currentStrokeRef.current = textElement;
        strokesRef.current.push(textElement);

        // Prompt for text input
        const text = prompt('Enter text:');
        if (text !== null) {
          textElement.text = text;
          textElement.isEditing = false;
        } else {
          // Remove if cancelled
          strokesRef.current.pop();
        }
        currentStrokeRef.current = null;
        redraw();
        bump();
      } else if (tool === 'sticky') {
        // For sticky notes, create with default size and prompt for text
        const stickyElement = {
          type: 'sticky',
          color,
          width,
          fillColor: fillColor === 'transparent' ? '#fef3c7' : fillColor,
          start: p,
          end: { x: p.x + 120, y: p.y + 80 },
          text: '',
          fontSize: 14
        };

        const text = prompt('Enter note text:');
        if (text !== null) {
          stickyElement.text = text;
          strokesRef.current.push(stickyElement);
          redraw();
          bump();
        }
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

      if (tool === 'lasso' && drawingRef.current && e.pointerId === pointerIdRef.current) {
        // Add point to lasso path
        lassoPathRef.current.push(p);
        setLassoPath([...lassoPathRef.current]);

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
        // Filter points by distance to reduce data and improve performance
        const lastPoint = current.points[current.points.length - 1];
        const minDistance = 2; // Minimum distance between points

        if (!lastPoint ||
          Math.abs(p.x - lastPoint.x) >= minDistance ||
          Math.abs(p.y - lastPoint.y) >= minDistance) {

          current.points.push(p);

          // Throttle drawing for better performance
          const now = performance.now();
          const timeSinceLastDraw = now - lastDrawTimeRef.current;

          // Only draw if enough time has passed (8ms = ~120fps for smoother drawing)
          if (timeSinceLastDraw >= 8) {
            drawLastSegment(ctx, current);
            lastDrawTimeRef.current = now;
          } else {
            // Queue the draw for the next frame
            if (!rafPendingRef.current) {
              rafPendingRef.current = true;
              requestAnimationFrame(() => {
                rafPendingRef.current = false;
                drawLastSegment(ctx, current);
                lastDrawTimeRef.current = performance.now();
              });
            }
          }
        }
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

      if (tool === 'lasso') {
        // Complete lasso selection
        if (lassoPathRef.current.length > 2) {
          const selectedElements = selectElementsInLasso(lassoPathRef.current);
          updateSelection(selectedElements);
          setTool('select'); // Switch back to select tool
        }

        // Clear lasso path
        lassoPathRef.current = [];
        setLassoPath([]);
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
  }, [tool, color, width, fillColor, isSpacePressed, panX, panY, zoom]);

  // Redraw when grid setting changes or zoom/pan changes
  useEffect(() => {
    redraw();
  }, [showGrid, zoom, panX, panY]);

  // Keyboard shortcuts system
  const shortcuts = [
    // Tool switching shortcuts (only when no modifiers are pressed)
    { key: 'v', action: (e) => !e.ctrlKey && !e.metaKey && setTool('select'), description: 'Selection tool', category: 'tools' },
    { key: '1', action: () => setTool('select'), description: 'Selection tool', category: 'tools' },
    { key: 'p', action: () => setTool('pen'), description: 'Pen tool', category: 'tools' },
    { key: '2', action: () => setTool('pen'), description: 'Pen tool', category: 'tools' },
    { key: 'r', action: () => setTool('rect'), description: 'Rectangle tool', category: 'tools' },
    { key: '3', action: () => setTool('rect'), description: 'Rectangle tool', category: 'tools' },
    { key: 'o', action: () => setTool('circle'), description: 'Circle tool', category: 'tools' },
    { key: '4', action: () => setTool('circle'), description: 'Circle tool', category: 'tools' },
    { key: 'l', action: () => setTool('line'), description: 'Line tool', category: 'tools' },
    { key: '5', action: () => setTool('line'), description: 'Line tool', category: 'tools' },
    { key: 'a', action: (e) => !e.ctrlKey && !e.metaKey && setTool('arrow'), description: 'Arrow tool', category: 'tools' },
    { key: 'd', action: (e) => !e.ctrlKey && !e.metaKey && setTool('diamond'), description: 'Diamond tool', category: 'tools' },
    { key: '3', action: () => setTool('diamond'), description: 'Diamond tool', category: 'tools' },
    { key: 't', action: () => setTool('text'), description: 'Text tool', category: 'tools' },
    { key: '8', action: () => setTool('text'), description: 'Text tool', category: 'tools' },
    { key: 'i', action: () => setTool('image'), description: 'Image tool', category: 'tools' },
    { key: '9', action: () => setTool('image'), description: 'Image tool', category: 'tools' },
    { key: 'n', action: () => setTool('sticky'), description: 'Sticky note tool', category: 'tools' },
    { key: 'h', action: () => setTool('hand'), description: 'Hand tool', category: 'tools' },
    { key: 'e', action: () => setTool('eraser'), description: 'Eraser tool', category: 'tools' },

    // Selection and deletion
    { key: 'delete', action: () => selectedElementsRef.current.length > 0 && deleteSelected(), description: 'Delete selected', category: 'selection' },
    { key: 'backspace', action: () => selectedElementsRef.current.length > 0 && deleteSelected(), description: 'Delete selected', category: 'selection' },
    createShortcut({ key: 'a', ctrlKey: true, action: () => { updateSelection([...strokesRef.current]); setTool('select'); redraw(); bump(); }, description: 'Select all', category: 'selection' }),
    { key: 'escape', action: () => { if (showHelpModal) setShowHelpModal(false); else { updateSelection([]); setTool('select'); redraw(); bump(); } }, description: 'Clear selection & select tool', category: 'selection' },

    // Undo/Redo
    createShortcut({ key: 'z', ctrlKey: true, action: () => undo(), description: 'Undo', category: 'editor' }),
    createShortcut({ key: 'z', ctrlKey: true, shiftKey: true, action: () => redo(), description: 'Redo', category: 'editor' }),
    createShortcut({ key: 'y', ctrlKey: true, action: () => redo(), description: 'Redo', category: 'editor' }),

    // Zoom and view
    createShortcut({ key: '=', ctrlKey: true, action: () => zoomIn(), description: 'Zoom in', category: 'view' }),
    createShortcut({ key: '+', ctrlKey: true, action: () => zoomIn(), description: 'Zoom in', category: 'view' }),
    createShortcut({ key: '-', ctrlKey: true, action: () => zoomOut(), description: 'Zoom out', category: 'view' }),
    createShortcut({ key: '0', ctrlKey: true, action: () => resetView(), description: 'Reset view', category: 'view' }),
    createShortcut({ key: '1', ctrlKey: true, action: () => zoomToFit(), description: 'Zoom to fit', category: 'view' }),

    // Help
    { key: '?', action: () => setShowHelpModal(true), description: 'Show help', category: 'help' },
    { key: '/', shiftKey: true, action: () => setShowHelpModal(true), description: 'Show help', category: 'help' },
    { key: 'F1', action: () => setShowHelpModal(true), description: 'Show help', category: 'help' },

    // File operations
    createShortcut({ key: 's', ctrlKey: true, action: () => saveAsJSON(), description: 'Save', category: 'file' }),

    // Clipboard operations (basic implementation)
    createShortcut({
      key: 'c', ctrlKey: true, action: () => {
        if (selectedElementsRef.current.length > 0) {
          // Copy selected elements to clipboard (simplified)
          const selectedData = selectedElementsRef.current.map(element => ({ ...element }));
          localStorage.setItem('excalidraw-clipboard', JSON.stringify(selectedData));
        }
      }, description: 'Copy', category: 'editor'
    }),

    createShortcut({
      key: 'x', ctrlKey: true, action: () => {
        if (selectedElementsRef.current.length > 0) {
          // Cut selected elements (copy then delete)
          const selectedData = selectedElementsRef.current.map(element => ({ ...element }));
          localStorage.setItem('excalidraw-clipboard', JSON.stringify(selectedData));
          deleteSelected();
        }
      }, description: 'Cut', category: 'editor'
    }),

    createShortcut({
      key: 'v', ctrlKey: true, action: () => {
        try {
          const clipboardData = localStorage.getItem('excalidraw-clipboard');
          if (clipboardData) {
            const elements = JSON.parse(clipboardData);
            // Offset pasted elements slightly
            const offsetElements = elements.map(element => {
              if (element.type === 'pen') {
                return {
                  ...element,
                  points: element.points.map(pt => ({ x: pt.x + 20, y: pt.y + 20 }))
                };
              } else if (element.start && element.end) {
                return {
                  ...element,
                  start: { x: element.start.x + 20, y: element.start.y + 20 },
                  end: { x: element.end.x + 20, y: element.end.y + 20 }
                };
              }
              return element;
            });
            strokesRef.current.push(...offsetElements);
            updateSelection(offsetElements);
            redraw();
            bump();
          }
        } catch (e) {
          console.warn('Failed to paste:', e);
        }
      }, description: 'Paste', category: 'editor'
    }),

    createShortcut({
      key: 'd', ctrlKey: true, action: () => {
        if (selectedElementsRef.current.length > 0) {
          // Duplicate selected elements
          const duplicatedElements = selectedElementsRef.current.map(element => {
            if (element.type === 'pen') {
              return {
                ...element,
                points: element.points.map(pt => ({ x: pt.x + 20, y: pt.y + 20 }))
              };
            } else if (element.start && element.end) {
              return {
                ...element,
                start: { x: element.start.x + 20, y: element.start.y + 20 },
                end: { x: element.end.x + 20, y: element.end.y + 20 }
              };
            }
            return { ...element };
          });
          strokesRef.current.push(...duplicatedElements);
          updateSelection(duplicatedElements);
          redraw();
          bump();
        }
      }, description: 'Duplicate', category: 'editor'
    }),
  ];

  useShortcuts(shortcuts);

  // Handle Space and Shift keys separately for pan mode and constraints
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
  }, [isSpacePressed, isShiftPressed]);

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

  function clear() {
    strokesRef.current = [];
    redoStackRef.current = [];
    updateSelection([]);
    redraw();
    bump();
  }



  // Add state for settings panel and new tools
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);
  const [showMoreDropdown, setShowMoreDropdown] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiModalType, setAIModalType] = useState('');
  const [textInput, setTextInput] = useState('');
  const imageInputRef = useRef(null);

  // New tool functions
  const handleImageUpload = () => {
    imageInputRef.current?.click();
  };

  const handleImageFile = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      // Create image element and add to canvas
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const imageElement = {
            type: 'image',
            x: 100,
            y: 100,
            width: img.width,
            height: img.height,
            src: e.target.result,
            color: color,
            width: width
          };
          strokesRef.current.push(imageElement);
          redraw();
          bump();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const openAIModal = (type) => {
    setAIModalType(type);
    setShowAIModal(true);
    setTextInput('');
  };

  const handleAIGenerate = () => {
    // Placeholder for AI functionality
    console.log(`AI Generate ${aiModalType}:`, textInput);
    setShowAIModal(false);
    // Here you would integrate with AI services
  };

  const toggleCanvasLock = () => {
    setIsCanvasLocked(!isCanvasLocked);
  };

  /* ---------- JSX UI ---------- */
  return (
    <div className="app-container">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileLoad}
        style={{ display: 'none' }}
      />

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className={`canvas-container ${isSpacePressed || isPanningRef.current ? 'panning' :
          tool === 'select' ? 'tool-select' :
            tool === 'eraser' ? 'tool-eraser' : ''
          }`}
        style={{ touchAction: 'none' }}
      />

      {/* Comprehensive Excalidraw Toolbar - Matches Reference Image */}
      <div className="floating-toolbar">
        {/* Lock/Unlock Canvas */}
        <button
          className={`tool-button ${isCanvasLocked ? 'active' : ''}`}
          onClick={toggleCanvasLock}
          title={`${isCanvasLocked ? 'Unlock' : 'Lock'} canvas`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isCanvasLocked ? (
              <path d="M6 10V8a6 6 0 1 1 12 0v2M6 10h12v10H6V10z" />
            ) : (
              <path d="M6 10V8a6 6 0 1 1 12 0v2M6 10h12v10H6V10zM15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            )}
          </svg>
        </button>

        {/* Hand Tool (Pan) */}
        <button
          className={`tool-button ${tool === 'hand' ? 'active' : ''}`}
          onClick={() => setTool('hand')}
          title="Hand tool (H)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
        </button>

        {/* Selection Tool */}
        <button
          className={`tool-button ${tool === 'select' ? 'active' : ''}`}
          onClick={() => setTool('select')}
          title="Selection tool (V)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2l7 20l2.9-7.1L19 17L2 2z" />
          </svg>
        </button>



        {/* Rectangle Tool */}
        <button
          className={`tool-button ${tool === 'rect' ? 'active' : ''}`}
          onClick={() => setTool('rect')}
          title="Rectangle tool (R)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          </svg>
        </button>

        {/* Ellipse Tool */}
        <button
          className={`tool-button ${tool === 'circle' ? 'active' : ''}`}
          onClick={() => setTool('circle')}
          title="Ellipse tool (O)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </button>

        {/* Diamond Tool */}
        <button
          className={`tool-button ${tool === 'diamond' ? 'active' : ''}`}
          onClick={() => setTool('diamond')}
          title="Diamond tool (D)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 3h12l4 6-10 13L2 9l4-6z" />
          </svg>
        </button>

        {/* Arrow Tool */}
        <button
          className={`tool-button ${tool === 'arrow' ? 'active' : ''}`}
          onClick={() => setTool('arrow')}
          title="Arrow tool (A)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="7" y1="17" x2="17" y2="7" />
            <polyline points="7,7 17,7 17,17" />
          </svg>
        </button>

        {/* Line Tool */}
        <button
          className={`tool-button ${tool === 'line' ? 'active' : ''}`}
          onClick={() => setTool('line')}
          title="Line tool (L)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="7" y1="17" x2="17" y2="7" />
          </svg>
        </button>

        {/* Pen Tool */}
        <button
          className={`tool-button ${tool === 'pen' ? 'active' : ''}`}
          onClick={() => setTool('pen')}
          title="Pen tool (P)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>

        {/* Text Tool */}
        <button
          className={`tool-button ${tool === 'text' ? 'active' : ''}`}
          onClick={() => setTool('text')}
          title="Text tool (T)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4,7 4,4 20,4 20,7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
        </button>

        {/* Image Tool */}
        <button
          className={`tool-button ${tool === 'image' ? 'active' : ''}`}
          onClick={() => { setTool('image'); handleImageUpload(); }}
          title="Image tool (I)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>

        {/* Sticky Note Tool */}
        <button
          className={`tool-button ${tool === 'sticky' ? 'active' : ''}`}
          onClick={() => setTool('sticky')}
          title="Sticky note"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5z" />
            <polyline points="16,3 16,8 21,8" />
          </svg>
        </button>

        {/* More Options Dropdown */}
        <div className="dropdown-wrapper">
          <button
            className="tool-button"
            onClick={() => setShowMoreDropdown(!showMoreDropdown)}
            title="More options"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>

          {showMoreDropdown && (
            <div className="dropdown-menu">
              <button
                className="dropdown-item"
                onClick={() => { setTool('frame'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="6" x2="2" y2="6" />
                  <line x1="22" y1="18" x2="2" y2="18" />
                  <line x1="6" y1="2" x2="6" y2="22" />
                  <line x1="18" y1="2" x2="18" y2="22" />
                </svg>
                Frame tool
                <span className="shortcut-hint">F</span>
              </button>

              <button
                className="dropdown-item"
                onClick={() => { setTool('embed'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16,18 22,12 16,6" />
                  <polyline points="8,6 2,12 8,18" />
                </svg>
                Web Embed
              </button>

              <button
                className="dropdown-item"
                onClick={() => { setTool('laser'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                </svg>
                Laser pointer
                <span className="shortcut-hint">K</span>
              </button>

              <button
                className="dropdown-item"
                onClick={() => { setTool('lasso'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                  <path d="M13 13l6 6" />
                </svg>
                Lasso selection
              </button>

              <div className="dropdown-separator" />

              <div className="dropdown-section-title">Generate</div>

              <button
                className="dropdown-item ai-item"
                onClick={() => { openAIModal('text-to-diagram'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10,9 9,9 8,9" />
                </svg>
                Text to diagram
                <span className="ai-badge">AI</span>
              </button>

              <button
                className="dropdown-item"
                onClick={() => { openAIModal('mermaid-to-excalidraw'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9,11 12,14 22,4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Mermaid to Excalidraw
              </button>

              <button
                className="dropdown-item ai-item"
                onClick={() => { openAIModal('wireframe-to-code'); setShowMoreDropdown(false); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16,18 22,12 16,6" />
                  <polyline points="8,6 2,12 8,18" />
                </svg>
                Wireframe to code
                <span className="ai-badge">AI</span>
              </button>
            </div>
          )}
        </div>

        {/* Eraser Tool */}
        <button
          className={`tool-button ${tool === 'eraser' ? 'active' : ''}`}
          onClick={() => setTool('eraser')}
          title="Eraser tool (E)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-6.36-6.36-3.54 3.36z" />
          </svg>
        </button>

        <div className="tool-separator" />

        {/* Color Picker */}
        <div className="color-picker-wrapper" title="Stroke color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="color-picker"
          />
        </div>

        {/* Stroke Width */}
        <div className="stroke-width-wrapper">
          <input
            type="range"
            min="1"
            max="50"
            value={width}
            onChange={(e) => setWidth(+e.target.value)}
            className="stroke-width-slider"
            title={`Stroke width: ${width}px`}
          />
        </div>

        <div className="tool-separator" />

        {/* Undo */}
        <button
          className="tool-button"
          onClick={undo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
          </svg>
        </button>

        {/* Redo */}
        <button
          className="tool-button"
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
          </svg>
        </button>
      </div>

      {/* Hidden Image Input */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFile}
        style={{ display: 'none' }}
      />

      {/* Hamburger Menu - Top Left */}
      <button
        className="hamburger-menu"
        onClick={() => setShowSettingsPanel(!showSettingsPanel)}
        title="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Settings Panel */}
      {showSettingsPanel && (
        <div className="settings-panel">
          <div className="settings-section">
            <h3>File</h3>
            <div className="settings-row">
              <button onClick={saveAsJSON} style={{ width: '100%', marginBottom: '8px' }}>
                💾 Save as JSON
              </button>
            </div>
            <div className="settings-row">
              <button onClick={loadJSON} style={{ width: '100%', marginBottom: '8px' }}>
                📁 Load JSON
              </button>
            </div>
            <div className="settings-row">
              <button onClick={exportAsSVG} style={{ width: '100%', marginBottom: '8px' }}>
                🖼️ Export as SVG
              </button>
            </div>
            <div className="settings-row">
              <button onClick={exportAsPNG} style={{ width: '100%' }}>
                📷 Export as PNG
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>Drawing</h3>
            {(tool === 'rect' || tool === 'circle') && (
              <div className="settings-row">
                <span className="settings-label">Fill</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    value={fillColor}
                    onChange={(e) => setFillColor(e.target.value)}
                    style={{ fontSize: '12px', padding: '4px' }}
                  >
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
                      value={fillColor}
                      onChange={(e) => setFillColor(e.target.value)}
                      style={{ width: '24px', height: '24px', border: 'none', borderRadius: '4px' }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3>View</h3>
            <div className="settings-row">
              <span className="settings-label">Grid</span>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
            </div>

          </div>

          <div className="settings-section">
            <h3>Actions</h3>
            <div className="settings-row">
              <button
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                style={{ width: '100%', marginBottom: '8px' }}
              >
                🗑️ Delete Selected ({selectedCount})
              </button>
            </div>
            <div className="settings-row">
              <button onClick={clear} style={{ width: '100%' }}>
                🧹 Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Controls - Bottom Left */}
      <div className="zoom-controls">
        <button className="zoom-button" onClick={zoomOut} title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <div className="zoom-display">{Math.round(zoom * 100)}%</div>

        <button className="zoom-button" onClick={zoomIn} title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button className="zoom-button" onClick={resetView} title="Reset view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6" />
            <path d="M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>

        <button className="zoom-button" onClick={zoomToFit} title="Zoom to fit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>

      {/* Help Label - Bottom Right */}
      <div className="help-label" onClick={() => setShowHelpModal(true)}>
        Shortcuts & help
      </div>

      {/* Selection Indicator */}
      {selectedCount > 0 && (
        <div className="selection-indicator">
          {selectedCount} selected
        </div>
      )}

      {/* Comprehensive Help Modal */}
      {showHelpModal && (
        <div className="modal-overlay" onClick={() => setShowHelpModal(false)}>
          <div className="modal-content help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Keyboard Shortcuts & Help</h2>
              <button className="modal-close" onClick={() => setShowHelpModal(false)}>
                ×
              </button>
            </div>

            <div className="help-content">
              {/* Selection & Deletion */}
              <div className="help-section">
                <h3 className="help-section-title">Selection & Deletion</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Delete selected</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">Delete</kbd>
                      <span className="shortcut-separator">/</span>
                      <kbd className="shortcut-key">Backspace</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Select all</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">A</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Clear selection and select tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">Escape</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Multi-select</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">Shift</kbd>
                      <span className="shortcut-text">+ Click</span>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Add/Remove from selection</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <span className="shortcut-text">+ Click</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tool Switching */}
              <div className="help-section">
                <h3 className="help-section-title">Tool Switching</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Selection tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">V</kbd>
                      <span className="shortcut-text">or</span>
                      <kbd className="shortcut-key">1</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Pen tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">P</kbd>
                      <span className="shortcut-text">or</span>
                      <kbd className="shortcut-key">2</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Rectangle tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">R</kbd>
                      <span className="shortcut-text">or</span>
                      <kbd className="shortcut-key">3</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Circle tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">O</kbd>
                      <span className="shortcut-text">or</span>
                      <kbd className="shortcut-key">4</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Line tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">L</kbd>
                      <span className="shortcut-text">or</span>
                      <kbd className="shortcut-key">5</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Eraser tool</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">E</kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Zoom & Pan */}
              <div className="help-section">
                <h3 className="help-section-title">Zoom & Pan</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Zoom in</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">=</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Zoom out</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">-</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Reset view</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">0</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Zoom to fit</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">1</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Pan canvas</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">Space</kbd>
                      <span className="shortcut-text">+ drag</span>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Pan canvas</span>
                    <div className="shortcut-keys">
                      <span className="shortcut-text">Middle mouse drag</span>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Zoom at cursor</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <span className="shortcut-text">+ wheel</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shape Constraints */}
              <div className="help-section">
                <h3 className="help-section-title">Shape Constraints</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Constrain aspect ratio</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">Shift</kbd>
                      <span className="shortcut-text">+ drag</span>
                    </div>
                  </div>
                  <div className="shortcut-constraint-details">
                    <div className="constraint-detail">• Rectangles → Squares</div>
                    <div className="constraint-detail">• Circles → Perfect circles</div>
                    <div className="constraint-detail">• Lines → 45° angles</div>
                  </div>
                </div>
              </div>

              {/* Editor Actions */}
              <div className="help-section">
                <h3 className="help-section-title">Editor Actions</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Undo</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">Z</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Redo</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">Shift</kbd>
                      <kbd className="shortcut-key">Z</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Copy</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">C</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Cut</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">X</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Paste</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">V</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Duplicate</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">D</kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Help & Misc */}
              <div className="help-section">
                <h3 className="help-section-title">Help & Misc</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <span className="shortcut-description">Show this help</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">?</kbd>
                      <span className="shortcut-separator">/</span>
                      <kbd className="shortcut-key">F1</kbd>
                      <span className="shortcut-separator">/</span>
                      <kbd className="shortcut-key">Shift</kbd>
                      <kbd className="shortcut-key">?</kbd>
                    </div>
                  </div>
                  <div className="shortcut-item">
                    <span className="shortcut-description">Save</span>
                    <div className="shortcut-keys">
                      <kbd className="shortcut-key">{navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}</kbd>
                      <kbd className="shortcut-key">S</kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tips Section */}
              <div className="help-section tips-section">
                <h3 className="help-section-title">Tips</h3>
                <div className="tips-list">
                  <div className="tip-item">• Use the grid for precise alignment</div>
                  <div className="tip-item">• Hold Shift while drawing shapes to maintain aspect ratio</div>
                  <div className="tip-item">• Use {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd' : 'Ctrl'}+A to select all, then move everything at once</div>
                  <div className="tip-item">• Two-finger scroll on trackpads provides smooth panning</div>
                  <div className="tip-item">• Press Escape to quickly switch back to selection tool</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Generation Modal */}
      {showAIModal && (
        <div className="modal-overlay" onClick={() => setShowAIModal(false)}>
          <div className="modal-content ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {aiModalType === 'text-to-diagram' && 'Text to Diagram (AI)'}
                {aiModalType === 'mermaid-to-excalidraw' && 'Mermaid to Excalidraw'}
                {aiModalType === 'wireframe-to-code' && 'Wireframe to Code (AI)'}
              </h2>
              <button className="modal-close" onClick={() => setShowAIModal(false)}>
                ×
              </button>
            </div>

            <div className="ai-modal-content">
              <div className="ai-input-section">
                <label className="ai-input-label">
                  {aiModalType === 'text-to-diagram' && 'Describe the diagram you want to create:'}
                  {aiModalType === 'mermaid-to-excalidraw' && 'Paste your Mermaid syntax:'}
                  {aiModalType === 'wireframe-to-code' && 'Describe the wireframe or UI you want to convert:'}
                </label>
                <textarea
                  className="ai-input-textarea"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={
                    aiModalType === 'text-to-diagram'
                      ? 'e.g., "Create a flowchart showing user login process with decision points"'
                      : aiModalType === 'mermaid-to-excalidraw'
                        ? 'graph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action]\n    B -->|No| D[End]'
                        : 'e.g., "Convert this wireframe into React components with Tailwind CSS"'
                  }
                  rows={6}
                />
              </div>

              <div className="ai-modal-actions">
                <button
                  className="ai-cancel-button"
                  onClick={() => setShowAIModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="ai-generate-button"
                  onClick={handleAIGenerate}
                  disabled={!textInput.trim()}
                >
                  Generate
                </button>
              </div>

              <div className="ai-modal-note">
                <p>
                  <strong>Note:</strong> AI features are currently in development.
                  This will integrate with AI services to generate diagrams and code.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
