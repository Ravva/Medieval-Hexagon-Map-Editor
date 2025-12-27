import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Простой тест для проверки различных имен моделей
 * GET /api/llm/test-simple?model=MODEL_NAME
 */
export async function GET(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY not found' },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(request.url)
  const modelName = searchParams.get('model') || 'gemini-2.5-flash'

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: modelName })

    const result = await model.generateContent('Say "Hello" in JSON: {"message":"hello"}')
    const response = await result.response
    const text = response.text()

    return NextResponse.json({
      success: true,
      model: modelName,
      response: text,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        success: false,
        model: modelName,
        error: errorMessage,
        hint: 'Try different model names: gemini-2.5-flash, gemini-pro, gemini-1.5-pro',
      },
      { status: 500 }
    )
  }
}

