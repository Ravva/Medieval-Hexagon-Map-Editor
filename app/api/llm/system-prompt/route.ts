import { NextRequest, NextResponse } from 'next/server'
import { promptManager } from '@/lib/llm/PromptManager'

/**
 * GET - Load system prompt configuration
 */
export async function GET() {
  try {
    const config = promptManager.getRawConfig()
    return NextResponse.json(config)
  } catch (error) {
    console.error('Error loading system prompt:', error)
    return NextResponse.json(
      { error: 'Failed to load system prompt configuration' },
      { status: 500 }
    )
  }
}

/**
 * POST - Save system prompt configuration
 */
export async function POST(request: NextRequest) {
  try {
    const config = await request.json()

    // Validate required fields
    if (!config.systemMessage || !config.userPromptTemplate) {
      return NextResponse.json(
        { error: 'systemMessage and userPromptTemplate are required' },
        { status: 400 }
      )
    }

    // Save configuration
    promptManager.saveConfig(config)

    return NextResponse.json({
      success: true,
      message: 'System prompt configuration saved successfully'
    })
  } catch (error) {
    console.error('Error saving system prompt:', error)
    return NextResponse.json(
      { error: 'Failed to save system prompt configuration' },
      { status: 500 }
    )
  }
}
