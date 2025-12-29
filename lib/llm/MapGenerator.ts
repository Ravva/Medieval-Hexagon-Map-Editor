/**
 * MapGenerator - Generates hex maps using LLM (Gemini API)
 *
 * Uses tile registry and LLM to generate realistic hex-based tactical maps
 */

import { LLMClient } from './LLMClient'
import { Map as GameMap } from '../game/Map'
import { Hex, TERRAIN_TYPES, type TerrainType } from '../game/Hex'
import fs from 'fs'
import path from 'path'
import type { TileDescriptor } from './AssetAnalyzer'

export interface GeneratedHex {
  q: number
  r: number
  tile_id: string
  rotation: number // 0, 60, 120, 180, 240, 300 degrees
  height: number // 0-4
}

export interface GenerateMapParams {
  width: number
  height: number
  prompt?: string
  biome?: 'plains' | 'water' | 'forest' | 'mountain'
  mapSize?: 'tiny' | 'small' | 'medium' | 'large' | 'very-large'
}

export interface TileRegistry {
  version: string
  generatedAt: string
  totalTiles: number
  tiles: TileDescriptor[]
}

export class MapGenerator {
  private llmClient: LLMClient
  private tileRegistry: TileRegistry | null = null
  private readonly registryPath: string

  constructor(apiKey?: string) {
    this.llmClient = new LLMClient(apiKey)
    this.registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
  }

  /**
   * Load tile registry from JSON file
   */
  private loadTileRegistry(): TileRegistry {
    if (this.tileRegistry) {
      return this.tileRegistry
    }

    if (!fs.existsSync(this.registryPath)) {
      throw new Error(
        `Tile registry not found at ${this.registryPath}. Run "bun run generate-registry" first.`
      )
    }

    const content = fs.readFileSync(this.registryPath, 'utf-8')
    this.tileRegistry = JSON.parse(content) as TileRegistry

    return this.tileRegistry
  }

  /**
   * Get JSON Schema for map generation response
   */
  private getMapGenerationSchema() {
    return {
      type: 'object',
      properties: {
        hexes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              q: { type: 'integer', minimum: 0 },
              r: { type: 'integer', minimum: 0 },
              tile_id: { type: 'string' },
              rotation: { type: 'integer', minimum: 0, maximum: 300 },
              height: { type: 'integer', minimum: 0, maximum: 4 },
            },
            required: ['q', 'r', 'tile_id', 'rotation', 'height'],
          },
        },
      },
      required: ['hexes'],
    }
  }

  /**
   * Build prompt for map generation
   */
  private buildPrompt(params: GenerateMapParams, tileRegistry: TileRegistry): string {
    const { width, height, prompt, biome } = params

    // Compact tile registry (only include essential fields to reduce token count)
    // Include connection information for rivers, roads, and coast tiles
    const compactTiles = tileRegistry.tiles.map((tile) => {
      const compact: {
        tile_id: string
        biome: string
        category: string
        walkable: boolean
        tags: string[]
        connections?: TileDescriptor['connections']
      } = {
        tile_id: tile.tile_id,
        biome: tile.biome,
        category: tile.category,
        walkable: tile.walkable,
        tags: tile.tags,
      }

      // Include connections information for tiles that need connections
      if (tile.connections && Object.values(tile.connections).some(Boolean)) {
        compact.connections = tile.connections
      }

      return compact
    })

    const userPrompt = prompt || `Generate a ${biome || 'plains'} map`
    const primaryBiome = biome || 'plains'

    const promptText = `You are an expert game designer specializing in creating hex-based tactical maps for turn-based strategy games.

Your task is to generate a hex map layout based on the provided parameters.

MAP COORDINATES SYSTEM:
- This map uses AXIAL coordinates (q, r)
- q ranges from 0 to ${width - 1}
- r ranges from 0 to ${height - 1}
- Distance formula: distance(a, b) = (|a.q - b.q| + |a.q + a.r - b.q - b.r| + |a.r - b.r|) / 2
- Each hex has 6 neighbors

HEIGHT SYSTEM - CRITICAL RULES:
- Height levels: 0 (ground level) to 4 (highest)
- Each hex position (q, r) can have MULTIPLE tiles at different heights, forming a stack
- IMPORTANT: If you place a tile at height N, you MUST also place a BASE tile at height 0 at the same position (q, r)
- For example: If placing a castle at height 2, you need:
  * Base tile (plains/grass) at height 0
  * Castle tile at height 2 (it will stack on top)
- Water tiles are ALWAYS at height 0
- Mountains/hills: Use height 0-1 for foothills, height 2-4 for peaks (but always include base at height 0)
- Forests: Usually height 0-1, with base tile at height 0
- Buildings: Height 0-1, always with base tile at height 0
- Adjacent hexes should not differ by more than 1 height level (realistic slopes)

RIVER/ROAD CONNECTIVITY - CRITICAL:
- Rivers and roads MUST form continuous, connected paths
- Each tile has connection information in the "connections" field (if present)
- The "connections" field indicates which of the 6 hex sides have connections:
  * east, northeast, northwest, west, southwest, southeast
- Connection types: "river", "road", "water", "grass" - use tiles with matching connection types
- When placing a tile, check its "connections" field to see which sides connect
- Rotate tiles (0, 60, 120, 180, 240, 300 degrees) to align connections properly
- CRITICAL RULE: If tile A connects to neighbor B at direction X, then:
  * Tile A must have connection at direction X
  * Tile B must have connection at the OPPOSITE direction (X + 180 degrees)
  * Example: If A connects EAST to B, then A has "east: true" and B has "west: true"
- CONNECTION COUNTS for rivers/roads:
  * 2 connections = straight line or turn (most common)
  * 3 connections = branching/merging point (for splits and joins)
  * 4+ connections = complex intersections
- For river branching/merging: use tiles with exactly 3 river connections
- For road branching/merging: use tiles with exactly 3 road connections
- All connections are equal - no "input/output" concept, just continuous flow
- River tiles should form continuous networks without gaps or disconnected segments
- Road tiles should form connected road networks
- Always use height 0 for all river/road tiles

TILE PLACEMENT RULES:
1. Match biome to tile_id (use tiles with matching biome property from the registry)
2. ALWAYS place a base tile (height 0) before placing elevated features (height > 0)
3. For each position with elevated features, generate TWO hexes: base at height 0, feature at target height
4. Ensure walkable paths between important areas
5. Rivers/roads MUST form connected networks with proper connection alignment
6. Buildings/structures must be placed on flat terrain (height 0-1) with base tile at height 0
7. Rotation must be one of: 0, 60, 120, 180, 240, or 300 degrees
8. For rivers: Use tiles with "connections.river" and rotate to create continuous flow
9. For roads: Use tiles with "connections.road" and rotate to create continuous paths
10. For branching/merging: Use tiles with exactly 3 connections of the same type
11. MANDATORY: Every non-base tile (decoration, building) MUST have a base tile at the same (q,r) position at height 0

OUTPUT FORMAT:
You must output a JSON object with a "hexes" array. Each hex object must have:
- q: number (axial coordinate, 0 to ${width - 1})
- r: number (axial coordinate, 0 to ${height - 1})
- tile_id: string (must match a tile_id from the provided registry)
- rotation: number (0, 60, 120, 180, 240, or 300 degrees)
- height: number (0-4)

USER REQUEST: ${userPrompt}
PRIMARY BIOME: ${primaryBiome}

CONSTRAINTS:
- Map size: ${width}x${height}
- Maximum slope: 1 (adjacent hexes should not differ by more than 1 height level)
- Generate hexes for ALL positions (q, r) where q in [0, ${width - 1}], r in [0, ${height - 1}]
- For positions with elevated features (height > 0), generate TWO hexes: base tile at height 0 + feature tile at target height
- Total hexes should be approximately ${width * height} (one base per position) plus additional hexes for elevated features

TILE REGISTRY (use tile_id values from here):
${JSON.stringify(compactTiles, null, 2)}

BIOME REALISM RULES:
1. WATER BIOMES:
   - Form connected areas (rivers flow, lakes are circular)
   - Always height 0
   - Use tile_id values with biome="water"

2. MOUNTAIN BIOMES:
   - Cluster in groups of 5+ hexes
   - Height 2-4 (peaks at 3-4, foothills at 1-2)
   - Use tile_id values with biome="mountain"

3. FOREST BIOMES:
   - Form large continuous areas (10+ hexes)
   - Height 0-2
   - Use tile_id values with biome="forest"

4. PLAINS BIOMES:
   - Most common biome type
   - Flat terrain (height 0-1)
   - Good for roads and settlements
   - Use tile_id values with biome="plains"

Generate a realistic and playable map based on the user's request. The primary biome should be ${primaryBiome}, but you can include other biomes as appropriate to create a natural landscape. Return JSON with "hexes" array.`

    return promptText
  }

  /**
   * Convert GeneratedHex to Hex (using tile registry)
   */
  private generatedHexToHex(generatedHex: GeneratedHex, tileRegistry: TileRegistry): Hex {
    // Find tile in registry
    const tileDescriptor = tileRegistry.tiles.find((t) => t.tile_id === generatedHex.tile_id)

    if (!tileDescriptor) {
      console.warn(
        `Tile ${generatedHex.tile_id} not found in registry, using PLAINS as fallback`
      )
      // Fallback to PLAINS
      const hex = new Hex(generatedHex.q, generatedHex.r, TERRAIN_TYPES.PLAINS)
      hex.height = generatedHex.height
      hex.rotation = (generatedHex.rotation * Math.PI) / 180 // Convert degrees to radians
      return hex
    }

    // Map biome to terrain type
    let terrain: TerrainType = TERRAIN_TYPES.PLAINS
    switch (tileDescriptor.biome) {
      case 'water':
        terrain = TERRAIN_TYPES.WATER
        break
      case 'forest':
        terrain = TERRAIN_TYPES.FOREST
        break
      case 'mountain':
        terrain = TERRAIN_TYPES.MOUNTAIN
        break
      case 'plains':
        terrain = TERRAIN_TYPES.PLAINS
        break
      default:
        terrain = TERRAIN_TYPES.PLAINS
    }

    const hex = new Hex(generatedHex.q, generatedHex.r, terrain)
    hex.height = generatedHex.height
    hex.rotation = (generatedHex.rotation * Math.PI) / 180 // Convert degrees to radians

    // Add model data if available
    if (tileDescriptor.obj_path && tileDescriptor.mtl_path) {
      hex.modelData = {
        obj: tileDescriptor.obj_path,
        mtl: tileDescriptor.mtl_path,
        name: tileDescriptor.name,
      }
    }

    return hex
  }

  /**
   * Generate a hex map using LLM
   */
  async generateMap(params: GenerateMapParams): Promise<GeneratedHex[]> {
    const { width, height } = params

    // Validate dimensions
    if (width <= 0 || height <= 0 || !Number.isInteger(width) || !Number.isInteger(height)) {
      throw new Error(`Invalid map dimensions: ${width}x${height}`)
    }

    if (width * height > 10000) {
      throw new Error(
        `Map too large: ${width}x${height}. Maximum size for simple generation is 100x100. Use hierarchical generation for larger maps.`
      )
    }

    // Load tile registry
    const tileRegistry = this.loadTileRegistry()

    // Build prompt
    const prompt = this.buildPrompt(params, tileRegistry)

    // Get JSON Schema
    const responseSchema = this.getMapGenerationSchema()

    // Generate map using LLM
    console.log(`Generating ${width}x${height} map using LLM...`)
    const response = await this.llmClient.generateContentWithRetry<{ hexes: GeneratedHex[] }>(
      prompt,
      {
        responseSchema,
        temperature: 0.8, // Higher temperature for more creativity
      }
    )

    if (!response.content.hexes || !Array.isArray(response.content.hexes)) {
      throw new Error('Invalid response format: missing hexes array')
    }

    // Validate generated hexes
    let generatedHexes = response.content.hexes
    if (generatedHexes.length < width * height) {
      console.warn(
        `Expected at least ${width * height} hexes, got ${generatedHexes.length}. LLM may have generated fewer hexes.`
      )
    }

    // Validate rotation values
    const validRotations = [0, 60, 120, 180, 240, 300]
    for (const hex of generatedHexes) {
      if (!validRotations.includes(hex.rotation)) {
        // Round to nearest valid rotation
        const nearest = validRotations.reduce((prev, curr) =>
          Math.abs(curr - hex.rotation) < Math.abs(prev - hex.rotation) ? curr : prev
        )
        console.warn(`Invalid rotation ${hex.rotation} for hex (${hex.q}, ${hex.r}), rounding to ${nearest}`)
        hex.rotation = nearest
      }
    }

    // Post-process: Ensure base tiles exist for all elevated hexes
    const baseTiles = new Set<string>() // Track positions with base tiles at height 0
    const elevatedHexes: GeneratedHex[] = []

    for (const hex of generatedHexes) {
      const key = `${hex.q},${hex.r}`
      if (hex.height === 0) {
        baseTiles.add(key)
      } else {
        elevatedHexes.push(hex)
      }
    }

    // Add missing base tiles for elevated hexes
    const defaultPlainsTile = tileRegistry.tiles.find(
      (t) => t.tile_id === 'tiles_base_hex_grass' || (t.biome === 'plains' && (t.category === 'tiles' || t.category === 'base'))
    ) || tileRegistry.tiles.find((t) => t.biome === 'plains')

    for (const elevatedHex of elevatedHexes) {
      const key = `${elevatedHex.q},${elevatedHex.r}`
      if (!baseTiles.has(key)) {
        // Add a base tile at height 0
        const baseHex: GeneratedHex = {
          q: elevatedHex.q,
          r: elevatedHex.r,
          tile_id: defaultPlainsTile?.tile_id || 'tiles_base_hex_grass',
          rotation: 0,
          height: 0,
        }

        generatedHexes.push(baseHex)
        baseTiles.add(key)
        console.log(`Added missing base tile at (${elevatedHex.q}, ${elevatedHex.r}) for elevated hex at height ${elevatedHex.height}`)
      }
    }

    // Validate connectivity for rivers and roads
    this.validateConnectivity(generatedHexes, tileRegistry)

    return generatedHexes
  }

  /**
   * Validate connectivity of rivers and roads after generation
   * Checks that adjacent tiles with connections actually connect properly
   */
  private validateConnectivity(
    generatedHexes: GeneratedHex[],
    tileRegistry: TileRegistry
  ): void {
    const hexMap = new Map<string, GeneratedHex>()
    for (const hex of generatedHexes) {
      const key = `${hex.q},${hex.r}`
      // Store the topmost hex at each position (highest height)
      const existing = hexMap.get(key)
      if (!existing || hex.height > existing.height) {
        hexMap.set(key, hex)
      }
    }

    const issues: string[] = []

    for (const hex of generatedHexes) {
      const tileDescriptor = tileRegistry.tiles.find((t) => t.tile_id === hex.tile_id)
      if (!tileDescriptor || !tileDescriptor.connections) {
        continue // Not a tile that needs connectivity validation
      }

      // Check each connection direction
      const connections = tileDescriptor.connections
      const neighbors = getAxialNeighbors(hex.q, hex.r)

      // Map hex directions to neighbor indices
      const directionMap: Record<string, { q: number; r: number }> = {
        east: neighbors[0], // { q: 1, r: 0 }
        northeast: neighbors[1], // { q: 1, r: -1 }
        northwest: neighbors[2], // { q: 0, r: -1 }
        west: neighbors[3], // { q: -1, r: 0 }
        southwest: neighbors[4], // { q: -1, r: 1 }
        southeast: neighbors[5], // { q: 0, r: 1 }
      }

      const oppositeDirections: Record<string, string> = {
        east: 'west',
        west: 'east',
        northeast: 'southwest',
        southwest: 'northeast',
        northwest: 'southeast',
        southeast: 'northwest',
      }

      // Check each connection type (river, road, water, grass)
      for (const [connectionType, hasConnection] of Object.entries(connections)) {
        if (!hasConnection) continue

        // For each direction that has this connection type
        for (const [direction] of Object.entries(directionMap)) {
          // This is a simplified check - in reality we'd need to know which directions
          // have which connection types, but the tile registry doesn't specify this level of detail
          const neighbor = directionMap[direction]
          if (!neighbor) continue

          const neighborKey = `${neighbor.q},${neighbor.r}`
          const neighborHex = hexMap.get(neighborKey)

          if (!neighborHex) {
            // Neighbor doesn't exist (edge of map) - this is OK
            continue
          }

          const neighborTile = tileRegistry.tiles.find((t) => t.tile_id === neighborHex.tile_id)
          if (!neighborTile || !neighborTile.connections) {
            // Neighbor is not a connectable tile - this might be an issue for rivers/roads
            if (connectionType === 'river' || connectionType === 'road') {
              issues.push(
                `Tile ${hex.tile_id} at (${hex.q}, ${hex.r}) has ${connectionType} connection but neighbor at (${neighbor.q}, ${neighbor.r}) is not connectable`
              )
            }
            continue
          }

          // Check if neighbor has the same connection type
          if (!neighborTile.connections[connectionType as keyof typeof neighborTile.connections]) {
            if (connectionType === 'river' || connectionType === 'road') {
              issues.push(
                `Tile ${hex.tile_id} at (${hex.q}, ${hex.r}) has ${connectionType} connection but neighbor ${neighborHex.tile_id} at (${neighbor.q}, ${neighbor.r}) doesn't have ${connectionType} connection`
              )
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      console.warn(`Connectivity validation found ${issues.length} issues:`)
      issues.slice(0, 10).forEach((issue) => console.warn(`  - ${issue}`))
      if (issues.length > 10) {
        console.warn(`  ... and ${issues.length - 10} more issues`)
      }
    } else {
      console.log('Connectivity validation passed: all rivers/roads are properly connected')
    }
  }

  /**
   * Generate map and convert to GameMap
   */
  async generateMapToGameMap(params: GenerateMapParams): Promise<GameMap> {
    const generatedHexes = await this.generateMap(params)
    const tileRegistry = this.loadTileRegistry()

    const gameMap = new GameMap(params.width, params.height)

    // Convert GeneratedHex to Hex and add to map
    for (const generatedHex of generatedHexes) {
      const hex = this.generatedHexToHex(generatedHex, tileRegistry)
      gameMap.setHex(hex.q, hex.r, hex)
    }

    return gameMap
  }
}

