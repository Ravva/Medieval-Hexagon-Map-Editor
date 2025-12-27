import { NextRequest, NextResponse } from 'next/server'
import { MapGenerator } from '@/lib/llm/MapGenerator'
import { MapSerializer } from '@/lib/game/MapSerializer'

/**
 * Generate a hex map using LLM
 * POST /api/llm/generate-map
 *
 * Body:
 * {
 *   width: number,
 *   height: number,
 *   prompt?: string,
 *   biome?: 'plains' | 'water' | 'forest' | 'mountain',
 *   returnFormat?: 'serialized' | 'hexes'
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { width, height, prompt, biome, returnFormat } = body

    // Validate parameters
    if (!width || !height || typeof width !== 'number' || typeof height !== 'number') {
      return NextResponse.json(
        { error: 'width and height are required and must be numbers' },
        { status: 400 }
      )
    }

    if (width <= 0 || height <= 0 || width > 100 || height > 100) {
      return NextResponse.json(
        { error: 'width and height must be between 1 and 100' },
        { status: 400 }
      )
    }

    // Determine mapSize
    const totalHexes = width * height
    let mapSize: 'tiny' | 'small' | 'medium' | 'large' | 'very-large' = 'tiny'
    if (totalHexes <= 10 * 10) {
      mapSize = 'tiny'
    } else if (totalHexes <= 25 * 25) {
      mapSize = 'small'
    } else if (totalHexes <= 50 * 50) {
      mapSize = 'medium'
    } else if (totalHexes <= 75 * 75) {
      mapSize = 'large'
    } else {
      mapSize = 'very-large'
    }

    const generator = new MapGenerator()

    // If returnFormat is 'serialized', return the map in MapSerializer format
    if (returnFormat === 'serialized') {
      const gameMap = await generator.generateMapToGameMap({
        width,
        height,
        prompt: prompt || 'Generate a fantasy map',
        biome: biome || 'plains',
        mapSize,
      })

      const jsonString = MapSerializer.serialize(gameMap, mapSize, {
        name: prompt ? `Generated: ${prompt.substring(0, 50)}` : `Generated ${width}x${height} ${biome || 'plains'}`,
        includeBuildings: false,
      })

      return NextResponse.json({
        success: true,
        mapData: JSON.parse(jsonString),
        mapSize,
      })
    }

    // Otherwise, return GeneratedHex[] (for testing/compatibility)
    const generatedHexes = await generator.generateMap({
      width,
      height,
      prompt: prompt || 'Generate a fantasy map',
      biome: biome || 'plains',
    })

    return NextResponse.json({
      success: true,
      hexes: generatedHexes,
      count: generatedHexes.length,
      expectedCount: width * height,
    })
  } catch (error) {
    console.error('Error generating map:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

