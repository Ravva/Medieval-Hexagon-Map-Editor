// Stub for GitHub Pages deployment
export type ConnectionType = 'river' | 'road' | 'water' | 'grass' | 'coast' | 'none' | 'unknown'

export interface TileConnections {
  [key: string]: boolean | ConnectionType | string | undefined
}
