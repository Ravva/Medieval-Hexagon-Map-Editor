import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Тестовый endpoint для проверки работы Gemini API
 * GET /api/llm/test - простая проверка подключения
 * POST /api/llm/test - тест с JSON Schema
 */
export async function GET() {
  // Диагностика: проверяем все переменные окружения, связанные с GEMINI
  const allEnvVars = Object.keys(process.env)
    .filter((key) => key.includes('GEMINI') || key.includes('API'))
    .reduce((acc, key) => {
      acc[key] = process.env[key] ? `***${process.env[key]?.slice(-4)}` : 'undefined'
      return acc
    }, {} as Record<string, string>)

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'GEMINI_API_KEY not found in environment variables',
        diagnostics: {
          nodeEnv: process.env.NODE_ENV,
          allGeminiVars: allEnvVars,
          envKeysCount: Object.keys(process.env).length,
          hint: 'Make sure .env.local exists in project root and dev server was restarted',
        },
      },
      { status: 500 }
    )
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    // Используем gemini-2.5-flash - большие лимиты токенов (1M input, 64K output)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    // Simple test - generate greeting
    const prompt = 'Say "Hello, Gemini API is working!" in JSON format: {"message": "your message here"}'

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    return NextResponse.json({
      success: true,
      message: 'Gemini API connection successful',
      apiKeyPresent: true,
      apiKeyLength: apiKey.length,
      apiKeyPreview: `***${apiKey.slice(-4)}`,
      response: text,
    })
  } catch (error) {
    console.error('Gemini API test error:', error)

    let errorMessage = error instanceof Error ? error.message : String(error)
    let errorCode = 500

    if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
      errorCode = 429
      errorMessage = 'API quota exceeded. Free tier has limited requests. Please wait before retrying.'
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        errorCode,
        apiKeyPresent: !!apiKey,
        hint: errorCode === 429
          ? 'The model gemini-1.5-flash should work in free tier. Wait a few minutes and try again.'
          : undefined,
      },
      { status: errorCode }
    )
  }
}

/**
 * Тест JSON Schema (структурированный вывод)
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY not found in environment variables' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json()
    const { testType = 'simple' } = body

    const genAI = new GoogleGenerativeAI(apiKey)

    if (testType === 'json-schema') {
      // Тест с JSON Schema
      // gemini-2.5-flash поддерживает JSON Schema через responseMimeType
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
              },
              status: {
                type: 'string',
                enum: ['success', 'error'],
              },
              data: {
                type: 'object',
                properties: {
                  testNumber: { type: 'number' },
                  testBoolean: { type: 'boolean' },
                },
                required: ['testNumber', 'testBoolean'],
              },
            },
            required: ['message', 'status', 'data'],
          },
        },
      })

      const prompt = 'Generate a test response with message "JSON Schema test successful", status "success", and data with testNumber=42 and testBoolean=true'

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      // Парсим JSON ответ
      let parsedResponse
      try {
        parsedResponse = JSON.parse(text)
      } catch (e) {
        parsedResponse = { raw: text }
      }

      return NextResponse.json({
        success: true,
        testType: 'json-schema',
        response: parsedResponse,
        rawText: text,
      })
    } else if (testType === 'hex-map-sample') {
      // Тест генерации небольшого примера гексагональной карты
      // gemini-2.5-flash идеальна для больших промптов (1M токенов input)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              hexes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    q: { type: 'integer', minimum: 0, maximum: 5 },
                    r: { type: 'integer', minimum: 0, maximum: 5 },
                    tile_id: { type: 'string' },
                    rotation: { type: 'integer', minimum: 0, maximum: 300 },
                    height: { type: 'integer', minimum: 0, maximum: 4 },
                  },
                  required: ['q', 'r', 'tile_id', 'rotation', 'height'],
                },
              },
            },
            required: ['hexes'],
          },
        },
      })

      const prompt = `Generate a small 3x3 hex map example (q: 0-2, r: 0-2).
Use tile_id values like "tiles_base_hex_grass", "tiles_base_hex_water", "tiles_base_hex_forest".
Create a simple pattern: center should be water (q=1, r=1), surrounded by grass tiles.
Rotation must be one of: 0, 60, 120, 180, 240, or 300 degrees.
Return exactly 9 hexes (all combinations of q and r from 0 to 2).`

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      let parsedResponse
      try {
        parsedResponse = JSON.parse(text)
      } catch (e) {
        parsedResponse = { raw: text, error: 'Failed to parse JSON' }
      }

      return NextResponse.json({
        success: true,
        testType: 'hex-map-sample',
        response: parsedResponse,
        rawText: text,
      })
    } else {
      // Простой тест (по умолчанию)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      const prompt = 'Say "Hello from Gemini!" in a JSON object with a "greeting" field'

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      return NextResponse.json({
        success: true,
        testType: 'simple',
        response: text,
      })
    }
  } catch (error) {
    console.error('Gemini API test error:', error)

    // Обработка специфических ошибок API
    let errorMessage = error instanceof Error ? error.message : String(error)
    let errorCode = 500
    let retryAfter: number | undefined

    // Проверка на ошибку квоты (429)
    if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
      errorCode = 429
      errorMessage = 'API quota exceeded. Free tier has limited requests. Please wait before retrying or check your billing.'

      // Попытка извлечь время повтора из ошибки
      const retryMatch = errorMessage.match(/retry in ([\d.]+)s/i)
      if (retryMatch) {
        retryAfter = Math.ceil(parseFloat(retryMatch[1]))
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        errorCode,
        retryAfter,
        hint: errorCode === 429
          ? 'Try again later or use a different model (gemini-1.5-flash is used now). Check https://ai.google.dev/gemini-api/docs/rate-limits'
          : undefined,
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
      },
      { status: errorCode }
    )
  }
}

