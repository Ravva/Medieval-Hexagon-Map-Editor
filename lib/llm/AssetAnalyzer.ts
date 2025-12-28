/**
 * AssetAnalyzer - Analyzes 3D assets (OBJ/MTL) to extract metadata for LLM
 *
 * Extracts:
 * - Geometric metadata from OBJ files (vertex count, bounding box, height)
 * - Material metadata from MTL files (colors, textures)
 * - Semantic information from file paths/names (biome, category, etc.)
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  analyzeTileConnections,
  getConnectionsFromFilename,
  combineConnections,
  type TileConnections,
} from './TileConnectionAnalyzer'

export interface OBJMetadata {
  vertexCount: number
  faceCount: number
  boundingBox: {
    min: [number, number, number]
    max: [number, number, number]
  }
  heightRange: number
  complexity: 'low' | 'medium' | 'high'
}

export interface MTLMetadata {
  materialName: string
  baseColor?: string // RGB hex
  hasTexture: boolean
  texturePath?: string
  materialType: 'stone' | 'grass' | 'water' | 'wood' | 'metal' | 'unknown'
}

export interface TileDescriptor {
  // Идентификация
  tile_id: string
  name: string

  // Пути к файлам
  obj_path: string
  mtl_path: string
  texture_path?: string

  // Геометрические свойства
  base_height: number
  can_rotate: boolean
  rotation_steps: number[]

  // Семантика
  biome: string
  category: string
  subcategory?: string

  // Игровые свойства
  tags: string[]
  walkable: boolean
  passable?: boolean
  height_modifier?: number

  // Визуальные характеристики
  visual_style: string
  color_palette?: string[]

  // Соединения (для дорог, рек, побережья, базовых тайлов)
  // Определяет тип соединения на каждой из 6 сторон для стыковки с соседними тайлами
  connections?: TileConnections

  // Метаданные для генерации
  rarity?: number
  preferred_neighbors?: string[]
  incompatible_neighbors?: string[]
}

export class AssetAnalyzer {
  private readonly assetsBasePath: string

  constructor(assetsBasePath: string = path.join(process.cwd(), 'assets', 'terrain')) {
    this.assetsBasePath = assetsBasePath
  }

  /**
   * Parse OBJ file to extract geometric metadata
   */
  parseOBJ(objPath: string): OBJMetadata {
    const content = fs.readFileSync(objPath, 'utf-8')
    const lines = content.split('\n')

    let vertexCount = 0
    let faceCount = 0
    const vertices: Array<[number, number, number]> = []

    // Parse vertices (v x y z)
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
            vertexCount++
          }
        }
      } else if (trimmed.startsWith('f ')) {
        faceCount++
      }
    }

    // Calculate bounding box
    if (vertices.length === 0) {
      return {
        vertexCount: 0,
        faceCount: 0,
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        heightRange: 0,
        complexity: 'low',
      }
    }

    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity

    for (const [x, y, z] of vertices) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }

    const heightRange = maxY - minY

    // Determine complexity based on vertex count
    let complexity: 'low' | 'medium' | 'high'
    if (vertexCount < 50) {
      complexity = 'low'
    } else if (vertexCount < 200) {
      complexity = 'medium'
    } else {
      complexity = 'high'
    }

    return {
      vertexCount,
      faceCount,
      boundingBox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      heightRange,
      complexity,
    }
  }

  /**
   * Parse MTL file to extract material metadata
   */
  parseMTL(mtlPath: string): MTLMetadata {
    const content = fs.readFileSync(mtlPath, 'utf-8')
    const lines = content.split('\n')

    let materialName = ''
    let kdR = 1
    let kdG = 1
    let kdB = 1
    let texturePath: string | undefined

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('newmtl ')) {
        materialName = trimmed.substring(7).trim()
      } else if (trimmed.startsWith('Kd ')) {
        // Diffuse color (RGB)
        const parts = trimmed.split(/\s+/)
        if (parts.length >= 4) {
          kdR = parseFloat(parts[1])
          kdG = parseFloat(parts[2])
          kdB = parseFloat(parts[3])
        }
      } else if (trimmed.startsWith('map_Kd ')) {
        // Texture path
        texturePath = trimmed.substring(7).trim()
      }
    }

    // Convert RGB to hex
    const baseColor = this.rgbToHex(Math.round(kdR * 255), Math.round(kdG * 255), Math.round(kdB * 255))

    // Determine material type from name or color (heuristic)
    const materialType = this.determineMaterialType(materialName, kdR, kdG, kdB)

    return {
      materialName,
      baseColor,
      hasTexture: !!texturePath,
      texturePath,
      materialType,
    }
  }

  /**
   * Extract semantic information from file path and name
   */
  extractSemantics(filePath: string, fileName: string): {
    category: string
    subcategory?: string
    biome: string
    tags: string[]
    walkable: boolean
    visualStyle: string
  } {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const pathParts = normalizedPath.split('/')

    // Extract category and subcategory from path
    // Example: assets/terrain/tiles/base/hex_grass.obj
    // -> category: tiles, subcategory: base
    const terrainIndex = pathParts.indexOf('terrain')
    const category = terrainIndex >= 0 && pathParts[terrainIndex + 1] ? pathParts[terrainIndex + 1] : 'unknown'
    const subcategory = terrainIndex >= 0 && pathParts[terrainIndex + 2] ? pathParts[terrainIndex + 2] : undefined

    // Extract biome and tags from filename
    const nameLower = fileName.toLowerCase()
    let biome = 'plains'
    const tags: string[] = []
    let walkable = true

    // Biome detection
    if (nameLower.includes('water') || nameLower.includes('river') || nameLower.includes('coast')) {
      biome = 'water'
      walkable = false
      tags.push('water', 'terrain_base')
    } else if (nameLower.includes('forest') || nameLower.includes('tree')) {
      biome = 'forest'
      tags.push('terrain_base', 'cover')
    } else if (nameLower.includes('mountain') || nameLower.includes('hill')) {
      biome = 'mountain'
      tags.push('terrain_base', 'height')
    } else if (nameLower.includes('grass') || nameLower.includes('plains')) {
      biome = 'plains'
      tags.push('terrain_base')
    } else if (nameLower.includes('road')) {
      biome = 'plains'
      tags.push('road', 'movement_bonus', 'walkable')
    } else {
      tags.push('terrain_base')
    }

    // Building detection
    if (category === 'buildings') {
      walkable = false
      tags.push('structure')
      if (nameLower.includes('castle') || nameLower.includes('fort')) {
        tags.push('defense', 'landmark')
      } else if (nameLower.includes('tower')) {
        tags.push('defense')
      }
    }

    // Decoration detection
    if (category === 'decoration') {
      walkable = true
      tags.push('decoration')
      if (subcategory === 'nature') {
        tags.push('nature', 'cover')
      }
    }

    // Visual style (always fantasy_medieval for this project)
    const visualStyle = 'fantasy_medieval'

    return {
      category,
      subcategory,
      biome,
      tags,
      walkable,
      visualStyle,
    }
  }

  /**
   * Generate tile_id from file path
   * Format: {category}_{subcategory}_{filename}
   * Example: tiles_base_hex_grass
   */
  generateTileId(filePath: string, fileName: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const pathParts = normalizedPath.split('/')

    const terrainIndex = pathParts.indexOf('terrain')
    const category = terrainIndex >= 0 && pathParts[terrainIndex + 1] ? pathParts[terrainIndex + 1] : 'unknown'
    const subcategory = terrainIndex >= 0 && pathParts[terrainIndex + 2] ? pathParts[terrainIndex + 2] : undefined

    const baseName = fileName.replace(/\.(obj|mtl)$/i, '')

    if (subcategory) {
      return `${category}_${subcategory}_${baseName}`
    }
    return `${category}_${baseName}`
  }

  /**
   * Analyze a single asset file pair (OBJ + MTL)
   */
  analyzeAsset(objPath: string, mtlPath: string): TileDescriptor {
    const objStats = fs.statSync(objPath)
    const mtlStats = fs.statSync(mtlPath)

    const objMetadata = this.parseOBJ(objPath)
    const mtlMetadata = this.parseMTL(mtlPath)

    const fileName = path.basename(objPath)
    const fileDir = path.dirname(objPath)
    const semantics = this.extractSemantics(fileDir, fileName)

    // Generate tile_id
    const tile_id = this.generateTileId(fileDir, fileName)

    // Generate human-readable name
    const name = fileName
      .replace(/\.obj$/i, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase())

    // Determine base height from OBJ metadata
    const base_height = objMetadata.boundingBox.min[1] >= -0.1 ? 0 : 1

    // All tiles can be rotated (6 steps: 0, 60, 120, 180, 240, 300 degrees)
    const rotation_steps = [0, 60, 120, 180, 240, 300]

    // Convert paths to web-accessible paths (relative to assets/terrain)
    // Example: assets/terrain/tiles/base/hex_grass.obj -> /assets/terrain/tiles/base/hex_grass.obj
    const assetsTerrainPath = path.join(process.cwd(), 'assets', 'terrain')
    const relativeObjPath = path.relative(assetsTerrainPath, objPath).replace(/\\/g, '/')
    const relativeMtlPath = path.relative(assetsTerrainPath, mtlPath).replace(/\\/g, '/')
    const obj_path = `/assets/terrain/${relativeObjPath}`
    const mtl_path = `/assets/terrain/${relativeMtlPath}`

    // Get texture path if available
    let texture_path: string | undefined
    if (mtlMetadata.texturePath) {
      const textureFile = path.join(fileDir, mtlMetadata.texturePath)
      if (fs.existsSync(textureFile)) {
        const relativeTexturePath = path.relative(assetsTerrainPath, textureFile).replace(/\\/g, '/')
        texture_path = `/assets/terrain/${relativeTexturePath}`
      }
    }

    // Analyze tile connections for rivers, roads, coast, and base tiles
    // Uses ONLY automatic methods: filename heuristics + geometry analysis
    let connections: TileConnections | undefined
    const needsConnections = semantics.category === 'tiles' &&
      (semantics.subcategory === 'rivers' ||
       semantics.subcategory === 'roads' ||
       semantics.subcategory === 'coast' ||
       semantics.subcategory === 'base')

    if (needsConnections) {
      try {
        // Determine tile type from subcategory and biome
        let tileType: 'river' | 'road' | 'coast' | 'base' | 'other' = 'other'

        if (semantics.subcategory === 'rivers') {
          tileType = 'river'
        } else if (semantics.subcategory === 'roads') {
          tileType = 'road'
        } else if (semantics.subcategory === 'coast') {
          tileType = 'coast'
        } else if (semantics.subcategory === 'base') {
          tileType = 'base'
        }

        // Priority: Filename heuristics (fast, reliable for known patterns) > Geometry analysis
        const filenameConnections = getConnectionsFromFilename(fileName, tileType, semantics.biome)
        const geometryConnections = analyzeTileConnections(objPath, mtlPath, tileType, semantics.biome)

        // Combine sources (filename takes precedence if available)
        const combined = combineConnections(geometryConnections, filenameConnections)

        // Only set connections if we found at least one connection
        if (Object.values(combined).some((v) => v !== undefined && v !== null)) {
          connections = combined
        }
      } catch (error) {
        console.warn(`Failed to analyze connections for ${objPath}:`, error)
      }
    }

    return {
      tile_id,
      name,
      obj_path,
      mtl_path,
      texture_path,
      base_height,
      can_rotate: true,
      rotation_steps,
      biome: semantics.biome,
      category: semantics.category,
      subcategory: semantics.subcategory,
      tags: semantics.tags,
      walkable: semantics.walkable,
      visual_style: semantics.visualStyle,
      connections,
    }
  }

  /**
   * Scan assets directory and analyze all OBJ files
   */
  scanAssets(): TileDescriptor[] {
    const tiles: TileDescriptor[] = []
    const assetsPath = this.assetsBasePath

    if (!fs.existsSync(assetsPath)) {
      console.warn(`Assets path does not exist: ${assetsPath}`)
      return tiles
    }

    // Recursively scan for OBJ files
    const scanDirectory = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          scanDirectory(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.obj')) {
          // Check if corresponding MTL file exists
          const mtlPath = fullPath.replace(/\.obj$/i, '.mtl')
          if (fs.existsSync(mtlPath)) {
            try {
              const tile = this.analyzeAsset(fullPath, mtlPath)
              tiles.push(tile)
            } catch (error) {
              console.error(`Error analyzing asset ${fullPath}:`, error)
            }
          } else {
            console.warn(`MTL file not found for ${fullPath}`)
          }
        }
      }
    }

    scanDirectory(assetsPath)
    return tiles
  }

  /**
   * Helper: Convert RGB to hex
   */
  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
  }

  /**
   * Helper: Determine material type from name or color
   */
  private determineMaterialType(
    materialName: string,
    r: number,
    g: number,
    b: number
  ): 'stone' | 'grass' | 'water' | 'wood' | 'metal' | 'unknown' {
    const nameLower = materialName.toLowerCase()

    if (nameLower.includes('water') || (r < 0.3 && g < 0.5 && b > 0.5)) {
      return 'water'
    }
    if (nameLower.includes('grass') || (r < 0.5 && g > 0.6 && b < 0.5)) {
      return 'grass'
    }
    if (nameLower.includes('stone') || nameLower.includes('rock') || (r > 0.5 && g > 0.4 && b < 0.4)) {
      return 'stone'
    }
    if (nameLower.includes('wood') || nameLower.includes('tree')) {
      return 'wood'
    }
    if (nameLower.includes('metal') || (r > 0.7 && g > 0.7 && b > 0.7)) {
      return 'metal'
    }

    return 'unknown'
  }
}

