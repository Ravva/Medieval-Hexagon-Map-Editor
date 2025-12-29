import { NextRequest, NextResponse } from 'next/server'
import type { TileConnections } from '@/lib/llm/TileConnectionAnalyzer'

export const maxDuration = 300 // 5 минут для vision анализа

/**
 * Analyze tile connections using vision model
 * POST /api/llm/analyze-connections-vision
 *
 * Body:
 * {
 *   image: string, // Base64 encoded image of the tile
 *   localUrl: string,
 *   model: string,
 *   tileType?: 'river' | 'road' | 'coast' | 'base' | 'other',
 *   biome?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { image, localUrl, model, tileType, biome } = body

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'Image is required as base64 string' },
        { status: 400 }
      )
    }

    if (!localUrl || !model) {
      return NextResponse.json(
        { error: 'localUrl and model are required' },
        { status: 400 }
      )
    }

    // Создаем промпт для vision модели
    const systemMessage = `You are an expert at analyzing 3D hexagonal tile models for a grid-based game.
Your task is to determine the connection type for each of the 6 edges of a hexagonal tile by analyzing the PHYSICAL EDGES between the top hexagonal surface and side faces.

CRITICAL UNDERSTANDING - PHYSICAL EDGE DETECTION:
- A connection exists ONLY where there is a PHYSICAL EDGE/LINE between the top hexagonal surface and a side face
- If you see an "empty space" or "cliff" (no connecting line), there is NO connection (use null)
- If you see a clear LINE/EDGE between top surface and side face, there IS a connection
- The connection type is determined by the COLOR/TEXTURE of that edge area

IMPORTANT ORIENTATION: The tile is viewed from a 3/4 isometric perspective where:
- The hexagon is "flat-topped" (two horizontal edges at top and bottom)
- NORTH is at the TOP of the image
- SOUTH is at the BOTTOM of the image
- You can see the top surface and some side faces
- Some edges may be "missing" (cliffs/empty space) while others have clear connecting lines

ANALYSIS METHOD:
1. Look at each of the 6 hexagon directions (going clockwise from East)
2. Check if there is a VISIBLE EDGE/LINE between the top surface and that direction
3. If NO edge line visible (empty space/cliff) → use null (no connection)
4. If edge line IS visible → determine connection type by the color/texture of that edge area

Connection types for EXISTING physical edges:
- "grass": Green colors, vegetation textures, land surface
- "water": Blue/white colors, water-like textures, reflective surfaces
- "coast": Sandy/beige colors with grass, beach-like textures, coastal transition areas
- "road": Narrow strip of sandy/beige color with lots of grass around it, path-like surface

EDGE IDENTIFICATION GUIDE:
- Look for clear LINES where the top hexagonal surface meets side faces
- Missing edges appear as "empty space" or "cliffs" with no connecting geometry
- Present edges show as clear boundaries between top surface and side faces
- The color of the edge area determines the connection type

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

Use null for directions where no physical edge exists (empty space/cliff).`

    const userPrompt = `Analyze this image of a hexagonal tile viewed from a 3/4 perspective angle.

CRITICAL ORIENTATION:
- The hexagon is "flat-topped" with NORTH at the TOP and SOUTH at the BOTTOM
- You can see the top surface and some side edges from this viewing angle
- The tile appears to have connections on certain edges based on color/texture

Tile context:
- Type: ${tileType || 'unknown'}
- Biome: ${biome || 'unknown'}

ANALYSIS INSTRUCTIONS:
Look at each of the 6 hexagon edges in this order (clockwise from East):
1. East (E) - Right side of the hexagon
2. Southeast (SE) - Right-bottom edge
3. Southwest (SW) - Left-bottom edge
4. West (W) - Left side of the hexagon
5. Northwest (NW) - Left-top edge (NORTH direction)
6. Northeast (NE) - Right-top edge (NORTH direction)

For each edge, examine:
- Is there a VISIBLE EDGE/LINE between the top surface and that direction?
- If NO line visible (empty space/cliff) → null (no connection)
- If line IS visible → determine connection type by color/texture of that edge area

Visual indicators for connection types (for EXISTING edges only):
- Grass: Green colors, vegetation textures
- Water: Blue/white colors, water/reflective textures
- Coast: Sandy/beige colors with grass, beach textures, coastal areas
- Road: Narrow sandy/beige strip with lots of grass around it, path textures

EXAMPLE: In the provided image, you should see:
- Some edges have clear lines between top surface and side faces (connections exist)
- Some edges show empty space/cliffs (no connections, use null)
- For existing edges, determine type by color: grass (green), water (blue/white), coast (sandy+grass), road (narrow sandy strip)

Return ONLY the JSON object with connections. Use null for edges with no physical connection (empty space/cliff).`

    // Формируем сообщения для vision API
    // OpenAI-совместимый формат для vision моделей
    const imageUrl = image.startsWith('data:image/') ? image : `data:image/png;base64,${image}`

    const messages: any[] = [
      { role: 'system', content: systemMessage },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
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
    const validTypes = ['grass', 'water', 'coast', 'road']
    const directions = ['east', 'southeast', 'southwest', 'west', 'northwest', 'northeast']

    for (const dir of directions) {
      const value = parsedResponse.connections?.[dir as keyof TileConnections]
      if (value === null || value === undefined) {
        // Нет соединения - не добавляем в результат
        continue
      }
      if (typeof value === 'string' && validTypes.includes(value)) {
        connections[dir as keyof TileConnections] = value as any
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

