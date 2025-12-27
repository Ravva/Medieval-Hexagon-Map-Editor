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
    const compactTiles = tileRegistry.tiles.map((tile) => ({
      tile_id: tile.tile_id,
      biome: tile.biome,
      category: tile.category,
      walkable: tile.walkable,
      tags: tile.tags,
    }))

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

RIVER CONNECTIVITY - CRITICAL:
- Rivers MUST form continuous, connected paths
- River tiles must be placed so they connect to adjacent river tiles
- Each river tile has 6 sides (hexagonal). Use rotation (0, 60, 120, 180, 240, 300) to align the river's flow direction
- If a river tile connects to a neighbor at direction X, the neighbor must connect back at direction (X + 180) % 360
- River tiles should form a continuous network without gaps or disconnected segments
- Always use height 0 for all river tiles

TILE PLACEMENT RULES:
1. Match biome to tile_id (use tiles with matching biome property from the registry)
2. ALWAYS place a base tile (height 0) before placing elevated features (height > 0)
3. For each position with elevated features, generate TWO hexes: base at height 0, feature at target height
4. Ensure walkable paths between important areas
5. Roads/rivers MUST form connected networks with proper rotation alignment
6. Buildings/structures must be placed on flat terrain (height 0-1) with base tile at height 0
7. Rotation must be one of: 0, 60, 120, 180, 240, or 300 degrees
8. For rivers: Rotate tiles to create continuous flow - adjacent river tiles must connect properly

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
    const tileRegistry = this.loadTileRegistry()
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

    return generatedHexes
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

