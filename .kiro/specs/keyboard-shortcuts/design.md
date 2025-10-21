# Keyboard Shortcuts System - Design Document

## Overview

The keyboard shortcuts system will be implemented as a centralized command registry that maps keyboard combinations to application actions. The system will use React hooks for event handling, provide visual feedback through tooltips and state updates, and maintain cross-platform compatibility.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Tool Manager  │  │  Canvas Manager │  │  State Manager  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                 Keyboard Shortcuts Layer                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ useShortcuts    │  │ Command Registry│  │ Feedback System │ │
│  │ Hook            │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Event Handling Layer                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Key Detection   │  │ Platform Handler│  │ Context Filter  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

1. **useShortcuts Hook**: Central keyboard event handler
2. **Command Registry**: Maps shortcuts to actions
3. **Feedback System**: Provides visual feedback
4. **Platform Handler**: Manages cross-platform compatibility
5. **Context Filter**: Prevents shortcuts in input fields

## Components and Interfaces

### 1. useShortcuts Hook

```typescript
interface ShortcutConfig {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  action: () => void;
  description: string;
  category: 'tools' | 'editor' | 'view';
  preventDefault?: boolean;
}

interface UseShortcutsReturn {
  registerShortcut: (config: ShortcutConfig) => void;
  unregisterShortcut: (key: string) => void;
  getShortcuts: () => ShortcutConfig[];
  isActive: (key: string) => boolean;
}

const useShortcuts = (): UseShortcutsReturn;
```

### 2. Command Registry

```typescript
interface Command {
  id: string;
  name: string;
  shortcut: string;
  execute: () => void;
  canExecute?: () => boolean;
  category: string;
}

class CommandRegistry {
  private commands: Map<string, Command>;

  register(command: Command): void;
  unregister(id: string): void;
  execute(id: string): boolean;
  getByShortcut(shortcut: string): Command | undefined;
  getByCategory(category: string): Command[];
}
```

### 3. Keyboard Event Handler

```typescript
interface KeyboardEventData {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  target: EventTarget;
}

class KeyboardHandler {
  private shortcuts: Map<string, ShortcutConfig>;

  handleKeyDown(event: KeyboardEvent): void;
  handleKeyUp(event: KeyboardEvent): void;
  shouldIgnoreEvent(event: KeyboardEvent): boolean;
  normalizeShortcut(event: KeyboardEvent): string;
}
```

### 4. Feedback System

```typescript
interface FeedbackOptions {
  message: string;
  duration?: number;
  type?: 'success' | 'info' | 'warning';
}

interface FeedbackSystem {
  showTooltip(options: FeedbackOptions): void;
  hideTooltip(): void;
  highlightTool(toolId: string): void;
  updateToolState(toolId: string, active: boolean): void;
}
```

## Data Models

### Shortcut Configuration

```typescript
interface ShortcutDefinition {
  // Primary key combination
  key: string;
  modifiers: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };

  // Alternative key combinations
  alternatives?: string[];

  // Action configuration
  action: {
    type: 'tool' | 'command' | 'view';
    target: string;
    payload?: any;
  };

  // Metadata
  description: string;
  category: string;
  enabled: boolean;
}
```

### Tool State Model

```typescript
interface ToolState {
  activeTool: string;
  previousTool: string;
  toolOptions: Record<string, any>;
  keepToolActive: boolean;
}
```

### Canvas State Model

```typescript
interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  selection: string[];
  clipboard: any[];
  undoStack: any[];
  redoStack: any[];
}
```

## Error Handling

### Error Types

1. **Invalid Shortcut**: When shortcut format is incorrect
2. **Conflicting Shortcuts**: When multiple actions map to same key
3. **Platform Incompatibility**: When shortcut doesn't work on platform
4. **Context Violation**: When shortcut fires in wrong context

### Error Handling Strategy

```typescript
class ShortcutError extends Error {
  constructor(
    message: string,
    public code: string,
    public shortcut?: string
  ) {
    super(message);
  }
}

// Error codes
const ERROR_CODES = {
  INVALID_SHORTCUT: 'INVALID_SHORTCUT',
  CONFLICTING_SHORTCUT: 'CONFLICTING_SHORTCUT',
  PLATFORM_INCOMPATIBLE: 'PLATFORM_INCOMPATIBLE',
  CONTEXT_VIOLATION: 'CONTEXT_VIOLATION'
} as const;
```

## Testing Strategy

### Unit Tests

1. **Shortcut Registration**: Test shortcut registration and deregistration
2. **Key Combination Parsing**: Test various key combination formats
3. **Platform Detection**: Test Ctrl/Cmd key mapping
4. **Context Filtering**: Test input field detection
5. **Command Execution**: Test action triggering

### Integration Tests

1. **Tool Switching**: Test all tool shortcuts work correctly
2. **Canvas Operations**: Test zoom, pan, selection shortcuts
3. **State Consistency**: Test state updates after shortcuts
4. **Cross-Platform**: Test on different operating systems
5. **Modal Interactions**: Test shortcuts in modal contexts

### Test Cases

```typescript
describe('Keyboard Shortcuts', () => {
  describe('Tool Switching', () => {
    it('should switch to selection tool on V key', () => {
      // Test implementation
    });

    it('should switch to rectangle tool on R key', () => {
      // Test implementation
    });
  });

  describe('Canvas Operations', () => {
    it('should zoom in on Ctrl+=', () => {
      // Test implementation
    });

    it('should pan canvas on Space+drag', () => {
      // Test implementation
    });
  });
});
```

## Implementation Details

### 1. Shortcut Registration System

The system will use a centralized registry where shortcuts are registered with their corresponding actions:

```typescript
// Example registration
registerShortcut({
  key: 'v',
  action: () => setTool('select'),
  description: 'Selection tool',
  category: 'tools'
});

registerShortcut({
  key: '=',
  ctrlKey: true,
  action: () => zoomIn(),
  description: 'Zoom in',
  category: 'view'
});
```

### 2. Platform Detection

```typescript
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modifierKey = isMac ? 'metaKey' : 'ctrlKey';
```

### 3. Context Awareness

```typescript
const shouldIgnoreShortcut = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement;
  const tagName = target.tagName.toLowerCase();

  // Ignore shortcuts in input fields
  if (['input', 'textarea', 'select'].includes(tagName)) {
    return true;
  }

  // Ignore shortcuts in contenteditable elements
  if (target.contentEditable === 'true') {
    return true;
  }

  return false;
};
```

### 4. Visual Feedback Implementation

```typescript
const showShortcutFeedback = (shortcut: string, action: string) => {
  // Show brief tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'shortcut-feedback';
  tooltip.textContent = `${shortcut}: ${action}`;

  document.body.appendChild(tooltip);

  setTimeout(() => {
    tooltip.remove();
  }, 1500);
};
```

### 5. Help Modal Structure

The help modal will display shortcuts organized by category:

```typescript
interface ShortcutCategory {
  name: string;
  shortcuts: Array<{
    keys: string[];
    description: string;
  }>;
}

const shortcutCategories: ShortcutCategory[] = [
  {
    name: 'Tools',
    shortcuts: [
      { keys: ['V', '1'], description: 'Selection tool' },
      { keys: ['R', '2'], description: 'Rectangle tool' },
      // ... more tools
    ]
  },
  {
    name: 'Editor',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
      { keys: ['Ctrl', 'Y'], description: 'Redo' },
      // ... more editor shortcuts
    ]
  },
  // ... more categories
];
```

## Performance Considerations

1. **Event Throttling**: Throttle rapid key events to prevent performance issues
2. **Lazy Loading**: Load shortcut definitions only when needed
3. **Memory Management**: Clean up event listeners on component unmount
4. **Efficient Lookup**: Use Map for O(1) shortcut lookup
5. **Debouncing**: Debounce feedback animations to prevent flicker

## Security Considerations

1. **Input Sanitization**: Validate shortcut configurations
2. **Context Isolation**: Prevent shortcuts from executing in wrong contexts
3. **Permission Checks**: Verify user can perform actions before execution
4. **XSS Prevention**: Sanitize any user-provided shortcut descriptions