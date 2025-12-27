import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Warlords Clone - Редактор карт',
  description: '3D редактор карт для игры Warlords Clone',
}

import { TooltipProvider } from '@/components/ui/tooltip'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className="antialiased font-sans" suppressHydrationWarning>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </body>
    </html>
  )
}
