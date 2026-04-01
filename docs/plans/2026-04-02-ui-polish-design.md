# Phase 3: UI Polish — Visual Consistency & Readability

## Problem

The current UI has inconsistent node styles, barely visible edges, no selection feedback, and panels that are hard to read. The graph looks messy and unprofessional.

## Design

### 1. Unified node design system
- Consistent structure across all node types: 10px 14px padding, 6px border-radius, 1px border
- Layer color as 4px left border accent on ALL node types (modules, functions, classes, methods)
- Uniform font sizes: 13px labels, 11px metadata, 9px badges
- Three opacity levels: 1.0 primary, 0.6 secondary, 0.4 tertiary
- Selected node: bright border glow matching layer color + subtle box shadow

### 2. Edge visibility
- Import edges: arrowhead marker, #94a3b8 color (visible on dark bg)
- Unresolved imports: red dashed (#ef4444)
- All edges: minimum 2px stroke
- Dynamic arrow marker color (matches edge, not hardcoded blue)

### 3. Panel readability
- Code preview: 12px monospace with basic keyword coloring
- Parameters: table-aligned type column
- Section dividers: subtle horizontal rules
- Complexity: colored pill badge

### 4. Selection and focus states
- Selected node: 2px bright border + box shadow glow
- Breadcrumb: current level bold, previous levels dimmed
- Minimap: custom dark theme colors
