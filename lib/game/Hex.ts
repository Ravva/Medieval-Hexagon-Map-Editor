/**
 * Hex - Represents a single hexagon on the game map
 * Uses axial coordinates (q, r) for optimal LLM compatibility
 */

import { axialDistance } from './HexCoordinateConverter'

export const TERRAIN_TYPES = {
  PLAINS: 'PLAINS',
  FOREST: 'FOREST',
  MOUNTAIN: 'MOUNTAIN',
  WATER: 'WATER',
  ROAD: 'ROAD',
} as const

export type TerrainType = (typeof TERRAIN_TYPES)[keyof typeof TERRAIN_TYPES]

export const TERRAIN_CONFIG = {
  [TERRAIN_TYPES.PLAINS]: {
    movementCost: 1,
    defenseBonus: 0,
    passable: true,
    name: 'Plains',
    color: '#90EE90',
  },
  [TERRAIN_TYPES.FOREST]: {
    movementCost: 2,
    defenseBonus: 1,
    passable: true,
    name: 'Forest',
    color: '#228B22',
  },
  [TERRAIN_TYPES.MOUNTAIN]: {
    movementCost: 3,
    defenseBonus: 2,
    passable: true,
    name: 'Mountain',
    color: '#8B4513',
  },
  [TERRAIN_TYPES.WATER]: {
    movementCost: 999,
    defenseBonus: 0,
    passable: false,
    name: 'Water',
    color: '#4169E1',
  },
  [TERRAIN_TYPES.ROAD]: {
    movementCost: 0.5,
    defenseBonus: 0,
    passable: true,
    name: 'Road',
    color: '#D2B48C',
  },
}

export class Hex {
  q: number // Axial Q coordinate
  r: number // Axial R coordinate
  terrain: TerrainType
  unit: unknown = null
  city: unknown = null
  hasRiver: boolean = false
  rotation: number = 0 // In radians
  height: number = 0 // Level 0-4 (total 5 levels)
  modelData?: { obj: string; mtl: string; name: string }

  constructor(q: number, r: number, terrain: TerrainType = TERRAIN_TYPES.PLAINS) {
    this.q = q
    this.r = r
    this.terrain = terrain

    if (!TERRAIN_CONFIG[terrain]) {
      throw new Error(`Invalid terrain type: ${terrain}`)
    }
  }

  /**
   * Calculate distance to another hex in axial coordinates
   * Uses the correct hexagonal distance formula
   */
  distanceTo(otherHex: Hex): number {
    return axialDistance({ q: this.q, r: this.r }, { q: otherHex.q, r: otherHex.r })
  }

  getMovementCost(_unit: unknown = null): number {
    const config = TERRAIN_CONFIG[this.terrain]
    if (!config) {
      throw new Error(`Unknown terrain type: ${this.terrain}`)
    }
    return config.movementCost
  }

  getDefenseBonus(): number {
    const config = TERRAIN_CONFIG[this.terrain]
    if (!config) {
      throw new Error(`Unknown terrain type: ${this.terrain}`)
    }
    return config.defenseBonus
  }

  getTerrainName(): string {
    const config = TERRAIN_CONFIG[this.terrain]
    return config ? config.name : 'Unknown'
  }

  getTerrainColor(): string {
    const config = TERRAIN_CONFIG[this.terrain]
    return config ? config.color : '#FFFFFF'
  }
}
