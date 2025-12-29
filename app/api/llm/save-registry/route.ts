import fs from 'fs'
import { NextResponse } from 'next/server'
import path from 'path'
import type { TileDescriptor } from '@/lib/llm/AssetAnalyzer'

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

export async function POST(request: Request) {
  try {
    const registryData: RegistryData = await request.json()

    // Validate data
    if (!registryData.tiles || !Array.isArray(registryData.tiles)) {
      return NextResponse.json({ error: 'Invalid registry data' }, { status: 400 })
    }

    // Prepare output (сохраняем approvedTiles)
    const outputData = {
      version: registryData.version,
      generatedAt: registryData.generatedAt,
      totalTiles: registryData.totalTiles,
      tiles: registryData.tiles,
      approvedTiles: registryData.approvedTiles || [],
    }

    // Save to file
    const outputPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
    const outputDir = path.dirname(outputPath)

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8')

    return NextResponse.json({ success: true, path: outputPath })
  } catch (error) {
    console.error('Error saving registry:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
