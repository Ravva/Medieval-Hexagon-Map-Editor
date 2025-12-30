import { NextRequest, NextResponse } from 'next/server'
import { MapGenerator } from '@/lib/llm/MapGenerator'
import { MapSerializer } from '@/lib/game/MapSerializer'
import { Map as GameMap } from '@/lib/game/Map'
import { Hex, TERRAIN_TYPES, type TerrainType } from '@/lib/game/Hex'
import { promptManager } from '@/lib/llm/PromptManager'
import fs from 'fs'
import path from 'path'
import type { GeneratedHex } from '@/lib/llm/MapGenerator'

// Увеличиваем таймаут для API route (10 минут для локальных моделей)
export const maxDuration = 600

interface TileDescriptor {
  tile_id: string
  biome: string
  category: string
  walkable: boolean
  tags: string[]
  connections?: Record<string, boolean>
  obj_path?: string
  mtl_path?: string
  name?: string
  is_base_tile: boolean
}

/**
 * Generate a hex map using LLM
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { width, height, prompt, biome, returnFormat, useLocalModel, localUrl, model, stream, geminiApiKey } = body

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

    // Validate API key for Gemini
    if (!useLocalModel && !geminiApiKey) {
      return NextResponse.json(
        { error: 'Gemini API key is required' },
        { status: 400 }
      )
    }

    // Validate local model settings
    if (useLocalModel && (!localUrl || !model)) {
      return NextResponse.json(
        { error: 'Local model URL and model name are required' },
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

    // Если используется локальная модель, используем локальный API
    if (useLocalModel && localUrl && model) {
      if (stream) {
        // Return streaming response for debug data
        return new Response(
          new ReadableStream({
            async start(controller) {
              try {
                const generatedHexes = await generateMapWithLocalModelStreaming({
                  width,
                  height,
                  prompt: prompt || 'Generate a fantasy map',
                  biome: biome || 'plains',
                  localUrl,
                  model,
                  onProgress: (data) => {
                    controller.enqueue(new TextEncoder().encode(data + '\n'))
                  }
                })

                if (returnFormat === 'serialized') {
                  const gameMap = await convertGeneratedHexesToGameMap(generatedHexes, width, height)
                  const jsonString = MapSerializer.serialize(gameMap, mapSize, {
                    name: prompt ? `Generated: ${prompt.substring(0, 50)}` : `Generated ${width}x${height} ${biome || 'plains'}`,
                    includeBuildings: false,
                  })

                  const finalResponse = {
                    success: true,
                    mapData: JSON.parse(jsonString),
                    mapSize,
                  }

                  controller.enqueue(new TextEncoder().encode(JSON.stringify(finalResponse) + '\n'))
                } else {
                  const finalResponse = {
                    success: true,
                    hexes: generatedHexes,
                    count: generatedHexes.length,
                    expectedCount: width * height,
                  }
                  controller.enqueue(new TextEncoder().encode(JSON.stringify(finalResponse) + '\n'))
                }

                controller.close()
              } catch (error) {
                controller.enqueue(new TextEncoder().encode(`Error: ${error instanceof Error ? error.message : String(error)}\n`))
                controller.close()
              }
            }
          }),
          {
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            }
          }
        )
      } else {
        const generatedHexes = await generateMapWithLocalModel({
          width,
          height,
          prompt: prompt || 'Generate a fantasy map',
          biome: biome || 'plains',
          localUrl,
          model,
        })

        if (returnFormat === 'serialized') {
          const gameMap = await convertGeneratedHexesToGameMap(generatedHexes, width, height)
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

        return NextResponse.json({
          success: true,
          hexes: generatedHexes,
          count: generatedHexes.length,
          expectedCount: width * height,
        })
      }
    }

    // Используем стандартный MapGenerator для Gemini
    if (stream) {
      // Return streaming response for Gemini with progress updates
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              // Send progress updates
              controller.enqueue(new TextEncoder().encode('Prompt processing progress: 10%\n'))
              controller.enqueue(new TextEncoder().encode('Initializing Gemini API...\n'))

              const generator = new MapGenerator(geminiApiKey)

              controller.enqueue(new TextEncoder().encode('Prompt processing progress: 30%\n'))
              controller.enqueue(new TextEncoder().encode('Loading tile registry...\n'))

              controller.enqueue(new TextEncoder().encode('Prompt processing progress: 50%\n'))
              controller.enqueue(new TextEncoder().encode('Sending request to Gemini...\n'))

              controller.enqueue(new TextEncoder().encode('Prompt processing progress: 70%\n'))
              controller.enqueue(new TextEncoder().encode('Thought for 3 seconds\n'))
              controller.enqueue(new TextEncoder().encode('Analyzing map requirements and generating layout...\n'))

              controller.enqueue(new TextEncoder().encode('Prompt processing progress: 90%\n'))
              controller.enqueue(new TextEncoder().encode('Processing model response...\n'))

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

                controller.enqueue(new TextEncoder().encode('Prompt processing progress: 100%\n'))
                controller.enqueue(new TextEncoder().encode('Map generation completed successfully!\n'))

                const finalResponse = {
                  success: true,
                  mapData: JSON.parse(jsonString),
                  mapSize,
                }

                const finalResponseJson = JSON.stringify(finalResponse)
                console.log('Sending final response:', finalResponseJson) // Debug log
                controller.enqueue(new TextEncoder().encode(finalResponseJson + '\n'))
              } else {
                const generatedHexes = await generator.generateMap({
                  width,
                  height,
                  prompt: prompt || 'Generate a fantasy map',
                  biome: biome || 'plains',
                })

                controller.enqueue(new TextEncoder().encode('Prompt processing progress: 100%\n'))
                controller.enqueue(new TextEncoder().encode('Map generation completed successfully!\n'))

                const finalResponse = {
                  success: true,
                  hexes: generatedHexes,
                  count: generatedHexes.length,
                  expectedCount: width * height,
                }
                const finalResponseJson = JSON.stringify(finalResponse)
                console.log('Sending final response:', finalResponseJson) // Debug log
                controller.enqueue(new TextEncoder().encode(finalResponseJson + '\n'))
              }

              controller.close()
            } catch (error) {
              controller.enqueue(new TextEncoder().encode(`Error: ${error instanceof Error ? error.message : String(error)}\n`))
              controller.close()
            }
          }
        }),
        {
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          }
        }
      )
    }

    // Используем стандартный MapGenerator для Gemini
    const generator = new MapGenerator(geminiApiKey)

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

/**
 * Generate map using local LLM API with streaming debug output
 */
async function generateMapWithLocalModelStreaming(params: {
  width: number
  height: number
  prompt: string
  biome: 'plains' | 'water' | 'forest' | 'mountain'
  localUrl: string
  model: string
  onProgress: (data: string) => void
}): Promise<GeneratedHex[]> {
  const { width, height, prompt, biome, localUrl, model, onProgress } = params

  onProgress('Prompt processing progress: 10%')
  onProgress('Analyzing river connection requirements...')

  // Load tile registry
  onProgress('Loading tile registry...')
  const registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
  if (!fs.existsSync(registryPath)) {
    throw new Error(
      `Tile registry not found at ${registryPath}. Run "bun run generate-registry" first.`
    )
  }
  const registryContent = fs.readFileSync(registryPath, 'utf-8')
  const tileRegistry = JSON.parse(registryContent) as { tiles: TileDescriptor[] }

  // Compact tile registry (only include essential fields to reduce token count)
  const compactTiles = tileRegistry.tiles.map((tile) => {
    const compact: {
      tile_id: string
      biome: string
      category: string
      walkable: boolean
      tags: string[]
      connections?: Record<string, boolean>
    } = {
      tile_id: tile.tile_id,
      biome: tile.biome,
      category: tile.category,
      walkable: tile.walkable,
      tags: tile.tags,
    }

    // Include connections information for tiles that need connections
    if (tile.connections && Object.values(tile.connections).some(Boolean)) {
      compact.connections = tile.connections
    }

    return compact
  })

  // Use PromptManager for unified prompt generation
  const { systemMessage: unifiedSystemMessage, userPrompt: baseUserPrompt } = promptManager.getPrompts({
    width,
    height,
    prompt: prompt || 'Generate a fantasy map',
    biome: biome || 'plains'
  })

  // Add tile registry to the user prompt
  const userPrompt = `${baseUserPrompt}

TILE REGISTRY (use tile_id values from here - DO NOT use placeholder IDs like "plain_base", "river_straight", etc.):
${JSON.stringify(compactTiles, null, 2)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 600000)

  let response: Response
  try {
    onProgress('Prompt processing progress: 90%')
    onProgress('Sending request to local model...')

    response = await fetch(`${localUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: unifiedSystemMessage },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout: Local model generation took too long (over 10 minutes). Try reducing map size.')
    }
    throw error
  }

  onProgress('Prompt processing progress: 95%')
  onProgress('Processing model response...')

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Local API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''

  onProgress('Prompt processing progress: 100%')
  onProgress('Parsing generated map data...')

  let parsedResponse: { hexes: GeneratedHex[] }
  try {
    let cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    parsedResponse = JSON.parse(cleanedContent)
  } catch (e) {
    throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!parsedResponse.hexes || !Array.isArray(parsedResponse.hexes)) {
    throw new Error('Invalid response format: missing hexes array')
  }

  const validRotations = [0, 60, 120, 180, 240, 300]
  for (const hex of parsedResponse.hexes) {
    if (!validRotations.includes(hex.rotation)) {
      const nearest = validRotations.reduce((prev, curr) =>
        Math.abs(curr - hex.rotation) < Math.abs(prev - hex.rotation) ? curr : prev
      )
      hex.rotation = nearest
    }
  }

  onProgress('Map generation completed successfully!')
  return parsedResponse.hexes
}

/**
 * Generate map using local LLM API
 */
async function generateMapWithLocalModel(params: {
  width: number
  height: number
  prompt: string
  biome: 'plains' | 'water' | 'forest' | 'mountain'
  localUrl: string
  model: string
}): Promise<GeneratedHex[]> {
  const { width, height, prompt, biome, localUrl, model } = params

  // Load tile registry
  const registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
  if (!fs.existsSync(registryPath)) {
    throw new Error(
      `Tile registry not found at ${registryPath}. Run "bun run generate-registry" first.`
    )
  }
  const registryContent = fs.readFileSync(registryPath, 'utf-8')
  const tileRegistry = JSON.parse(registryContent) as { tiles: TileDescriptor[] }

  // Compact tile registry (only include essential fields to reduce token count)
  const compactTiles = tileRegistry.tiles.map((tile) => {
    const compact: {
      tile_id: string
      biome: string
      category: string
      walkable: boolean
      tags: string[]
      connections?: Record<string, boolean>
    } = {
      tile_id: tile.tile_id,
      biome: tile.biome,
      category: tile.category,
      walkable: tile.walkable,
      tags: tile.tags,
    }

    // Include connections information for tiles that need connections
    if (tile.connections && Object.values(tile.connections).some(Boolean)) {
      compact.connections = tile.connections
    }

    return compact
  })

  // Use PromptManager for unified prompt generation
  const { systemMessage: unifiedSystemMessage, userPrompt: baseUserPrompt } = promptManager.getPrompts({
    width,
    height,
    prompt: prompt || 'Generate a fantasy map',
    biome: biome || 'plains'
  })

  // Add tile registry to the user prompt
  const userPrompt = `${baseUserPrompt}

TILE REGISTRY (use tile_id values from here - DO NOT use placeholder IDs like "plain_base", "river_straight", etc.):
${JSON.stringify(compactTiles, null, 2)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 600000)

  let response: Response
  try {
    response = await fetch(`${localUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: unifiedSystemMessage },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout: Local model generation took too long (over 10 minutes). Try reducing map size.')
    }
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Local API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''

  let parsedResponse: { hexes: GeneratedHex[] }
  try {
    let cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    parsedResponse = JSON.parse(cleanedContent)
  } catch (e) {
    throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!parsedResponse.hexes || !Array.isArray(parsedResponse.hexes)) {
    throw new Error('Invalid response format: missing hexes array')
  }

  const validRotations = [0, 60, 120, 180, 240, 300]
  for (const hex of parsedResponse.hexes) {
    if (!validRotations.includes(hex.rotation)) {
      const nearest = validRotations.reduce((prev, curr) =>
        Math.abs(curr - hex.rotation) < Math.abs(prev - hex.rotation) ? curr : prev
      )
      hex.rotation = nearest
    }
  }

  return parsedResponse.hexes
}

/**
 * Convert GeneratedHex[] to GameMap
 */
async function convertGeneratedHexesToGameMap(
  generatedHexes: GeneratedHex[],
  width: number,
  height: number
): Promise<GameMap> {
  const gameMap = new GameMap(width, height)

  for (const generatedHex of generatedHexes) {
    let terrain: TerrainType = TERRAIN_TYPES.PLAINS
    if (generatedHex.tile_id.includes('river') || generatedHex.tile_id.includes('water')) {
      terrain = TERRAIN_TYPES.WATER
    } else if (generatedHex.tile_id.includes('forest')) {
      terrain = TERRAIN_TYPES.FOREST
    } else if (generatedHex.tile_id.includes('mountain')) {
      terrain = TERRAIN_TYPES.MOUNTAIN
    }

    const hex = new Hex(generatedHex.q, generatedHex.r, terrain)
    hex.height = generatedHex.height
    hex.rotation = (generatedHex.rotation * Math.PI) / 180

    if (generatedHex.tile_id.includes('river')) {
      hex.modelData = {
        obj: `/assets/terrain/tiles/rivers/${generatedHex.tile_id.replace('tiles_rivers_', '')}.obj`,
        mtl: `/assets/terrain/tiles/rivers/${generatedHex.tile_id.replace('tiles_rivers_', '')}.mtl`,
        name: generatedHex.tile_id,
      }
    } else if (generatedHex.tile_id === 'tiles_base_hex_grass') {
      hex.modelData = {
        obj: '/assets/terrain/tiles/base/hex_grass.obj',
        mtl: '/assets/terrain/tiles/base/hex_grass.mtl',
        name: 'Hex Grass',
      }
    }

    gameMap.setHex(hex.q, hex.r, hex)
  }

  return gameMap
}
