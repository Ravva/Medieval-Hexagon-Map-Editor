import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
    const assetsPath = path.join(process.cwd(), 'assets', 'terrain')

    try {
        const categories = fs.readdirSync(assetsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(categoryDirent => {
                const categoryPath = path.join(assetsPath, categoryDirent.name)
                const subfolders = fs.readdirSync(categoryPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(subfolderDirent => {
                        const folderPath = path.join(categoryPath, subfolderDirent.name)
                        const files = fs.readdirSync(folderPath)

                        const models: any[] = []
                        const processed = new Set<string>()

                        files.forEach(file => {
                            if (file.endsWith('.obj')) {
                                const name = file.replace('.obj', '')
                                const mtl = file.replace('.obj', '.mtl')
                                if (files.includes(mtl)) {
                                    models.push({
                                        name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                        obj: `/assets/terrain/${categoryDirent.name}/${subfolderDirent.name}/${file}`,
                                        mtl: `/assets/terrain/${categoryDirent.name}/${subfolderDirent.name}/${mtl}`
                                    })
                                }
                            }
                        })

                        return {
                            name: subfolderDirent.name,
                            models
                        }
                    })
                    .filter(f => f.models.length > 0)

                return {
                    name: categoryDirent.name,
                    folders: subfolders
                }
            })
            .filter(c => c.folders.length > 0)

        return NextResponse.json({ categories })
    } catch (error) {
        console.error('Error scanning assets:', error)
        return NextResponse.json({ categories: [] }, { status: 500 })
    }
}
