import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Endpoint для получения списка доступных моделей Gemini
 * GET /api/llm/list-models
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY not found in environment variables' },
      { status: 500 }
    )
  }

  try {
    // Попытка получить список моделей через REST API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    )

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        {
          error: `Failed to fetch models: ${response.status} ${response.statusText}`,
          details: errorText,
        },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Фильтруем модели, которые поддерживают generateContent
    const availableModels = (data.models || [])
      .filter((model: any) => {
        const methods = model.supportedGenerationMethods || []
        return methods.includes('generateContent')
      })
      .map((model: any) => ({
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        supportedMethods: model.supportedGenerationMethods,
        inputTokenLimit: model.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit,
      }))

    return NextResponse.json({
      success: true,
      models: availableModels,
      total: availableModels.length,
      allModels: data.models?.map((m: any) => m.name) || [],
    })
  } catch (error) {
    console.error('Error fetching models:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        hint: 'Check if API key is valid and has access to list models',
      },
      { status: 500 }
    )
  }
}

