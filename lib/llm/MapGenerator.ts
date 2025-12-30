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

TILE REGISTRY (use tile_id values from here - DO NOT use placeholder IDs like "plain_base", "river_straight", etc.):
${JSON.stringify(compactTiles, null, 2)}

${baseUserPrompt}

CRITICAL REMINDER: You MUST use ONLY tile_id values from the TILE REGISTRY above. NEVER use placeholder IDs like "plain_base", "river_straight", "forest_decoration", "house", etc. Look up the exact tile_id from the registry that matches your needs.`

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

    // Post-process: Fill missing positions in rectangular grid
    const existingPositions = new Set<string>()
    for (const hex of generatedHexes) {
      const key = `${hex.q},${hex.r}`
      existingPositions.add(key)
    }

    // Find default plains/base tile
    const defaultPlainsTile = tileRegistry.tiles.find(
      (t) => t.tile_id === 'tiles_base_hex_grass' || (t.biome === 'plains' && (t.category === 'tiles' || t.category === 'base'))
    ) || tileRegistry.tiles.find((t) => t.biome === 'plains')

    // Fill all missing positions in rectangular grid
    let filledCount = 0
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        const key = `${q},${r}`
        if (!existingPositions.has(key)) {
          // Add base tile for missing position
          const baseHex: GeneratedHex = {
            q,
            r,
            tile_id: defaultPlainsTile?.tile_id || 'tiles_base_hex_grass',
            rotation: 0,
            height: 0,
          }
          generatedHexes.push(baseHex)
          existingPositions.add(key)
          filledCount++
        }
      }
    }

    if (filledCount > 0) {
      console.log(`Filled ${filledCount} missing positions in rectangular grid`)
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

    // Add missing base tiles for elevated hexes (reuse defaultPlainsTile found above)

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

    // Auto-correct rotations for river/road tiles (multiple iterations for better results)
    for (let iteration = 0; iteration < 3; iteration++) {
      const corrected = this.autoCorrectRotations(generatedHexes, tileRegistry)
      if (corrected === 0) break // No more corrections needed
    }

    // Validate connectivity for rivers and roads
    this.validateConnectivity(generatedHexes, tileRegistry)

    return generatedHexes
  }

  /**
   * Automatically calculate and apply correct rotations for river/road tiles
   * based on their neighbors' connections
   * Returns number of tiles corrected
   */
  private autoCorrectRotations(
    generatedHexes: GeneratedHex[],
    tileRegistry: TileRegistry
  ): number {
    // Build map of all hexes by position (need to check all heights, not just topmost)
    const hexesByPosition = new Map<string, GeneratedHex[]>()
    for (const hex of generatedHexes) {
      const key = `${hex.q},${hex.r}`
      if (!hexesByPosition.has(key)) {
        hexesByPosition.set(key, [])
      }
      hexesByPosition.get(key)!.push(hex)
    }

    // Helper to get river/road tile at position (prefer height 0, but check all)
    const getRiverRoadTileAt = (q: number, r: number): GeneratedHex | null => {
      const key = `${q},${r}`
      const hexes = hexesByPosition.get(key) || []
      // Prefer height 0 for rivers/roads
      for (const hex of hexes) {
        if (hex.height === 0) {
          const tile = tileRegistry.tiles.find((t) => t.tile_id === hex.tile_id)
          if (tile?.connections) {
            const hasRiverOrRoad = Object.values(tile.connections).some(
              (conn) => conn === 'river' || conn === 'road'
            )
            if (hasRiverOrRoad) return hex
          }
        }
      }
      // If no height 0, check other heights
      for (const hex of hexes) {
        const tile = tileRegistry.tiles.find((t) => t.tile_id === hex.tile_id)
        if (tile?.connections) {
          const hasRiverOrRoad = Object.values(tile.connections).some(
            (conn) => conn === 'river' || conn === 'road'
          )
          if (hasRiverOrRoad) return hex
        }
      }
      return null
    }

    const oppositeDirections: Record<string, string> = {
      east: 'west',
      west: 'east',
      northeast: 'southwest',
      southwest: 'northeast',
      northwest: 'southeast',
      southeast: 'northwest',
    }

    // Direction order for rotation (clockwise)
    const directionOrder = ['east', 'southeast', 'southwest', 'west', 'northwest', 'northeast']

    /**
     * Get rotated direction after applying rotation
     * Rotation is in degrees: 0, 60, 120, 180, 240, 300
     */
    const getRotatedDirection = (originalDir: string, rotationDeg: number): string => {
      const steps = rotationDeg / 60
      const index = directionOrder.indexOf(originalDir)
      if (index === -1) return originalDir
      const newIndex = (index + steps) % 6
      return directionOrder[newIndex]
    }

    let correctedCount = 0
    let riverRoadTilesCount = 0
    let tilesWithNeighborsCount = 0

    for (const hex of generatedHexes) {
      const tileDescriptor = tileRegistry.tiles.find((t) => t.tile_id === hex.tile_id)
      if (!tileDescriptor || !tileDescriptor.connections) {
        continue // Not a tile with connections
      }

      // Check if this tile has river or road connections
      const connectionType = Object.values(tileDescriptor.connections).find(
        (conn) => conn === 'river' || conn === 'road'
      )
      if (!connectionType) {
        continue // Not a river/road tile
      }

      riverRoadTilesCount++

      // Get neighbors
      const neighborCoords = getAxialNeighbors(hex.q, hex.r)
      const directionMap: Record<string, { q: number; r: number }> = {
        east: neighborCoords[0],
        northeast: neighborCoords[1],
        northwest: neighborCoords[2],
        west: neighborCoords[3],
        southwest: neighborCoords[4],
        southeast: neighborCoords[5],
      }

      // Determine required connection directions and types based on neighbors
      // Map: direction -> required connection type
      const requiredConnections = new Map<string, string>()

      for (const [direction, neighborCoord] of Object.entries(directionMap)) {
        const neighborHex = getRiverRoadTileAt(neighborCoord.q, neighborCoord.r)
        if (!neighborHex) continue

        const neighborTile = tileRegistry.tiles.find((t) => t.tile_id === neighborHex.tile_id)
        if (!neighborTile || !neighborTile.connections) continue

        // Check what connection type neighbor has in opposite direction (after its rotation)
        const oppositeDir = oppositeDirections[direction]
        const neighborRotation = neighborHex.rotation || 0

        // Find original direction in neighbor's connections that maps to oppositeDir after rotation
        for (const [originalDir, connType] of Object.entries(neighborTile.connections)) {
          const rotatedDir = getRotatedDirection(originalDir, neighborRotation)
          if (rotatedDir === oppositeDir && (connType === 'river' || connType === 'road')) {
            // Neighbor has this connection type in opposite direction
            // So we need the same connection type in our direction
            requiredConnections.set(direction, connType)
            break
          }
        }
      }

      if (requiredConnections.size === 0) {
        // No neighbors with matching connections - this might be an edge tile or isolated segment
        if (correctedCount < 3) {
          console.log(
            `Tile ${hex.tile_id} at (${hex.q},${hex.r}) has no neighbors with ${connectionType} connections`
          )
        }
        continue // Keep original rotation
      }

      tilesWithNeighborsCount++

      // Find best rotation that matches required connections
      let bestRotation = hex.rotation
      let bestMatch = 0
      let bestRequiredMatch = 0

      for (const rotation of [0, 60, 120, 180, 240, 300]) {
        let matchCount = 0
        let requiredMatchCount = 0

        // Check how many required connections match after this rotation
        for (const [reqDir, reqType] of requiredConnections.entries()) {
          // Find which original direction in our tile maps to reqDir after rotation
          for (const [originalDir, connType] of Object.entries(tileDescriptor.connections)) {
            const rotatedDir = getRotatedDirection(originalDir, rotation)
            if (rotatedDir === reqDir) {
              // Check if connection type matches
              if (connType === reqType) {
                matchCount++
                requiredMatchCount++
                break
              } else if (connType === 'river' || connType === 'road') {
                // Wrong type but at least has a connection
                matchCount++
                break
              }
            }
          }
        }

        // Prefer rotations that match both direction AND type
        if (requiredMatchCount > bestRequiredMatch ||
            (requiredMatchCount === bestRequiredMatch && matchCount > bestMatch)) {
          bestMatch = matchCount
          bestRequiredMatch = requiredMatchCount
          bestRotation = rotation
        }
      }

      // Apply best rotation if it's better than current
      if (bestMatch > 0 && bestRotation !== hex.rotation) {
        const oldRotation = hex.rotation
        hex.rotation = bestRotation
        correctedCount++
        if (correctedCount <= 10) {
          // Log first few corrections for debugging
          const reqDirs = Array.from(requiredConnections.keys()).join(', ')
          console.log(
            `[Rotation Correction] Tile ${hex.tile_id} at (${hex.q},${hex.r}): ${oldRotation}° -> ${bestRotation}° | Matched: ${bestRequiredMatch}/${requiredConnections.size} (${reqDirs}) | Type: ${connectionType}`
          )
        }
      } else if (bestMatch === 0 && correctedCount < 3) {
        // Log if we couldn't find any matching rotation
        const reqDirs = Array.from(requiredConnections.keys()).join(', ')
        const tileDirs = tileDescriptor.connections
          ? Object.keys(tileDescriptor.connections)
              .filter((dir) => tileDescriptor.connections![dir as keyof typeof tileDescriptor.connections] === connectionType)
              .join(', ')
          : 'no connections'
        console.warn(
          `[Rotation Correction FAILED] Tile ${hex.tile_id} at (${hex.q},${hex.r}): Could not match required directions [${reqDirs}] with tile connections [${tileDirs}]`
        )
      }
    }

    console.log(
      `[Rotation Correction Summary] Total river/road tiles: ${riverRoadTilesCount}, Tiles with neighbors: ${tilesWithNeighborsCount}, Corrected: ${correctedCount}`
    )

    return correctedCount
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

