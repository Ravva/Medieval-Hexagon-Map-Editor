// Stub for GitHub Pages deployment
export interface TileDescriptor {
  tile_id: string
  name: string
  obj_path: string
  mtl_path: string
  texture_path?: string
  biome: string
  category: string
  subcategory?: string
  base_height: number
  can_rotate: boolean
  connections?: any
}

export class AssetAnalyzer {
  // Stub implementation
  scanAssets(): TileDescriptor[] {
    return []
  }
}
