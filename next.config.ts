import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

  // Turbopack настройки (используется с --turbo флагом)
  // Turbopack быстрее webpack в 10-700 раз для dev сборки
  // Для production сборки используем webpack (стабильнее)
  turbopack: {
    resolveAlias: {
      '@': path.resolve(__dirname),
    },
  },

  // Webpack конфигурация (используется для production build)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
    }

    // Handle Three.js and other modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    }

    return config
  },

  // Assets доступны через /assets/* (rewrite на /api/assets/*)
  async rewrites() {
    return [
      {
        source: '/assets/:path*',
        destination: '/api/assets/:path*',
      },
    ]
  },
}

export default nextConfig
