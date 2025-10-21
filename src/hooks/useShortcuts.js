import { useEffect, useCallback, useRef } from 'react';

// Platform detection
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modifierKey = isMac ? 'metaKey' : 'ctrlKey';

// Shortcut registry
class ShortcutRegistry {
  constructor() {
    this.shortcuts = new Map();
    this.categories = new Map();
  }

  register(config) {
    const key = this.normalizeShortcut(config);
    this.shortcuts.set(key, config);

    // Add to category
    if (!this.categories.has(config.category)) {
      this.categories.set(config.category, []);
    }
    this.categories.get(config.category).push(config);
  }

  unregister(key) {
    this.shortcuts.delete(key);
  }

  find(event) {
    const key = this.normalizeShortcut({
      key: event.key.toLowerCase(),
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
    return this.shortcuts.get(key);
  }

  normalizeShortcut(config) {
    const parts = [];
    if (config.ctrlKey) parts.push('ctrl');
    if (config.shiftKey) parts.push('shift');
    if (config.altKey) parts.push('alt');
    if (config.metaKey) parts.push('meta');
    parts.push(config.key.toLowerCase());
    return parts.join('+');
  }

  getByCategory(category) {
    return this.categories.get(category) || [];
  }

  getAllCategories() {
    return Array.from(this.categories.keys());
  }

  getAllShortcuts() {
    return Array.from(this.shortcuts.values());
  }
}

const registry = new ShortcutRegistry();

export const useShortcuts = (shortcuts = []) => {
  const activeShortcuts = useRef(new Set());

  const shouldIgnoreEvent = useCallback((event) => {
    const target = event.target;
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
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (shouldIgnoreEvent(event)) return;

    const shortcut = registry.find(event);
    if (shortcut) {
      if (shortcut.preventDefault !== false) {
        event.preventDefault();
      }

      // Execute the action
      if (typeof shortcut.action === 'function') {
        shortcut.action(event);
      }

      // Track active shortcut for feedback
      const key = registry.normalizeShortcut({
        key: event.key.toLowerCase(),
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      });
      activeShortcuts.current.add(key);
    }
  }, [shouldIgnoreEvent]);

  const handleKeyUp = useCallback((event) => {
    const key = registry.normalizeShortcut({
      key: event.key.toLowerCase(),
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
    activeShortcuts.current.delete(key);
  }, []);

  // Register shortcuts
  useEffect(() => {
    shortcuts.forEach(shortcut => {
      registry.register(shortcut);
    });

    return () => {
      shortcuts.forEach(shortcut => {
        const key = registry.normalizeShortcut(shortcut);
        registry.unregister(key);
      });
    };
  }, [shortcuts]);

  // Add event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return {
    isActive: (key) => activeShortcuts.current.has(key),
    registry
  };
};

// Helper function to create platform-aware shortcuts
export const createShortcut = (config) => {
  // Convert Ctrl to Cmd on Mac
  if (config.ctrlKey && isMac) {
    return {
      ...config,
      ctrlKey: false,
      metaKey: true
    };
  }
  return config;
};

// Helper to format shortcut display
export const formatShortcut = (shortcut) => {
  const parts = [];

  if (shortcut.ctrlKey || shortcut.metaKey) {
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  }
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.altKey) parts.push('Alt');

  // Format key display
  let keyDisplay = shortcut.key;
  if (keyDisplay === ' ') keyDisplay = 'Space';
  else if (keyDisplay === 'escape') keyDisplay = 'Esc';
  else if (keyDisplay === 'delete') keyDisplay = 'Del';
  else if (keyDisplay === 'backspace') keyDisplay = 'Backspace';
  else if (keyDisplay === '=') keyDisplay = '+';
  else if (keyDisplay === '-') keyDisplay = '-';
  else if (keyDisplay === '0') keyDisplay = '0';
  else if (keyDisplay === '1') keyDisplay = '1';
  else keyDisplay = keyDisplay.toUpperCase();

  parts.push(keyDisplay);

  return parts;
};

export default useShortcuts;