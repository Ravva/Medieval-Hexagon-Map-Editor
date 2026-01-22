import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

  // GitHub Pages configuration
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  // Base path for GitHub Pages (repository name)
  basePath: process.env.NODE_ENV === 'production' ? '/Medieval-Hexagon-Map-Editor' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/Medieval-Hexagon-Map-Editor/' : '',

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

  // Assets доступны через /assets/* (только для dev режима)
  // В production режиме API routes не работают со статическим экспортом
  // Убираем rewrites для статического экспорта
}

export default nextConfig
