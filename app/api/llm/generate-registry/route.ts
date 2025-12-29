import fs from 'fs'
import { NextResponse } from 'next/server'
import path from 'path'
import { AssetAnalyzer, type TileDescriptor } from '@/lib/llm/AssetAnalyzer'

interface RegistryData {
  version: string
  generatedAt: string
  totalTiles: number
  tiles: TileDescriptor[]
  approvedTiles?: string[] // Список ID утвержденных тайлов
  statistics?: {
    byCategory: Record<string, number>
    byBiome: Record<string, number>
    tilesWithConnections: number
  }
}

export async function POST() {
  try {
    const registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')

    // Сначала пытаемся загрузить существующий файл
    if (fs.existsSync(registryPath)) {
      console.log('📂 Loading existing registry from file...')
      try {
        const existingData = fs.readFileSync(registryPath, 'utf-8')
        const registryData: RegistryData = JSON.parse(existingData)

        // Пересчитываем статистику для UI
        const categoryCounts: Record<string, number> = {}
        const biomeCounts: Record<string, number> = {}
        let tilesWithConnections = 0

        for (const tile of registryData.tiles) {
          categoryCounts[tile.category] = (categoryCounts[tile.category] || 0) + 1
          biomeCounts[tile.biome] = (biomeCounts[tile.biome] || 0) + 1
          if (tile.connections && Object.values(tile.connections).some(Boolean)) {
            tilesWithConnections++
          }
        }

        const responseData = {
          ...registryData,
          statistics: {
            byCategory: categoryCounts,
            byBiome: biomeCounts,
            tilesWithConnections,
          },
        }

        console.log(`✅ Loaded ${registryData.tiles.length} tiles from existing registry`)
        console.log(`📋 Approved tiles: ${registryData.approvedTiles?.length || 0}`)
        return NextResponse.json(responseData)
      } catch (parseError) {
        console.warn('⚠️ Failed to parse existing registry, regenerating...', parseError)
      }
    }

    // Если файла нет или он поврежден, генерируем заново
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
      return NextResponse.json(
        { error: `Found duplicate tile_ids: ${duplicates.join(', ')}` },
        { status: 400 }
      )
    }

    // Sort tiles by tile_id for consistency
    tiles.sort((a, b) => a.tile_id.localeCompare(b.tile_id))

    // Count statistics
    const categoryCounts: Record<string, number> = {}
    const biomeCounts: Record<string, number> = {}
    let tilesWithConnections = 0

    for (const tile of tiles) {
      categoryCounts[tile.category] = (categoryCounts[tile.category] || 0) + 1
      biomeCounts[tile.biome] = (biomeCounts[tile.biome] || 0) + 1
      if (tile.connections && Object.values(tile.connections).some(Boolean)) {
        tilesWithConnections++
      }
    }

    const registryData = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      totalTiles: tiles.length,
      tiles: tiles,
      approvedTiles: [], // Новый реестр - нет утвержденных тайлов
      statistics: {
        byCategory: categoryCounts,
        byBiome: biomeCounts,
        tilesWithConnections,
      },
    }

    return NextResponse.json(registryData)
  } catch (error) {
    console.error('❌ Error generating tile registry:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
