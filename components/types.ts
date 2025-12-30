import { type TerrainType } from '@/lib/game/Hex'

export type EditMode = 'terrain' | 'building'

export type MapSize = 'tiny' | 'small' | 'medium' | 'large' | 'very-large'

export const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  'tiny': { label: 'Tiny', width: 10, height: 10 },
  'small': { label: 'Small', width: 25, height: 25 },
  'medium': { label: 'Medium', width: 50, height: 50 },
  'large': { label: 'Large', width: 75, height: 75 },
  'very-large': { label: 'Very large', width: 100, height: 100 },
}

export interface AssetModel {
  name: string
  obj: string
  mtl: string
}

export interface AssetFolder {
  name: string
  models: AssetModel[]
}

export interface AssetCategory {
  name: string
  folders: AssetFolder[]
}

export interface ClipboardData {
  hexes: Array<{
    q: number
    r: number
    terrain: TerrainType
    height: number
    rotation?: number
    modelData?: { obj: string; mtl: string; name: string }
    hasRiver?: boolean
  }>
  sourceHeight: number
  globalLevel: number
  // Для обратной совместимости с одиночным выделением
  hex?: {
    q: number
    r: number
    terrain: TerrainType
    height: number
    rotation?: number
    modelData?: { obj: string; mtl: string; name: string }
    hasRiver?: boolean
  }
}

export interface HistoryState {
  map: string // JSON сериализация карты
  timestamp: number
}

