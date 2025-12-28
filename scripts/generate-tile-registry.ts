/**
 * Script to generate tile registry from 3D assets
 *
 * Usage: bun run scripts/generate-tile-registry.ts
 *
 * This script:
 * 1. Scans assets/terrain/ directory
 * 2. Analyzes all OBJ/MTL file pairs
 * 3. Generates tile descriptors with metadata
 * 4. Saves to lib/llm/tile-registry.json
 */

import { AssetAnalyzer, type TileDescriptor } from '../lib/llm/AssetAnalyzer'
import * as fs from 'fs'
import * as path from 'path'

const OUTPUT_PATH = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')

function main() {
  console.log('🔍 Scanning assets directory...')
  const analyzer = new AssetAnalyzer()

  console.log('📦 Analyzing assets...')
  const tiles = analyzer.scanAssets()

  console.log(`✅ Found ${tiles.length} tiles`)

  // Validate tile_id uniqueness
  const tileIds = new Set<string>()
  const duplicates: string[] = []

  for (const tile of tiles) {
    if (tileIds.has(tile.tile_id)) {
      duplicates.push(tile.tile_id)
    } else {
      tileIds.add(tile.tile_id)
    }
  }

  if (duplicates.length > 0) {
    console.error(`❌ Found duplicate tile_ids: ${duplicates.join(', ')}`)
    process.exit(1)
  }

  // Sort tiles by tile_id for consistency
  tiles.sort((a, b) => a.tile_id.localeCompare(b.tile_id))

  // Create output directory if it doesn't exist
  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Write registry to file
  const registryData = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    totalTiles: tiles.length,
    tiles: tiles,
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registryData, null, 2), 'utf-8')

  console.log(`✅ Tile registry saved to ${OUTPUT_PATH}`)
  console.log(`📊 Statistics:`)
  console.log(`   - Total tiles: ${tiles.length}`)

  // Count by category
  const categoryCounts: Record<string, number> = {}
  for (const tile of tiles) {
    categoryCounts[tile.category] = (categoryCounts[tile.category] || 0) + 1
  }

  console.log(`   - By category:`)
  for (const [category, count] of Object.entries(categoryCounts)) {
    console.log(`     ${category}: ${count}`)
  }

  // Count by biome
  const biomeCounts: Record<string, number> = {}
  for (const tile of tiles) {
    biomeCounts[tile.biome] = (biomeCounts[tile.biome] || 0) + 1
  }

  console.log(`   - By biome:`)
  for (const [biome, count] of Object.entries(biomeCounts)) {
    console.log(`     ${biome}: ${count}`)
  }

  // Count tiles with connection information
  const tilesWithConnections = tiles.filter((t) => t.connections && Object.values(t.connections).some(Boolean))
  console.log(`   - Tiles with connections: ${tilesWithConnections.length}`)

  if (tilesWithConnections.length > 0) {
    console.log(`   - Connection breakdown:`)
    const connectionCategories: Record<string, number> = {}
    for (const tile of tilesWithConnections) {
      const key = `${tile.category}_${tile.subcategory || 'none'}`
      connectionCategories[key] = (connectionCategories[key] || 0) + 1
    }
    for (const [category, count] of Object.entries(connectionCategories)) {
      console.log(`     ${category}: ${count}`)
    }
  }
}

// Run if executed directly
try {
  main()
} catch (error) {
  console.error('❌ Error generating tile registry:', error)
  process.exit(1)
}

