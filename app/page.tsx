'use client'

import dynamic from 'next/dynamic'

// Динамический импорт с отключенным SSR для MapEditor (использует Three.js и Canvas)
const MapEditor = dynamic(() => import('@/components/MapEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="text-lg">Загрузка редактора карт...</div>
    </div>
  ),
})

export default function Home() {
  return (
    <div className="h-screen w-screen">
      <MapEditor />
    </div>
  )
}
