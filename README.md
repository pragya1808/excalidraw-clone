# 🎨 Excalidraw Clone

A feature-rich, lightweight whiteboard application inspired by Excalidraw, built with React and HTML5 Canvas API. Draw, design, and collaborate with an intuitive interface and powerful tools.

![Excalidraw Clone](https://img.shields.io/badge/React-19.1.1-blue) ![Vite](https://img.shields.io/badge/Vite-7.1.7-purple) ![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### 🖊️ Drawing Tools
- **Pen Tool** - Freehand drawing with smooth curves
- **Selection Tool** - Select, move, and manipulate elements
- **Lasso Selection** - Draw a freeform selection area
- **Eraser** - Remove unwanted elements
- **Hand Tool** - Pan around the canvas

### 📐 Shape Tools
- **Rectangle** - Draw rectangles and squares (hold Shift for perfect squares)
- **Circle/Ellipse** - Draw circles and ellipses (hold Shift for perfect circles)
- **Diamond** - Create diamond shapes
- **Line** - Draw straight lines (hold Shift for 45° angles)
- **Arrow** - Draw arrows with automatic arrowheads

### 📝 Content Tools
- **Text Tool** - Add text annotations
- **Sticky Notes** - Create colorful sticky notes with text
- **Image Upload** - Insert images into your canvas

### 🎨 Styling Options
- **Color Picker** - Choose stroke colors
- **Fill Color** - Set fill colors for shapes
- **Stroke Width** - Adjust line thickness (Thin, Normal, Bold, Extra Bold)
- **Transparency** - Support for transparent fills

### 🔧 Advanced Features
- **Undo/Redo** - Full history management
- **Auto-save** - Automatic saving to localStorage every 2 seconds
- **Multi-select** - Select multiple elements with Ctrl/Cmd or Shift
- **Zoom & Pan** - Zoom in/out and pan with mouse/trackpad
- **Grid Display** - Toggle Excalidraw-style dotted grid
- **Canvas Lock** - Lock canvas to prevent accidental edits
- **Keyboard Shortcuts** - Comprehensive keyboard support

### 💾 File Operations
- **Save as JSON** - Export your drawing as JSON
- **Load JSON** - Import previously saved drawings
- **Export as PNG** - Save as raster image
- **Export as SVG** - Save as vector graphics

### 🤖 AI Features (UI Ready)
- **Text to Diagram** - Convert text descriptions to diagrams
- **Mermaid to Excalidraw** - Import Mermaid diagrams
- **Wireframe to Code** - Generate code from wireframes

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/excalidraw-clone.git
cd excalidraw-clone

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
# Create optimized production build
npm run build

# Preview production build
npm run preview
```

## ⌨️ Keyboard Shortcuts

### Tools
| Shortcut | Action |
|----------|--------|
| `V` or `1` | Selection tool |
| `P` or `2` | Pen tool |
| `R` or `3` | Rectangle tool |
| `O` or `4` | Circle tool |
| `L` or `5` | Line tool |
| `A` | Arrow tool |
| `D` | Diamond tool |
| `T` or `8` | Text tool |
| `N` | Sticky note tool |
| `I` or `9` | Image tool |
| `H` | Hand tool (pan) |
| `E` | Eraser tool |

### Editing
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + C` | Copy selected |
| `Ctrl/Cmd + X` | Cut selected |
| `Ctrl/Cmd + V` | Paste |
| `Ctrl/Cmd + D` | Duplicate selected |
| `Delete` or `Backspace` | Delete selected |
| `Escape` | Clear selection / Close modals |

### View
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + +` or `Ctrl/Cmd + =` | Zoom in |
| `Ctrl/Cmd + -` | Zoom out |
| `Ctrl/Cmd + 0` | Reset zoom |
| `Ctrl/Cmd + 1` | Zoom to fit |
| `Space + Drag` | Pan canvas |
| `Mouse Wheel` | Pan (without Ctrl) |
| `Ctrl/Cmd + Mouse Wheel` | Zoom |

### File Operations
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save as JSON |

### Help
| Shortcut | Action |
|----------|--------|
| `?` or `Shift + /` or `F1` | Show keyboard shortcuts |

### Drawing Modifiers
| Modifier | Action |
|----------|--------|
| `Shift` | Constrain proportions (squares, circles, 45° lines) |
| `Ctrl/Cmd + Click` | Add/remove from selection |
| `Shift + Click` | Add to selection |

## 🎯 Usage Tips

### Drawing
1. Select a tool from the toolbar
2. Click and drag on the canvas to draw
3. Hold `Shift` while drawing shapes to constrain proportions
4. Use the color picker and stroke width controls to customize appearance

### Selection & Manipulation
1. Use the Selection tool (`V`) to select elements
2. Click and drag to move selected elements
3. Hold `Ctrl/Cmd` or `Shift` to multi-select
4. Use `Ctrl/Cmd + A` to select all elements

### Lasso Selection
1. Click the "More Options" button (three dots)
2. Select "Lasso Selection"
3. Draw a freeform path around elements to select them
4. Automatically switches to Selection tool after completing

### Zoom & Pan
- **Zoom**: Hold `Ctrl/Cmd` and scroll with mouse wheel
- **Pan**: Use trackpad scrolling, or hold `Space` and drag
- **Reset View**: Press `Ctrl/Cmd + 0`
- **Zoom to Fit**: Press `Ctrl/Cmd + 1`

### Text & Sticky Notes
- **Text Tool**: Click to place text, enter content in the prompt
- **Sticky Notes**: Click to create, enter text in the prompt
- Default sticky note color is yellow, but you can change the fill color

## 🏗️ Project Structure

```
excalidraw-clone/
├── src/
│   ├── App.jsx              # Main application component
│   ├── App.css              # Application styles
│   ├── hooks/
│   │   └── useShortcuts.js  # Keyboard shortcuts hook
│   ├── main.jsx             # Application entry point
│   └── index.css            # Global styles
├── public/                  # Static assets
├── .kiro/                   # Kiro AI specs and settings
│   └── specs/
│       └── keyboard-shortcuts/
├── package.json
├── vite.config.js
└── README.md
```

## 🛠️ Tech Stack

- **React 19.1.1** - UI framework
- **Vite 7.1.7** - Build tool and dev server
- **HTML5 Canvas API** - Drawing and rendering
- **LocalStorage API** - Auto-save functionality
- **CSS3** - Styling and animations

## 🎨 Design Philosophy

This project follows Excalidraw's design principles:
- **Minimalist UI** - Clean, distraction-free interface
- **Intuitive Tools** - Easy-to-use drawing tools
- **Performance** - Optimized canvas rendering with RAF
- **Accessibility** - Keyboard shortcuts for all actions
- **Hand-drawn Style** - Smooth, natural-looking strokes

## 🔄 Performance Optimizations

- **RequestAnimationFrame** - Smooth drawing with RAF throttling
- **Incremental Rendering** - Only redraw changed elements during drawing
- **Point Filtering** - Reduce data by filtering close points
- **Canvas Optimization** - Proper DPR handling and context settings
- **Debounced Redraw** - Prevent excessive redraws

## 📦 Dependencies

### Production
- `react` - ^19.1.1
- `react-dom` - ^19.1.1

### Development
- `@vitejs/plugin-react` - ^5.0.4
- `vite` - ^7.1.7
- `eslint` - ^9.36.0
- ESLint plugins for React

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Inspired by [Excalidraw](https://excalidraw.com/)
- Built with React and Vite
- Icons and design patterns from Excalidraw

## 🐛 Known Issues

- AI features are UI-only (backend integration needed)
- Image tool requires implementation
- Frame and Web Embed tools are placeholders

## 🗺️ Roadmap

- [ ] Implement AI feature backends
- [ ] Add collaborative editing
- [ ] Implement image tool functionality
- [ ] Add more shape tools (triangle, hexagon, etc.)
- [ ] Implement layers system
- [ ] Add color themes (dark mode)
- [ ] Export to more formats (PDF, etc.)
- [ ] Add shape libraries
- [ ] Implement text formatting options
- [ ] Add arrow customization (different head styles)

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

Made with ❤️ using React and Canvas API
