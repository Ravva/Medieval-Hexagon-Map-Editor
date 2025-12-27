/**
 * HexCoordinateConverter - Utility class for converting between different hex coordinate systems
 *
 * Supports:
 * - Axial coordinates (q, r) - primary system for internal logic
 * - Odd-R Offset coordinates (x, y) - legacy system for migration
 * - Pixel/Screen coordinates - for rendering
 */

/**
 * Convert odd-r offset coordinates to axial coordinates
 *
 * @param x - Column in odd-r offset system
 * @param y - Row in odd-r offset system
 * @returns Axial coordinates {q, r}
 */
export function offsetToAxial(x: number, y: number): { q: number; r: number } {
  const q = x
  const r = y - (x - (x & 1)) / 2
  return { q, r }
}

/**
 * Convert axial coordinates to odd-r offset coordinates
 *
 * @param q - Q coordinate in axial system
 * @param r - R coordinate in axial system
 * @returns Odd-r offset coordinates {x, y}
 */
export function axialToOffset(q: number, r: number): { x: number; y: number } {
  const x = q
  const y = r + (q - (q & 1)) / 2
  return { x, y }
}

/**
 * Convert axial coordinates to pixel/screen coordinates for flat-topped hexagons
 *
 * This matches the current rendering system used in MapEditor.tsx
 * which uses scale = 3.5, inner radius r = 1.0, outer radius R = 2/√3
 *
 * @param q - Q coordinate in axial system
 * @param r - R coordinate in axial system
 * @param hexSize - Size of hexagon (default: 3.5, matching current scale)
 * @returns Pixel coordinates {x, y}
 */
export function axialToPixel(
  q: number,
  r: number,
  hexSize: number = 3.5
): { x: number; y: number } {
  // For flat-topped hexagons:
  // Horizontal spacing: √3 * hexSize
  // Vertical spacing: 3/2 * hexSize
  const x = hexSize * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r)
  const y = hexSize * ((3 / 2) * r)
  return { x, y }
}

/**
 * Convert pixel/screen coordinates to axial coordinates (for flat-topped hexagons)
 *
 * @param pixelX - X coordinate in pixels
 * @param pixelY - Y coordinate in pixels
 * @param hexSize - Size of hexagon (default: 3.5, matching current scale)
 * @returns Axial coordinates {q, r}
 */
export function pixelToAxial(
  pixelX: number,
  pixelY: number,
  hexSize: number = 3.5
): { q: number; r: number } {
  // Inverse of axialToPixel
  // From: x = hexSize * (√3 * q + √3/2 * r)
  //       y = hexSize * (3/2 * r)
  //
  // Solve for q and r:
  // r = (2/3) * (y / hexSize)
  // q = (x / hexSize - √3/2 * r) / √3
  //   = (x / hexSize) / √3 - r/2

  const r = (2 / 3) * (pixelY / hexSize)
  const q = pixelX / (hexSize * Math.sqrt(3)) - r / 2

  // Round to nearest hex
  return roundAxial(q, r)
}

/**
 * Round fractional axial coordinates to nearest hex
 *
 * @param q - Fractional Q coordinate
 * @param r - Fractional R coordinate
 * @returns Rounded axial coordinates {q, r}
 */
export function roundAxial(q: number, r: number): { q: number; r: number } {
  // Convert to cubic coordinates for rounding
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  let rs = Math.round(s)

  const qDiff = Math.abs(rq - q)
  const rDiff = Math.abs(rr - r)
  const sDiff = Math.abs(rs - s)

  // If rounding error is too large, adjust
  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs
  } else if (rDiff > sDiff) {
    rr = -rq - rs
  } else {
    rs = -rq - rr
  }

  return { q: rq, r: rr }
}

/**
 * Calculate distance between two hexes in axial coordinates
 *
 * @param a - First hex in axial coordinates
 * @param b - Second hex in axial coordinates
 * @returns Distance in hexes
 */
export function axialDistance(
  a: { q: number; r: number },
  b: { q: number; r: number }
): number {
  // Using cubic coordinates formula (more efficient)
  const aS = -(a.q + a.r)
  const bS = -(b.q + b.r)
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(aS - bS)) / 2
}

/**
 * Get neighbor coordinates in axial system
 *
 * @param q - Q coordinate
 * @param r - R coordinate
 * @returns Array of 6 neighbor coordinates
 */
export function getAxialNeighbors(q: number, r: number): Array<{ q: number; r: number }> {
  const HEX_DIRECTIONS = [
    { q: 1, r: 0 },   // East
    { q: 1, r: -1 },  // North East
    { q: 0, r: -1 },  // North West
    { q: -1, r: 0 },  // West
    { q: -1, r: 1 },  // South West
    { q: 0, r: 1 },   // South East
  ]

  return HEX_DIRECTIONS.map((dir) => ({
    q: q + dir.q,
    r: r + dir.r,
  }))
}

/**
 * Convert axial coordinates to world coordinates for Three.js rendering
 *
 * This matches the current hexToWorld function in MapEditor.tsx
 * which centers the map and uses specific spacing
 *
 * @param q - Q coordinate in axial system
 * @param r - R coordinate in axial system
 * @param mapWidth - Width of map (for centering)
 * @param mapHeight - Height of map (for centering)
 * @param hexSize - Size of hexagon (default: 3.5)
 * @returns World coordinates [x, z] for Three.js (y is height)
 */
export function axialToWorld(
  q: number,
  r: number,
  mapWidth: number,
  mapHeight: number,
  hexSize: number = 3.5
): [number, number] {
  // Convert to offset coordinates first to match current rendering
  const offset = axialToOffset(q, r)
  const scale = hexSize
  const r_inner = 1.0 // inner radius in model
  const R = 2 / Math.sqrt(3) // outer radius in model (~1.1547)

  // Flat Topped Offset-X layout (matching current implementation)
  const spacingX = 1.5 * R * scale
  const spacingZ = 2.0 * r_inner * scale
  const offsetZ = r_inner * scale

  // Mapping: User X -> Three.js X, User Y -> Three.js Z
  const worldX = (offset.x - mapWidth / 2) * spacingX
  const worldZ = (offset.y - mapHeight / 2) * spacingZ + (offset.x % 2) * offsetZ

  return [worldX, worldZ]
}

/**
 * Convert world coordinates to axial coordinates (for Three.js raycasting)
 *
 * @param worldX - X coordinate in Three.js world space
 * @param worldZ - Z coordinate in Three.js world space
 * @param mapWidth - Width of map (for centering)
 * @param mapHeight - Height of map (for centering)
 * @param hexSize - Size of hexagon (default: 3.5)
 * @returns Axial coordinates {q, r}
 */
export function worldToAxial(
  worldX: number,
  worldZ: number,
  mapWidth: number,
  mapHeight: number,
  hexSize: number = 3.5
): { q: number; r: number } {
  const scale = hexSize
  const r_inner = 1.0
  const R = 2 / Math.sqrt(3)
  const spacingX = 1.5 * R * scale
  const spacingZ = 2.0 * r_inner * scale
  const offsetZ = r_inner * scale

  // Reverse of axialToWorld
  const offsetX = worldX / spacingX + mapWidth / 2
  const offsetY = (worldZ - (Math.round(offsetX) % 2) * offsetZ) / spacingZ + mapHeight / 2

  const offset = { x: Math.round(offsetX), y: Math.round(offsetY) }
  return offsetToAxial(offset.x, offset.y)
}

