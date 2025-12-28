/**
 * TileConnectionAnalyzer - Analyzes OBJ geometry to determine tile connections
 *
 * For hexagonal tiles (rivers, roads, coast), determines which of the 6 sides
 * have exits/connections based on geometric analysis of the 3D model.
 *
 * Uses ONLY automatic methods:
 * 1. Geometric analysis of OBJ vertices/faces
 * 2. Filename heuristics (straight, corner, left, right, inside, outside, crossing)
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Hexagonal directions in axial coordinates
 * Each direction corresponds to one of the 6 sides of a hexagon
 */
export const HEX_DIRECTIONS = {
  EAST: { q: 1, r: 0, name: 'east', angle: 0 },
  NORTHEAST: { q: 1, r: -1, name: 'northeast', angle: 60 },
  NORTHWEST: { q: 0, r: -1, name: 'northwest', angle: 120 },
  WEST: { q: -1, r: 0, name: 'west', angle: 180 },
  SOUTHWEST: { q: -1, r: 1, name: 'southwest', angle: 240 },
  SOUTHEAST: { q: 0, r: 1, name: 'southeast', angle: 300 },
} as const

export type HexDirection = keyof typeof HEX_DIRECTIONS

/**
 * Connection type on hex edge
 */
export type ConnectionType = 'grass' | 'water' | 'coast' | 'road' | 'unknown'

/**
 * Connection information for a tile
 * Each direction can have a connection type, not just boolean
 */
export interface TileConnections {
  east?: ConnectionType
  northeast?: ConnectionType
  northwest?: ConnectionType
  west?: ConnectionType
  southwest?: ConnectionType
  southeast?: ConnectionType
}

/**
 * Analyze OBJ file to determine tile connections by checking TOP SURFACE edges
 *
 * Strategy:
 * 1. Parse OBJ vertices and find maxY (top surface)
 * 2. Filter vertices on top surface (Y ≈ maxY)
 * 3. For each of 6 hex edges, check if top surface has vertices on that edge
 * 4. If edge has top surface vertices → connection exists (type from tileType)
 * 5. If no top surface vertices on edge → no connection (solid wall)
 *
 * @param objPath - Path to OBJ file
 * @param mtlPath - Path to MTL file (unused, kept for compatibility)
 * @param tileType - Type of tile ('river', 'road', 'coast', 'base', or 'other')
 * @returns Connection information for each of the 6 directions
 */
export function analyzeTileConnections(
  objPath: string,
  mtlPath: string,
  tileType: 'river' | 'road' | 'coast' | 'base' | 'other' = 'other',
  biome?: string
): TileConnections {
  if (!fs.existsSync(objPath)) {
    console.warn(`OBJ file not found: ${objPath}`)
    return {}
  }

  const content = fs.readFileSync(objPath, 'utf-8')
  const lines = content.split('\n')

  const vertices: Array<[number, number, number]> = []

  // Parse OBJ vertices
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('v ')) {
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 4) {
        const x = parseFloat(parts[1])
        const y = parseFloat(parts[2])
        const z = parseFloat(parts[3])
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          vertices.push([x, y, z])
        }
      }
    }
  }

  if (vertices.length === 0) {
    return {}
  }

  // Find top surface (maxY) and filter top surface vertices
  let maxY = -Infinity
  for (const [, y] of vertices) {
    maxY = Math.max(maxY, y)
  }

  // Tolerance for top surface detection (allow small variations)
  // Some models have slightly lowered edge vertices (e.g., Y = -0.05 vs Y = 0)
  const TOP_SURFACE_TOLERANCE = 0.1

  // Filter vertices on top surface
  const topVertices: Array<[number, number, number]> = []
  for (const v of vertices) {
    if (v[1] >= maxY - TOP_SURFACE_TOLERANCE) {
      topVertices.push(v)
    }
  }

  // Debug output
  if (objPath.includes('hex_grass.obj')) {
    console.log(`[DEBUG hex_grass] maxY=${maxY}, tolerance=${TOP_SURFACE_TOLERANCE}`)
    console.log(`[DEBUG hex_grass] topVertices count: ${topVertices.length}`)
    console.log(`[DEBUG hex_grass] topVertices sample:`, topVertices.slice(0, 5))
  }

  if (topVertices.length === 0) {
    // Fallback: use all vertices if no top surface detected
    topVertices.push(...vertices)
  }

  // Calculate hexagon center and size from top vertices
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity

  for (const [x, , z] of topVertices) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  // Calculate hex size
  const hexSize = Math.max(Math.abs(maxX - minX), Math.abs(maxZ - minZ)) / 2
  const HEX_OUTER_RADIUS = 2 / Math.sqrt(3) // ~1.155
  const HEX_INNER_RADIUS = 1.0
  const outerRadius = hexSize * HEX_OUTER_RADIUS
  const innerRadius = hexSize * HEX_INNER_RADIUS

  if (objPath.includes('hex_grass.obj')) {
    console.log(`[DEBUG hex_grass] centerX=${centerX}, centerZ=${centerZ}`)
    console.log(`[DEBUG hex_grass] hexSize=${hexSize}, innerRadius=${innerRadius}, outerRadius=${outerRadius}`)
  }

  // Map tile type to connection type
  function get_connection_type_for_tile(t: typeof tileType, b?: string): ConnectionType {
    // For base tiles, determine type from biome
    if (t === 'base' && biome) {
      if (biome === 'water') return 'water'
      if (biome === 'forest') return 'grass'
      if (biome === 'mountain') return 'grass'
      return 'grass' // Default for plains
    }

    switch (t) {
      case 'base': return 'grass'
      case 'coast': return 'coast'
      case 'river': return 'water'
      case 'road': return 'road'
      default: return 'unknown'
    }
  }

  const defaultConnectionType = get_connection_type_for_tile(tileType, biome)
  const connections: TileConnections = {}

  // Edge angle ranges for flat-topped hexagon
  // Each edge spans ±30° around its direction angle
  const edgeRanges: Array<{ name: keyof TileConnections; angle: number }> = [
    { name: 'east', angle: 0 },
    { name: 'southeast', angle: 60 },
    { name: 'southwest', angle: 120 },
    { name: 'west', angle: 180 },
    { name: 'northwest', angle: 240 },
    { name: 'northeast', angle: 300 },
  ]

  // Check each edge for top surface vertices
  // Edge detection zone: between innerRadius and outerRadius at edge angle ±30°
  const EDGE_ANGLE_TOLERANCE = 30 // degrees

  for (const { name, angle } of edgeRanges) {
    let hasTopVertexOnEdge = false

    if (objPath.includes('hex_grass.obj')) {
      console.log(`[DEBUG hex_grass] Checking edge: ${name} (angle=${angle})`)
    }

    for (const [x, , z] of topVertices) {
      const dx = x - centerX
      const dz = z - centerZ
      const distance = Math.sqrt(dx * dx + dz * dz)
      const vertexAngle = Math.atan2(dz, dx) * (180 / Math.PI)
      const normalizedAngle = vertexAngle < 0 ? vertexAngle + 360 : vertexAngle

      // Check if vertex is on the edge:
      // 1. Distance between inner and outer radius (on the rim)
      // 2. Angle within edge range (±30°)
      const onRim = distance >= innerRadius * 0.9 && distance <= outerRadius * 1.1

      // Normalize angles for comparison (handle wrap-around at 0°/360°)
      let angleDiff = Math.abs(normalizedAngle - angle)
      if (angleDiff > 180) angleDiff = 360 - angleDiff

      const withinAngle = angleDiff <= EDGE_ANGLE_TOLERANCE

      if (objPath.includes('hex_grass.obj') && onRim) {
        console.log(`[DEBUG hex_grass]   Vertex (${x.toFixed(3)}, ${z.toFixed(3)}): dist=${distance.toFixed(3)}, angle=${normalizedAngle.toFixed(1)}, diff=${angleDiff.toFixed(1)}, onRim=${onRim}, withinAngle=${withinAngle}`)
      }

      if (onRim && withinAngle) {
        hasTopVertexOnEdge = true
        break
      }
    }

    if (objPath.includes('hex_grass.obj')) {
      console.log(`[DEBUG hex_grass] Edge ${name}: hasConnection=${hasTopVertexOnEdge}`)
    }

    if (hasTopVertexOnEdge) {
      connections[name] = defaultConnectionType
    }
  }

  return connections
}

/**
 * Get connection information from filename heuristics
 *
 * Semantic patterns:
 * - crossing: Intersection of river and road (2 connections for river, 2 for road)
 * - straight: 2 opposite connections (E-W, NE-SW, or NW-SE)
 * - corner: 2 adjacent connections (forming a corner)
 * - left/right: Directional connections (context-dependent)
 * - inside/outside: For coast tiles (inside = land side, outside = water side)
 *
 * @param fileName - Name of the OBJ file
 * @param tileType - Type of tile ('river', 'road', 'coast', 'base', 'other')
 * @param biome - Biome type (for base tiles: water → water, others → grass)
 * @returns Connection information or null if no pattern detected
 */
export function getConnectionsFromFilename(
  fileName: string,
  tileType: 'river' | 'road' | 'coast' | 'base' | 'other' = 'other',
  biome?: string
): TileConnections | null {
  const nameLower = fileName.toLowerCase()

  // Определяем тип соединения по типу тайла и биому
  let connectionType: ConnectionType = 'unknown'
  switch (tileType) {
    case 'river':
      connectionType = 'water'
      break
    case 'road':
      connectionType = 'road'
      break
    case 'coast':
      connectionType = 'coast'
      break
    case 'base':
      // For base tiles, determine type from biome
      if (biome === 'water') {
        connectionType = 'water'
      } else {
        connectionType = 'grass' // forest, mountain, plains → grass
      }
      break
    default:
      connectionType = 'unknown'
  }

  // CROSSING: Intersection of river and road
  // For crossing tiles, there are typically 4 exits (2 for river, 2 for road)
  // Default pattern: East-West (river) and Northeast-Southwest (road)
  if (nameLower.includes('crossing')) {
    // Crossing: река и дорога пересекаются
    const riverType: ConnectionType = 'water'
    const roadType: ConnectionType = 'road'
    return {
      east: riverType,
      west: riverType,
      northeast: roadType,
      southwest: roadType,
    }
  }

  // STRAIGHT: 2 opposite connections
  if (nameLower.includes('straight')) {
    // Default to East-West for straight tiles
    return {
      east: connectionType,
      west: connectionType,
    }
  }

  // CORNER: 2 adjacent connections (forming a corner)
  if (nameLower.includes('corner')) {
    // Default corner: Northeast and Southeast (right corner)
    // This can be rotated, so we provide a common pattern
    return {
      northeast: connectionType,
      southeast: connectionType,
    }
  }

  // LEFT/RIGHT: Directional connections
  // These are context-dependent and may need rotation
  if (nameLower.includes('left')) {
    // Left turn: typically Northwest and West, or Southwest and West
    return {
      northwest: connectionType,
      west: connectionType,
    }
  }

  if (nameLower.includes('right')) {
    // Right turn: typically Northeast and East, or Southeast and East
    return {
      northeast: connectionType,
      east: connectionType,
    }
  }

  // INSIDE/OUTSIDE: For coast tiles
  if (tileType === 'coast') {
    if (nameLower.includes('inside')) {
      // Inside = land side, typically 1-2 connections toward land (grass)
      return {
        southwest: 'grass' as ConnectionType,
      }
    }

    if (nameLower.includes('outside')) {
      // Outside = water side, typically 1-2 connections toward water
      return {
        northeast: 'water' as ConnectionType,
      }
    }
  }

  // CURVY: For rivers, typically still has 2 connections but curved path
  if (nameLower.includes('curvy')) {
    // Curvy rivers still connect in 2 directions, default to East-West
    return {
      east: connectionType,
      west: connectionType,
    }
  }

  // SLOPED: For roads, sloped tiles still have connections
  if (nameLower.includes('sloped')) {
    // Sloped roads still connect, default to East-West
    return {
      east: connectionType,
      west: connectionType,
    }
  }

  // If no pattern detected, return null (will rely on geometry analysis)
  return null
}

/**
 * Combine connection sources (geometry analysis + filename heuristics)
 * Filename heuristics take precedence if they exist, otherwise use geometry
 *
 * @param geometryConnections - Connections from geometric analysis
 * @param filenameConnections - Connections from filename heuristics
 * @returns Combined connection information
 */
export function combineConnections(
  geometryConnections: TileConnections,
  filenameConnections: TileConnections | null
): TileConnections {
  // Filename heuristics take precedence (more reliable for known patterns)
  if (filenameConnections && Object.values(filenameConnections).some((v) => v !== undefined && v !== null)) {
    return filenameConnections
  }

  // Fall back to geometry analysis
  return geometryConnections
}
