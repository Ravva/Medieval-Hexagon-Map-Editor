/**
 * Map - Manages the game map with hexagonal grid system
 * Uses axial coordinates (q, r) for optimal LLM compatibility
 */

import { Hex, TERRAIN_TYPES, type TerrainType } from './Hex'
import { getAxialNeighbors } from './HexCoordinateConverter'

export class Map {
  width: number // Maximum Q coordinate
  height: number // Maximum R coordinate
  hexes: globalThis.Map<string, Hex[]> // Key format: "q,r" -> array of hexes at that position (sorted by height)

  constructor(width: number, height: number) {
    if (
      width === undefined ||
      height === undefined ||
      width === null ||
      height === null ||
      width <= 0 ||
      height <= 0 ||
      !Number.isInteger(width) ||
      !Number.isInteger(height)
    ) {
      throw new Error(
        `Invalid map dimensions: ${width}x${height}. Dimensions must be positive integers.`
      )
    }

    if (width * height > 1000000) {
      throw new Error(`Map too large: ${width}x${height}. Maximum size is 1000x1000.`)
    }

    this.width = width
    this.height = height
    this.hexes = new globalThis.Map()
  }

  /**
   * Get key for hex position in Map storage
   */
  getKey(q: number, r: number): string {
    return `${q},${r}`
  }

  /**
   * Initialize map with default terrain (PLAINS)
   * Creates hexes in a rectangular region using offset coordinates for initialization
   * then converts to axial coordinates
   */
  initializeTerrain() {
    // Initialize using offset coordinates for rectangular region, then convert
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Convert offset to axial for initialization
        // For rectangular initialization, we use offset coordinates
        // q = x, r = y - (x - (x&1)) / 2
        const q = x
        const r = y - (x - (x & 1)) / 2
        if (this.isValidCoordinate(q, r)) {
          const key = this.getKey(q, r)
          this.hexes.set(key, [new Hex(q, r, TERRAIN_TYPES.PLAINS)])
        }
      }
    }
  }

  isValidCoordinate(q: number, r: number): boolean {
    // Simple rectangular bounds check for axial coordinates
    // For rectangular maps initialized from offset coordinates,
    // we allow a wider range for r to accommodate the conversion
    // q ranges from 0 to width-1
    // r can be negative due to offset->axial conversion
    // For simplicity, we use a generous range that covers all possible conversions
    if (q < 0 || q >= this.width) {
      return false
    }
    // Allow r from -width/2 to height (generous range for offset conversion)
    return r >= -this.width && r < this.height + this.width
  }

  // Get hex at specific height level (0-4)
  getHex(q: number, r: number, height?: number): Hex | null {
    if (!this.isValidCoordinate(q, r)) {
      return null
    }

    const key = this.getKey(q, r)
    const hexStack = this.hexes.get(key)

    if (!hexStack || hexStack.length === 0) {
      return null
    }

    // If height specified, return hex at that height
    if (height !== undefined) {
      return hexStack.find(h => h.height === height) || null
    }

    // Otherwise return topmost hex
    return hexStack[hexStack.length - 1]
  }

  // Get all hexes at position (all height levels)
  getHexStack(q: number, r: number): Hex[] {
    if (!this.isValidCoordinate(q, r)) {
      return []
    }

    const key = this.getKey(q, r)
    return this.hexes.get(key) || []
  }

  // Add or replace hex at specific position and height
  setHex(q: number, r: number, hex: Hex) {
    // Ensure hex coordinates match the position
    if (hex.q !== q || hex.r !== r) {
      throw new Error(
        `Hex coordinates (${hex.q}, ${hex.r}) do not match position (${q}, ${r})`
      )
    }

    if (!this.isValidCoordinate(q, r)) {
      throw new Error(`Invalid coordinates: (${q}, ${r})`)
    }

    const key = this.getKey(q, r)
    let hexStack = this.hexes.get(key)

    if (!hexStack) {
      hexStack = []
      this.hexes.set(key, hexStack)
    }

    // Remove any existing hex at same height
    const existingIndex = hexStack.findIndex(h => h.height === hex.height)
    if (existingIndex !== -1) {
      hexStack[existingIndex] = hex
    } else {
      hexStack.push(hex)
      // Keep sorted by height
      hexStack.sort((a, b) => a.height - b.height)
    }
  }

  setTerrain(q: number, r: number, terrain: string) {
    const hex = this.getHex(q, r)
    if (hex) {
      hex.terrain = terrain as TerrainType
    }
  }

  // Remove hex at specific height, or topmost if height not specified
  removeHex(q: number, r: number, height?: number) {
    if (!this.isValidCoordinate(q, r)) {
      return
    }

    const key = this.getKey(q, r)
    const hexStack = this.hexes.get(key)

    if (!hexStack || hexStack.length === 0) {
      return
    }

    if (height !== undefined) {
      // Remove hex at specific height
      const hexIndex = hexStack.findIndex(h => h.height === height)
      if (hexIndex !== -1) {
        hexStack.splice(hexIndex, 1)
      }
    } else {
      // Remove topmost hex
      hexStack.pop()
    }

    // Clean up empty stacks
    if (hexStack.length === 0) {
      this.hexes.delete(key)
    }
  }

  hasHex(q: number, r: number, height?: number): boolean {
    if (!this.isValidCoordinate(q, r)) {
      return false
    }

    const key = this.getKey(q, r)
    const hexStack = this.hexes.get(key)

    if (!hexStack || hexStack.length === 0) {
      return false
    }

    if (height !== undefined) {
      return hexStack.some(h => h.height === height)
    }

    return true
  }

  // Get next available height level at position
  getNextHeight(q: number, r: number): number {
    const hexStack = this.getHexStack(q, r)
    if (hexStack.length === 0) {
      return 0
    }

    // Find highest hex and return next level
    const maxHeight = Math.max(...hexStack.map(h => h.height))
    return Math.min(4, maxHeight + 1) // Cap at level 4
  }

  // Get neighboring coordinates for hexagonal grid (axial coordinates)
  // Simplified: no conditional logic needed!
  getNeighborCoordinates(q: number, r: number): Array<{ q: number; r: number }> {
    const neighbors = getAxialNeighbors(q, r)
    // Filter to only valid coordinates
    return neighbors.filter(coord => this.isValidCoordinate(coord.q, coord.r))
  }
}
