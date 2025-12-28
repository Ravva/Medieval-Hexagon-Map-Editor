import { NextRequest, NextResponse } from 'next/server'
import { MapGenerator } from '@/lib/llm/MapGenerator'
import { MapSerializer } from '@/lib/game/MapSerializer'
import { Map as GameMap } from '@/lib/game/Map'
import { Hex, TERRAIN_TYPES } from '@/lib/game/Hex'
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
}

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
 *   returnFormat?: 'serialized' | 'hexes',
 *   useLocalModel?: boolean,
 *   localUrl?: string,
 *   model?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { width, height, prompt, biome, returnFormat, useLocalModel, localUrl, model } = body

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

    // Если используется локальная модель, используем локальный API
    if (useLocalModel && localUrl && model) {
      const generatedHexes = await generateMapWithLocalModel({
        width,
        height,
        prompt: prompt || 'Generate a fantasy map',
        biome: biome || 'plains',
        localUrl,
        model,
      })

      // Если нужен serialized формат, конвертируем в GameMap
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

    // Используем стандартный MapGenerator для Gemini
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

  // Загружаем tile registry
  const registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Tile registry not found at ${registryPath}. Run "bun run generate-registry" first.`)
  }

  const registryContent = fs.readFileSync(registryPath, 'utf-8')
  const tileRegistry = JSON.parse(registryContent) as { tiles: TileDescriptor[] }

  // Фильтруем и создаем компактный список релевантных тайлов
  // Показываем только тайлы для базовой местности (tiles) и декорации (decoration), соответствующие биому
  const relevantTiles = tileRegistry.tiles.filter((tile) => {
    // Базовые тайлы для всех биомов
    if (tile.category === 'tiles') return true
    // Декорации для соответствующего биома
    if (tile.category === 'decoration' && tile.biome === biome) return true
    // Здания можно использовать, но не обязательно
    return false
  })

  // Группируем тайлы по категориям для лучшего понимания
  const tilesByCategory: Record<string, any[]> = {
    base: [],
    coast: [],
    rivers: [],
    roads: [],
    decoration: [],
  }

  relevantTiles.forEach((tile) => {
    const compact: {
      tile_id: string
      biome: string
      category: string
      subcategory?: string
      walkable: boolean
      tags: string[]
      connections?: TileDescriptor['connections']
    } = {
      tile_id: tile.tile_id,
      biome: tile.biome,
      category: tile.category,
      walkable: tile.walkable,
      tags: tile.tags,
    }

    if (tile.connections && Object.values(tile.connections).some(Boolean)) {
      compact.connections = tile.connections
    }

    // Группируем по подкатегориям
    if (tile.category === 'tiles') {
      const subcat = (tile as any).subcategory || 'base'
      if (!tilesByCategory[subcat]) tilesByCategory[subcat] = []
      compact.subcategory = subcat
      tilesByCategory[subcat].push(compact)
    } else if (tile.category === 'decoration') {
      tilesByCategory.decoration.push(compact)
    }
  })

  // Создаем структурированный список для промпта
  const tileExamples: string[] = []
  Object.entries(tilesByCategory).forEach(([category, tiles]) => {
    if (tiles.length > 0) {
      // Берем первые 3-5 примеров из каждой категории
      const examples = tiles.slice(0, 5).map(t => t.tile_id).join(', ')
      tileExamples.push(`${category}: ${examples}${tiles.length > 5 ? ` (and ${tiles.length - 5} more)` : ''}`)
    }
  })

  // Создаем промпт (аналогично MapGenerator)
  const systemMessage = `You are an expert game designer. You must respond ONLY with valid JSON.
Return a JSON object with this exact structure:
{
  "hexes": [
    {
      "q": number (0-${width - 1}),
      "r": number (0-${height - 1}),
      "tile_id": "string",
      "rotation": number (0, 60, 120, 180, 240, or 300),
      "height": number (0-4)
    }
  ]
}`

  // Создаем список конкретных примеров тайлов для использования
  const exampleTiles: string[] = []

  // Базовые тайлы по биомам
  const baseTiles = relevantTiles.filter(t => t.category === 'tiles' && (t as any).subcategory === 'base')
  const waterTiles = baseTiles.filter(t => t.biome === 'water').slice(0, 2).map(t => t.tile_id)
  const forestTiles = baseTiles.filter(t => t.biome === 'forest').slice(0, 2).map(t => t.tile_id)
  const mountainTiles = baseTiles.filter(t => t.biome === 'mountain').slice(0, 2).map(t => t.tile_id)
  const plainsTiles = baseTiles.filter(t => t.biome === 'plains').slice(0, 3).map(t => t.tile_id)

  // Реки и дороги
  const riverTiles = relevantTiles.filter(t => t.category === 'tiles' && (t as any).subcategory === 'rivers').slice(0, 3).map(t => t.tile_id)
  const roadTiles = relevantTiles.filter(t => t.category === 'tiles' && (t as any).subcategory === 'roads').slice(0, 3).map(t => t.tile_id)
  const coastTiles = relevantTiles.filter(t => t.category === 'tiles' && (t as any).subcategory === 'coast').slice(0, 2).map(t => t.tile_id)

  // Декорации
  const decorationTiles = relevantTiles.filter(t => t.category === 'decoration' && t.biome === biome).slice(0, 5).map(t => t.tile_id)

  // Определяем, какие фичи нужно включить на основе промпта
  const needsRiver = /river|река|water|вода/i.test(prompt)
  const needsRoad = /road|дорога|path|путь/i.test(prompt)
  const needsForest = /forest|лес|tree|дерево/i.test(prompt)
  const needsMountain = /mountain|гора|hill|холм/i.test(prompt)
  const needsVillage = /village|деревня|town|город|building|здание/i.test(prompt)

  const userPrompt = `Create a ${width}x${height} hex map. Request: "${prompt}". Biome: ${biome}.

⚠️ CRITICAL RULE: You MUST use AT LEAST 5-7 DIFFERENT tile types! DO NOT use only "tiles_base_hex_grass"!

QUICK TILE REFERENCE (use these exact tile_id values):
Base tiles: ${plainsTiles.slice(0, 2).join(', ')}${waterTiles.length > 0 ? `, ${waterTiles[0]}` : ''}${forestTiles.length > 0 ? `, ${forestTiles[0]}` : ''}
${riverTiles.length > 0 ? `Rivers: ${riverTiles.slice(0, 2).join(', ')}\n` : ''}${roadTiles.length > 0 ? `Roads: ${roadTiles.slice(0, 2).join(', ')}\n` : ''}${decorationTiles.length > 0 ? `Trees/Props: ${decorationTiles.slice(0, 3).join(', ')}\n` : ''}

MANDATORY REQUIREMENTS:
1. Generate ALL ${width * height} hexes (q: 0-${width - 1}, r: 0-${height - 1})
2. Use VARIETY: ${needsRiver ? 'Include 5-10 river tiles (tiles_rivers_*), ' : ''}${needsRoad ? 'Include 5-10 road tiles (tiles_roads_*), ' : ''}${needsForest ? 'Include 10-15 forest tiles (tiles_base_hex_forest or decoration_nature_*), ' : ''}mix of base tiles (grass, water, forest). For decorations/buildings: place them on top of base tiles at same position (q, r) with same height 0
3. Minimum 5 different tile_id values in your output
4. ⚠️ CRITICAL HEIGHT RULE: ALL tiles must be at height 0! Do NOT use height 1, 2, 3, or 4!
   - Base tiles: height 0
   - Rivers: height 0
   - Roads: height 0
   - Decorations (trees, rocks): height 0 (placed on top of base tiles at same position)
   - Buildings: height 0 (placed on top of base tiles at same position)
   - If you need to place decoration/building on a position, generate TWO hexes with same (q, r):
     * First: base tile (e.g., tiles_base_hex_grass) at height 0
     * Second: decoration/building at height 0 (same position, different tile_id)
5. Rotation: 0, 60, 120, 180, 240, or 300

EXAMPLE OUTPUT STRUCTURE (showing variety - ALL at height 0):
{"hexes": [
  {"q":0,"r":0,"tile_id":"${plainsTiles[0] || 'tiles_base_hex_grass'}","rotation":0,"height":0},
  {"q":0,"r":0,"tile_id":"${decorationTiles[0] || 'decoration_nature_tree'}","rotation":0,"height":0},
  {"q":1,"r":0,"tile_id":"${plainsTiles[0] || 'tiles_base_hex_grass'}","rotation":0,"height":0},
  {"q":1,"r":0,"tile_id":"${riverTiles[0] || 'tiles_rivers_straight'}","rotation":0,"height":0},
  {"q":2,"r":0,"tile_id":"${forestTiles[0] || 'tiles_base_hex_forest'}","rotation":0,"height":0},
  {"q":3,"r":0,"tile_id":"${plainsTiles[0] || 'tiles_base_hex_grass'}","rotation":0,"height":0},
  {"q":3,"r":0,"tile_id":"${decorationTiles[1] || 'decoration_nature_rock'}","rotation":60,"height":0}
]}
NOTE: Position (0,0) has TWO tiles - base grass + tree decoration, both at height 0!

FULL TILE LIST (${relevantTiles.length} tiles - USE VARIETY!):
${JSON.stringify(relevantTiles.slice(0, 60).map(t => t.tile_id), null, 1)}

Return ONLY JSON: {"hexes": [...]}. Include rivers, roads, forests, decorations - NOT just grass!
REMEMBER: ALL tiles at height 0! Decorations/buildings go on top of base tiles at same (q, r) position!`

  // Вызываем локальный API с увеличенным timeout (10 минут)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 минут

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
          { role: 'system', content: systemMessage },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
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

  console.log(`[generate-map] Received response from local API, content length: ${content.length}`)

  // Парсим JSON ответ
  let parsedResponse: { hexes: GeneratedHex[] }
  try {
    // Убираем markdown code blocks если есть
    let cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    // Проверяем, не обрезан ли JSON
    const isTruncated = !cleanedContent.endsWith('}') && !cleanedContent.endsWith(']')

    if (isTruncated) {
      console.log(`[generate-map] JSON appears truncated, attempting to fix...`)

      // Пытаемся найти последний валидный hex объект
      // Ищем паттерн: {"q":число,"r":число,...}
      const hexPattern = /\{\s*"q"\s*:\s*\d+\s*,\s*"r"\s*:\s*\d+\s*[^}]*\}/g
      const matches = cleanedContent.match(hexPattern)

      if (matches && matches.length > 0) {
        // Берем все найденные hex объекты
        const validHexes = matches.map(m => {
          try {
            return JSON.parse(m)
          } catch {
            return null
          }
        }).filter(h => h !== null) as GeneratedHex[]

        if (validHexes.length > 0) {
          console.log(`[generate-map] Extracted ${validHexes.length} valid hexes from truncated JSON`)
          parsedResponse = { hexes: validHexes }
        } else {
          throw new Error('No valid hexes found in truncated response')
        }
      } else {
        // Fallback: пытаемся найти последний валидный JSON объект
        const lastBrace = cleanedContent.lastIndexOf('}')
        const lastBracket = cleanedContent.lastIndexOf(']')
        const lastValid = Math.max(lastBrace, lastBracket)

        if (lastValid > 0) {
          if (lastBrace > lastBracket) {
            cleanedContent = cleanedContent.substring(0, lastValid + 1)
          } else {
            const beforeBracket = cleanedContent.substring(0, lastValid)
            const openBraces = (beforeBracket.match(/\{/g) || []).length
            const closeBraces = (beforeBracket.match(/\}/g) || []).length
            if (openBraces > closeBraces) {
              cleanedContent = cleanedContent.substring(0, lastValid + 1) + '}'
            } else {
              cleanedContent = cleanedContent.substring(0, lastValid + 1)
            }
          }
          parsedResponse = JSON.parse(cleanedContent)
        } else {
          throw new Error('Cannot fix truncated JSON: no valid structure found')
        }
      }
    } else {
      parsedResponse = JSON.parse(cleanedContent)
    }
  } catch (e) {
    console.error(`[generate-map] JSON parse error:`, e)
    // Если JSON невалидный, пытаемся извлечь hexes массив вручную
    const hexesMatch = content.match(/"hexes"\s*:\s*\[([\s\S]*?)\]/)
    if (hexesMatch) {
      try {
        // Пытаемся извлечь все hex объекты из массива
        const arrayContent = hexesMatch[1]
        const hexPattern = /\{\s*"q"\s*:\s*\d+\s*,\s*"r"\s*:\s*\d+\s*[^}]*\}/g
        const hexMatches = arrayContent.match(hexPattern)

        if (hexMatches) {
          const hexes = hexMatches.map(m => {
            try {
              return JSON.parse(m)
            } catch {
              return null
            }
          }).filter(h => h !== null) as GeneratedHex[]

          if (hexes.length > 0) {
            console.log(`[generate-map] Extracted ${hexes.length} hexes using regex fallback`)
            parsedResponse = { hexes }
          } else {
            throw new Error('No valid hexes extracted')
          }
        } else {
          throw new Error('No hex pattern matches found')
        }
      } catch (fallbackError) {
        throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}\nFallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}\nContent preview: ${content.substring(0, 2000)}`)
      }
    } else {
      throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}\nContent preview: ${content.substring(0, 2000)}`)
    }
  }

  if (!parsedResponse.hexes || !Array.isArray(parsedResponse.hexes)) {
    throw new Error('Invalid response format: missing hexes array')
  }

  // Валидация rotation
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
  // Загружаем tile registry
  const registryPath = path.join(process.cwd(), 'lib', 'llm', 'tile-registry.json')
  const registryContent = fs.readFileSync(registryPath, 'utf-8')
  const tileRegistry = JSON.parse(registryContent) as { tiles: TileDescriptor[] }

  const gameMap = new GameMap(width, height)

  for (const generatedHex of generatedHexes) {
    // Находим тайл в реестре
    const tileDescriptor = tileRegistry.tiles.find((t) => t.tile_id === generatedHex.tile_id)

    if (!tileDescriptor) {
      console.warn(`Tile ${generatedHex.tile_id} not found in registry, using PLAINS as fallback`)
      const hex = new Hex(generatedHex.q, generatedHex.r, TERRAIN_TYPES.PLAINS)
      hex.height = generatedHex.height
      hex.rotation = (generatedHex.rotation * Math.PI) / 180
      gameMap.setHex(hex.q, hex.r, hex)
      continue
    }

    // Маппинг biome на terrain type
    let terrain = TERRAIN_TYPES.PLAINS
    switch (tileDescriptor.biome) {
      case 'water':
        terrain = TERRAIN_TYPES.WATER
        break
      case 'forest':
        terrain = TERRAIN_TYPES.FOREST
        break
      case 'mountain':
        terrain = TERRAIN_TYPES.MOUNTAIN
        break
      case 'plains':
        terrain = TERRAIN_TYPES.PLAINS
        break
    }

    const hex = new Hex(generatedHex.q, generatedHex.r, terrain)
    hex.height = generatedHex.height
    hex.rotation = (generatedHex.rotation * Math.PI) / 180

    // Добавляем model data если доступно
    if (tileDescriptor.obj_path && tileDescriptor.mtl_path) {
      hex.modelData = {
        obj: tileDescriptor.obj_path,
        mtl: tileDescriptor.mtl_path,
        name: tileDescriptor.name,
      }
    }

    gameMap.setHex(hex.q, hex.r, hex)
  }

  return gameMap
}

