/**
 * TextureAnalyzer - Analyzes texture colors to determine terrain types on hex edges
 *
 * For determining tile connections, analyzes texture colors at hex boundaries
 * to identify terrain types (grass, water, coast, road, etc.)
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Terrain type based on color analysis
 */
export type TerrainType = 'grass' | 'water' | 'coast' | 'road' | 'unknown'

/**
 * Analyze texture file to determine terrain type at specific coordinates
 *
 * @param texturePath - Path to texture image file
 * @param x - X coordinate (0-1, normalized)
 * @param y - Y coordinate (0-1, normalized)
 * @returns Terrain type based on color
 */
export function analyzeTextureColor(
  texturePath: string,
  x: number,
  y: number
): TerrainType {
  // For now, return unknown - full implementation would require image processing
  // This is a placeholder for future implementation with image libraries
  return 'unknown'
}

/**
 * Determine terrain type from RGB color values
 *
 * Логика определения:
 * - Water: синий доминирует, низкие R/G
 * - Grass: зеленый доминирует
 * - Road: трава + песок (коричневый/бежевый, но БЕЗ синего компонента)
 * - Coast: смесь воды + песка + травы (есть синий И коричневый) ИЛИ трава + песок (waterless, но отличается от дороги наличием больше зеленого)
 *
 * @param r - Red component (0-255)
 * @param g - Green component (0-255)
 * @param b - Blue component (0-255)
 * @returns Terrain type
 */
export function determineTerrainTypeFromColor(r: number, g: number, b: number): TerrainType {
  // Normalize to 0-1
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255

  // Water detection: blue dominant, low red/green
  if (bNorm > 0.5 && rNorm < 0.4 && gNorm < 0.4) {
    return 'water'
  }

  // Coast detection: смесь воды, песка и травы
  // Признаки: есть синий компонент (вода) И коричневый/бежевый (песок) И зеленый (трава)
  // ИЛИ: трава + песок (waterless) - больше зеленого чем в дороге
  const hasWater = bNorm > 0.25 // Есть синий компонент (вода)
  const hasSand = Math.abs(rNorm - gNorm) < 0.15 && rNorm > 0.4 && rNorm < 0.8 // Коричневый/бежевый (песок)
  const hasGrass = gNorm > 0.35 // Есть зеленый (трава)

  // Coast: (вода + песок + трава) ИЛИ (трава + песок с большим количеством зеленого)
  if (hasWater && hasSand && hasGrass) {
    return 'coast' // Coast с водой
  }
  if (hasSand && hasGrass && gNorm > 0.5 && bNorm < 0.2) {
    return 'coast' // Coast waterless (трава + песок, но больше зеленого чем в дороге)
  }

  // Road detection: трава + песок (коричневый/бежевый), но БЕЗ синего компонента
  // Дорога: коричневый/бежевый (песок) с небольшим количеством зеленого (трава), но без синего
  if (hasSand && hasGrass && bNorm < 0.25 && gNorm < 0.55) {
    return 'road'
  }

  // Grass detection: зеленый доминирует, без синего и коричневого
  if (gNorm > 0.4 && gNorm > rNorm && gNorm > bNorm && bNorm < 0.3 && !hasSand) {
    return 'grass'
  }

  return 'unknown'
}

/**
 * Get terrain type from MTL file and texture path
 *
 * @param mtlPath - Path to MTL file
 * @param objDir - Directory containing OBJ file (for relative texture paths)
 * @returns Terrain type or null if cannot determine
 */
export function getTerrainTypeFromMTL(mtlPath: string, objDir: string): TerrainType | null {
  if (!fs.existsSync(mtlPath)) {
    return null
  }

  const content = fs.readFileSync(mtlPath, 'utf-8')
  const lines = content.split('\n')

  let kdR = 1
  let kdG = 1
  let kdB = 1
  let texturePath: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Kd ')) {
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

  // Convert to 0-255 range
  const r = Math.round(kdR * 255)
  const g = Math.round(kdG * 255)
  const b = Math.round(kdB * 255)

  // Determine terrain type from material color
  return determineTerrainTypeFromColor(r, g, b)
}

