/**
 * MapGenerator - Generates hex maps using LLM (Gemini API)
 *
 * Uses tile registry and LLM to generate realistic hex-based tactical maps
 */

import { LLMClient } from './LLMClient'
import { Map as GameMap } from '../game/Map'
import { Hex, TERRAIN_TYPES, type TerrainType } from '../game/Hex'
import { getAxialNeighbors } from '../game/HexCoordinateConverter'
import { promptManager } from './PromptManager'
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

    // Use PromptManager for unified prompt generation
    const { systemMessage, userPrompt: baseUserPrompt } = promptManager.getPrompts({
      width,
      height,
      prompt: userPrompt,
      biome: primaryBiome
    })

    // Add tile registry to the prompt
    const promptText = `${systemMessage}

TILE REGISTRY (use tile_id values from here):
${JSON.stringify(compactTiles, null, 2)}

${baseUserPrompt}`

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

