import { NextRequest, NextResponse } from 'next/server'
import type { TileConnections } from '@/lib/llm/TileConnectionAnalyzer'

export const maxDuration = 300 // 5 минут для vision анализа

/**
 * Analyze tile connections using vision model
 * POST /api/llm/analyze-connections-vision
 *
 * Body:
 * {
 *   images: string[], // Base64 encoded images (6 images, one for each hex edge)
 *   localUrl: string,
 *   model: string,
 *   tileType?: 'river' | 'road' | 'coast' | 'base' | 'other',
 *   biome?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { images, localUrl, model, tileType, biome } = body

    if (!images || !Array.isArray(images) || images.length !== 6) {
      return NextResponse.json(
        { error: 'Exactly 6 images are required (one for each hex edge)' },
        { status: 400 }
      )
    }

    if (!localUrl || !model) {
      return NextResponse.json(
        { error: 'localUrl and model are required' },
        { status: 400 }
      )
    }

    // Направления гексагона (flat-topped) с правильной ориентацией: Север вверху, Юг внизу
    // Углы отсчитываются от Востока (0°) по часовой стрелке
    // Для flat-topped гексагона с Севером вверху:
    const directions = [
      { name: 'east', angle: 0, label: 'E', position: 'right' },      // Справа
      { name: 'southeast', angle: 60, label: 'SE', position: 'right-bottom' },  // Справа-вниз
      { name: 'southwest', angle: 120, label: 'SW', position: 'left-bottom' },  // Слева-вниз
      { name: 'west', angle: 180, label: 'W', position: 'left' },     // Слева
      { name: 'northwest', angle: 240, label: 'NW', position: 'left-top' },      // Слева-вверх (СЕВЕР)
      { name: 'northeast', angle: 300, label: 'NE', position: 'right-top' },    // Справа-вверх (СЕВЕР)
    ]

    // Создаем промпт для vision модели с правильной ориентацией
    const systemMessage = `You are an expert at analyzing 3D tile models for a hexagonal grid game.
Your task is to determine the connection type for each of the 6 edges of a hexagonal tile.

IMPORTANT: The tile is oriented with NORTH at the TOP and SOUTH at the BOTTOM (standard map orientation).

Connection types:
- "grass": Green terrain, vegetation, land
- "water": Blue water, river, lake
- "coast": Transition between land and water (sandy, beach-like)
- "road": Brown/dirt path, road surface
- "unknown": Cannot determine or no connection

You will receive 6 images, each showing the tile from a different angle focusing on one edge.
For each image, determine if that edge has a connection and what type it is.

Return a JSON object with this exact structure:
{
  "connections": {
    "east": "grass" | "water" | "coast" | "road" | null,
    "southeast": "grass" | "water" | "coast" | "road" | null,
    "southwest": "grass" | "water" | "coast" | "road" | null,
    "west": "grass" | "water" | "coast" | "road" | null,
    "northwest": "grass" | "water" | "coast" | "road" | null,
    "northeast": "grass" | "water" | "coast" | "road" | null
  }
}

If an edge has no connection (solid wall, closed), use null.
Only include edges that have visible connections.`

    const userPrompt = `Analyze these 6 images of a hexagonal tile. Each image shows the tile from a different angle, focusing on one edge.

CRITICAL: The tile is oriented with NORTH at the TOP and SOUTH at the BOTTOM (standard map orientation).

Tile context:
- Type: ${tileType || 'unknown'}
- Biome: ${biome || 'unknown'}

Image order (one image per edge, viewed from outside):
1. East (E) - RIGHT side of the tile (0°)
2. Southeast (SE) - RIGHT-BOTTOM edge (60°)
3. Southwest (SW) - LEFT-BOTTOM edge (120°)
4. West (W) - LEFT side of the tile (180°)
5. Northwest (NW) - LEFT-TOP edge (240°) - this is NORTH direction
6. Northeast (NE) - RIGHT-TOP edge (300°) - this is NORTH direction

Remember: NORTH is at the TOP, SOUTH is at the BOTTOM.

For each image, determine:
1. Does this edge have a connection? (open path, not a solid wall)
2. If yes, what type? (grass, water, coast, or road)

Look for visual indicators:
- Grass: Green textures, vegetation, flat land surface
- Water: Blue colors, reflective surfaces, water textures
- Coast: Sandy/beach textures, transition between land and water
- Road: Brown/dirt textures, path-like surfaces

Return ONLY the JSON object with connections.`

    // Формируем сообщения для vision API
    // OpenAI-совместимый формат для vision моделей
    // Некоторые серверы требуют полный data URL, другие - только base64
    const imageUrls = images.map((img: string) => {
      if (img.startsWith('data:image/')) {
        return img // Уже полный data URL
      }
      // Если только base64, добавляем префикс
      return `data:image/png;base64,${img}`
    })

    const messages: any[] = [
      { role: 'system', content: systemMessage },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          ...imageUrls.map((url: string) => ({
            type: 'image_url',
            image_url: {
              url,
            },
          })),
        ],
      },
    ]

    // Вызываем локальный vision API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 минут

    let response: Response
    try {
      response = await fetch(`${localUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3, // Низкая температура для более точных результатов
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout: Vision analysis took too long (over 5 minutes)')
      }
      throw error
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Vision API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Парсим JSON ответ
    let parsedResponse: { connections: TileConnections }
    try {
      // Убираем markdown code blocks если есть
      let cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      // Удаляем reasoning блоки различных форматов
      // <think>...</think>
      cleanedContent = cleanedContent.replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '')
      // <think>...</think>
      cleanedContent = cleanedContent.replace(/<think>[\s\S]*?<\/think>/gi, '')
      // <reasoning>...</reasoning>
      cleanedContent = cleanedContent.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')

      // Ищем JSON объект в тексте (может быть после reasoning или другого текста)
      // Ищем первую открывающую скобку { и последнюю закрывающую }
      const firstBrace = cleanedContent.indexOf('{')
      const lastBrace = cleanedContent.lastIndexOf('}')

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedContent = cleanedContent.substring(firstBrace, lastBrace + 1)
      }

      // Дополнительная очистка: убираем лишние пробелы и переносы строк
      cleanedContent = cleanedContent.trim()

      console.log('[Vision API] Cleaned content for parsing:', cleanedContent.substring(0, 200))

      parsedResponse = JSON.parse(cleanedContent)
    } catch (e) {
      console.error('Failed to parse vision response:', e)
      console.error('Raw content:', content)
      throw new Error(`Failed to parse vision model response: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Валидация и нормализация ответа
    const connections: TileConnections = {}
    const validTypes = ['grass', 'water', 'coast', 'road', 'unknown']

    for (const dir of directions) {
      const value = parsedResponse.connections?.[dir.name as keyof TileConnections]
      if (value === null || value === undefined) {
        // Нет соединения - не добавляем в результат
        continue
      }
      if (typeof value === 'string' && validTypes.includes(value)) {
        connections[dir.name as keyof TileConnections] = value as any
      } else if (value === 'unknown') {
        // unknown тоже можно включить, но лучше null
        continue
      }
    }

    return NextResponse.json({
      success: true,
      connections,
    })
  } catch (error) {
    console.error('Error analyzing connections with vision:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

