/**
 * MapSerializer - Serialization and deserialization for map files
 * Version 2.0: Uses axial coordinates (q, r) for optimal LLM compatibility
 * Supports migration from version 1.0 (offset coordinates)
 */

import { Map as GameMap } from './Map'
import { Hex, TERRAIN_TYPES, type TerrainType } from './Hex'
import { offsetToAxial, axialToOffset } from './HexCoordinateConverter'

export interface ModelData {
  obj: string
  mtl: string
  name: string
}

// Version 2.0: Axial coordinates
export interface HexData {
  q: number
  r: number
  terrain: TerrainType
  height: number
  rotation?: number
  modelData?: ModelData
  hasRiver?: boolean
}

// Version 1.0: Legacy offset coordinates (for migration)
export interface HexDataV1 {
  x: number
  y: number
  terrain: TerrainType
  height: number
  rotation?: number
  modelData?: ModelData
  hasRiver?: boolean
}

export interface BuildingData {
  q: number
  r: number
  height?: number
  modelData: ModelData
}

// Version 1.0: Legacy building data (for migration)
export interface BuildingDataV1 {
  x: number
  y: number
  height?: number
  modelData: ModelData
}

export interface MapFileFormat {
  version: string
  format: 'warlords-map'
  metadata: {
    name?: string
    description?: string
    createdAt: number
    modifiedAt: number
    mapSize: 'small' | 'medium' | 'large' | 'very-large'
  }
  map: {
    width: number
    height: number
  }
  // Optimized: only store non-empty positions
  // Key format: "q,r" -> array of hexes at that position (sorted by height)
  hexes: Record<string, HexData[]>
  // Buildings stored separately (optional, for future use)
  buildings?: BuildingData[]
}

// Version 1.0: Legacy format (for migration)
export interface MapFileFormatV1 {
  version: string
  format: 'warlords-map'
  metadata: {
    name?: string
    description?: string
    createdAt: number
    modifiedAt: number
    mapSize: 'small' | 'medium' | 'large' | 'very-large'
  }
  map: {
    width: number
    height: number
  }
  hexes: Record<string, HexDataV1[]>
  buildings?: BuildingDataV1[]
}

/**
 * Serialize map to optimized JSON format (Version 2.0)
 *
 * Optimization strategies:
 * 1. Only store non-empty hex positions (sparse array)
 * 2. Store hex stacks as arrays (multiple hexes per position)
 * 3. Use short keys ("q,r" format)
 * 4. Omit default values (rotation=0, height=0, etc.)
 * 5. Buildings stored separately for clarity
 */
export class MapSerializer {
  private static readonly CURRENT_VERSION = '2.0'
  private static readonly FORMAT_ID = 'warlords-map'

  /**
   * Serialize map to JSON string
   */
  static serialize(
    map: GameMap,
    mapSize: 'small' | 'medium' | 'large' | 'very-large',
    options: {
      name?: string
      description?: string
      includeBuildings?: boolean
      buildingData?: Map<string, { obj: string; mtl: string; name: string }>
    } = {}
  ): string {
    const now = Date.now()
    const hexes: Record<string, HexData[]> = {}

    // Serialize all hex positions (only non-empty stacks)
    // Iterate through all hexes in the Map
    for (const [key, hexStack] of map.hexes.entries()) {
      if (hexStack.length > 0) {
        hexes[key] = hexStack.map(hex => {
          const hexData: HexData = {
            q: hex.q,
            r: hex.r,
            terrain: hex.terrain,
            height: hex.height ?? 0,
          }

          // Only include non-default values to save space
          if (hex.rotation && hex.rotation !== 0) {
            hexData.rotation = hex.rotation
          }

          if (hex.modelData) {
            hexData.modelData = {
              obj: hex.modelData.obj,
              mtl: hex.modelData.mtl,
              name: hex.modelData.name,
            }
          }

          if (hex.hasRiver) {
            hexData.hasRiver = true
          }

          return hexData
        })
      }
    }

    // Serialize buildings if provided
    const buildings: BuildingData[] = []
    if (options.includeBuildings && options.buildingData) {
      for (const [key, modelData] of options.buildingData.entries()) {
        // Parse key format: "q,r" or "q,r_height"
        const [posPart, heightPart] = key.split('_')
        const [q, r] = posPart.split(',').map(Number)
        const height = heightPart ? Number(heightPart) : undefined

        buildings.push({
          q,
          r,
          height,
          modelData: {
            obj: modelData.obj,
            mtl: modelData.mtl,
            name: modelData.name,
          },
        })
      }
    }

    const mapFile: MapFileFormat = {
      version: this.CURRENT_VERSION,
      format: this.FORMAT_ID,
      metadata: {
        name: options.name,
        description: options.description,
        createdAt: now,
        modifiedAt: now,
        mapSize,
      },
      map: {
        width: map.width,
        height: map.height,
      },
      hexes,
      ...(buildings.length > 0 && { buildings }),
    }

    return JSON.stringify(mapFile, null, 2)
  }

  /**
   * Deserialize JSON string to map
   * Supports migration from version 1.0 (offset coordinates) to 2.0 (axial coordinates)
   */
  static deserialize(jsonString: string): {
    map: GameMap
    mapSize: 'small' | 'medium' | 'large' | 'very-large'
    buildings?: BuildingData[]
    metadata?: MapFileFormat['metadata']
  } {
    const mapFile: MapFileFormat | MapFileFormatV1 = JSON.parse(jsonString)

    // Validate format
    if (mapFile.format !== this.FORMAT_ID) {
      throw new Error(`Invalid map format: expected ${this.FORMAT_ID}, got ${mapFile.format}`)
    }

    // Version compatibility check and migration
    const isV1 = mapFile.version === '1.0'
    if (isV1) {
      console.warn(
        `Map version 1.0 detected. Migrating to version ${this.CURRENT_VERSION}...`
      )
    } else if (mapFile.version !== this.CURRENT_VERSION) {
      console.warn(
        `Map version mismatch: file version ${mapFile.version}, current version ${this.CURRENT_VERSION}. Attempting to load anyway...`
      )
    }

    // Create map
    const map = new GameMap(mapFile.map.width, mapFile.map.height)

    // Deserialize hexes
    if (isV1) {
      // Migrate from version 1.0 (offset coordinates) to 2.0 (axial coordinates)
      const v1File = mapFile as MapFileFormatV1
      for (const [key, hexStack] of Object.entries(v1File.hexes)) {
        const [x, y] = key.split(',').map(Number)

        for (const hexData of hexStack) {
          // Convert offset to axial
          const { q, r } = offsetToAxial(hexData.x, hexData.y)
          const hex = new Hex(q, r, hexData.terrain)
          hex.height = hexData.height ?? 0
          hex.rotation = hexData.rotation ?? 0

          if (hexData.modelData) {
            hex.modelData = {
              obj: hexData.modelData.obj,
              mtl: hexData.modelData.mtl,
              name: hexData.modelData.name,
            }
          }

          if (hexData.hasRiver) {
            hex.hasRiver = true
          }

          map.setHex(q, r, hex)
        }
      }
    } else {
      // Version 2.0: Direct axial coordinates
      const v2File = mapFile as MapFileFormat
      for (const [key, hexStack] of Object.entries(v2File.hexes)) {
        const [q, r] = key.split(',').map(Number)

        for (const hexData of hexStack) {
          const hex = new Hex(hexData.q, hexData.r, hexData.terrain)
          hex.height = hexData.height ?? 0
          hex.rotation = hexData.rotation ?? 0

          if (hexData.modelData) {
            hex.modelData = {
              obj: hexData.modelData.obj,
              mtl: hexData.modelData.mtl,
              name: hexData.modelData.name,
            }
          }

          if (hexData.hasRiver) {
            hex.hasRiver = true
          }

          map.setHex(q, r, hex)
        }
      }
    }

    // Deserialize buildings (with migration if needed)
    let buildings: BuildingData[] | undefined
    if (mapFile.buildings) {
      if (isV1) {
        // Migrate buildings from v1 to v2
        const v1Buildings = (mapFile as MapFileFormatV1).buildings || []
        buildings = v1Buildings.map(building => {
          const { q, r } = offsetToAxial(building.x, building.y)
          return {
            q,
            r,
            height: building.height,
            modelData: building.modelData,
          }
        })
      } else {
        buildings = (mapFile as MapFileFormat).buildings
      }
    }

    return {
      map,
      mapSize: mapFile.metadata.mapSize,
      buildings,
      metadata: mapFile.metadata,
    }
  }

  /**
   * Get file size estimate in bytes
   */
  static estimateSize(map: GameMap): number {
    // Rough estimate: ~200 bytes per hex (with model data)
    let hexCount = 0
    for (const hexStack of map.hexes.values()) {
      hexCount += hexStack.length
    }
    return hexCount * 200 + 500 // Base overhead ~500 bytes
  }

  /**
   * Validate map file structure
   */
  static validate(mapFile: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!mapFile || typeof mapFile !== 'object') {
      return { valid: false, errors: ['Map file is not an object'] }
    }

    const file = mapFile as Partial<MapFileFormat | MapFileFormatV1>

    if (file.format !== this.FORMAT_ID) {
      errors.push(`Invalid format: expected ${this.FORMAT_ID}`)
    }

    if (!file.version) {
      errors.push('Missing version field')
    }

    if (!file.map) {
      errors.push('Missing map field')
    } else {
      if (typeof file.map.width !== 'number' || file.map.width <= 0) {
        errors.push('Invalid map width')
      }
      if (typeof file.map.height !== 'number' || file.map.height <= 0) {
        errors.push('Invalid map height')
      }
    }

    if (!file.hexes || typeof file.hexes !== 'object') {
      errors.push('Missing or invalid hexes field')
    }

    if (!file.metadata) {
      errors.push('Missing metadata field')
    } else {
      if (!file.metadata.mapSize) {
        errors.push('Missing mapSize in metadata')
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}
