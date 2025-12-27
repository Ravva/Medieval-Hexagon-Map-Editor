import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathArray } = await params
  const filePath = pathArray.join('/')
  const assetsPath = path.join(process.cwd(), 'assets', filePath)

  try {
    // Проверяем, что путь находится внутри папки assets
    const resolvedPath = path.resolve(assetsPath)
    const assetsDir = path.resolve(process.cwd(), 'assets')
    if (!resolvedPath.startsWith(assetsDir)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Проверяем существование файла
    if (!fs.existsSync(assetsPath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const stats = fs.statSync(assetsPath)
    if (!stats.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 })
    }

    // Определяем MIME тип
    const ext = path.extname(assetsPath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.obj': 'text/plain',
      '.mtl': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.json': 'application/json',
    }
    const contentType = mimeTypes[ext] || 'application/octet-stream'

    // Читаем и возвращаем файл
    const fileBuffer = fs.readFileSync(assetsPath)
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Error serving asset:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

