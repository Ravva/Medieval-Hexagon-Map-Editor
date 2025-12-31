# 🗺️ Medieval Hexagon Map Editor

<div align="center">

**Modern web editor for creating and editing hexagonal maps with 3D visualization and AI generation**

[![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.182.0-black?logo=three.js)](https://threejs.org/)

</div>

<div align="center">

![UI Screenshot](https://raw.githubusercontent.com/Ravva/Medieval-Hexagon-Map-Editor/main/public/UI%20v2.png)

<div style="background: transparent;">

![Medieval Hexagon Pack](https://raw.githubusercontent.com/Ravva/Medieval-Hexagon-Map-Editor/main/public/MHP.png)

</div>

**Based on:** [KayKit Medieval Hexagon](https://kaylousberg.itch.io/kaykit-medieval-hexagon) by [Kay Lousberg](https://kaylousberg.itch.io/)

</div>

---

## 📋 Description

**Medieval Hexagon Map Editor** is a full-featured 3D editor for creating and editing hexagonal maps. The editor allows you to create complex multi-level landscapes using real 3D models, supports map generation via AI (Google Gemini API or local via LM Studio), and provides a modern interface with advanced editing capabilities.

### ✨ Key Features

- 🎨 **3D Editing** — Full-featured 3D editor using Three.js and real 3D models
- 📐 **Multi-level System** — Support for up to 5 height levels for creating complex landscapes
- 🤖 **AI Map Generation** — Automatic map generation via Google Gemini API or local LLM models
- 🎯 **Precise Editing** — Placement of tiles, buildings, decorations with precise positioning
- 🔄 **Smart Tools** — Copy/paste, multi-selection, undo/redo
- 💾 **Save & Load** — Export maps to JSON format for further use
- 🎮 **Hotkeys** — Fast editing with keyboard shortcuts
- 🌊 **Auto-correction** — Automatic alignment of rivers and roads for proper connections (WIP)

---

## 🛠️ Tech Stack

### Frontend
- **[Next.js 16.1.1](https://nextjs.org/)** — React framework with App Router
- **[React 19.2.3](https://react.dev/)** — UI library
- **[TypeScript 5](https://www.typescriptlang.org/)** — Type safety
- **[Three.js 0.182.0](https://threejs.org/)** — 3D rendering and visualization
- **[Tailwind CSS 3.4](https://tailwindcss.com/)** — Styling
- **[Shadcn/ui](https://ui.shadcn.com/)** — UI components based on Radix UI

### Backend & API
- **[Google Gemini API](https://ai.google.dev/)** — AI-powered map generation
- **Next.js API Routes** — Server endpoints for LLM integration

### Development Tools
- **[Bun](https://bun.sh/)** — Package manager and runtime
- **[Biome](https://biomejs.dev/)** — Code linter and formatter
- **[Vitest](https://vitest.dev/)** — Testing framework
- **[Turbopack](https://turbo.build/pack)** — Fast build tool (optional)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+ or **Bun** 1.0+
- **npm**, **yarn**, **pnpm**, or **bun** (bun recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/Medieval-Hexagon-Map-Editor.git
   cd Medieval-Hexagon-Map-Editor
   ```

2. **Install dependencies**
   ```bash
   bun install
   # or
   npm install
   ```

3. **Run the development server**
   ```bash
   bun run dev
   # or
   npm run dev
   ```

4. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

---

## 📖 Usage

### Main Editor Features

#### 🎨 Map Editing

- **Left Click** — Place/select tile
- **Right Click** — Rotate tile
- **Middle Click** — Pan camera
- **Drag** — Move tile
- **R/F** — Change height level
- **Ctrl+Left Click** — Multi-select
- **Ctrl+C** — Copy tile
- **Ctrl+V** — Paste tile
- **Ctrl+Z** — Undo action
- **Ctrl+Y** — Redo action

#### 🤖 AI Map Generation

1. Click the **"Generate Map"** button in the interface
2. Select LLM provider (Google Gemini or local server)
3. Enter API key (if using Gemini)
4. Configure generation parameters:
   - Map size
   - Biome (plains, forest, desert, etc.)
   - Rivers and roads
   - Village placement
5. Enter custom prompt (optional)
6. Click **"Generate"** and wait for the result

#### 💾 Save & Load

- **Save Map**: `File → Save Map` or `Ctrl+S`
- **Load Map**: `File → Load Map` or `Ctrl+O`
- **New Map**: `File → New Map` or `Ctrl+N`

---

## 📁 Project Structure

```
Medieval-Hexagon-Map-Editor/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   │   └── llm/          # LLM integration
│   └── page.tsx          # Main page
├── components/            # React components
│   ├── MapEditor.tsx     # Main editor component
│   ├── GenerateMapDialog.tsx  # Map generation dialog
│   ├── AssetPanel.tsx    # Asset selection panel
│   └── ui/               # Shadcn/ui components
├── lib/                   # Libraries and utilities
│   ├── game/             # Game logic (Map, Hex, Serializer)
│   ├── llm/              # LLM client and map generator
│   └── three/            # Three.js utilities
├── assets/                # 3D models and textures
│   └── terrain/          # Tiles, buildings, decorations
├── scripts/               # Utility scripts
└── docs/                  # Documentation
```

---

## 🧪 Development

### Available Commands

```bash
# Development (Turbopack)
bun run dev

# Development (Webpack)
bun run dev:webpack

# Production build
bun run build

# Start production server
bun run start

# Linting
bun run lint

# Formatting
bun run format

# Code check (lint + format)
bun run check

# Testing
bun run test

# Generate tile registry
bun run generate-registry
```

### Code Formatting

The project uses **Biome** for formatting and linting. Configuration is in `biome.json`.

```bash
# Auto-fix issues
bun run check:fix
```

---

## 🎯 Implementation Details

### Coordinate System

The editor uses **axial coordinates (q, r)** for the hexagonal grid, which provides:
- Compatibility with LLM map generation
- Simplicity of mathematical operations
- Efficient data storage

### Multi-level System

Support for up to **5 height levels** allows creating:
- Complex landscapes with elevation changes
- Multi-story structures
- Realistic mountain ranges

### AI Map Generation

Integration with **Google Gemini API** and support for local LLM servers:
- Automatic map generation from description
- Smart placement of rivers and roads with proper connections
- Automatic tile rotation correction
- Customizable system prompts

---

## 📝 License

MIT License

Copyright (c) 2025 Ravva

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🤝 Contributing

The project is under active development. If you want to contribute:

1. Create an issue describing the problem or suggestion
2. Fork the repository
3. Create a branch for your changes
4. Make changes and ensure code passes linting
5. Create a Pull Request

---

## 📞 Contact

If you have questions or suggestions, create an issue in the repository.

---

<div align="center">

**Made with ❤️ for hexagonal map development**

</div>
