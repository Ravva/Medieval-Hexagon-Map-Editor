/**
 * Utility functions for handling asset paths in different environments
 */

/**
 * Get the base path for the application
 * For GitHub Pages repository deployment
 */
export function getBasePath(): string {
  return '/Medieval-Hexagon-Map-Editor'
}

/**
 * Convert asset path to work with GitHub Pages
 * In production: /assets/... -> /Medieval-Hexagon-Map-Editor/assets/...
 * In development: /assets/... -> /api/assets/... (API route)
 */
export function getAssetPath(path: string): string {
  if (!path.startsWith('/assets/')) {
    return path
  }

  const basePath = getBasePath()

  let result: string
  if (process.env.NODE_ENV === 'production' || basePath) {
    // In production, assets are served statically from public/assets
    result = `${basePath}${path}`
  } else {
    // In development, assets are served through API route
    result = path.replace('/assets/', '/api/assets/')
  }

  // Debug logging
  if (typeof window !== 'undefined') {
    console.log('Asset path conversion:', {
      original: path,
      basePath,
      nodeEnv: process.env.NODE_ENV,
      result
    })
  }

  return result
}

/**
 * Get the full URL for an asset
 */
export function getAssetUrl(path: string): string {
  const assetPath = getAssetPath(path)

  // Debug logging in development
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.log('Asset path conversion:', { original: path, converted: assetPath })
  }

  if (typeof window !== 'undefined') {
    return new URL(assetPath, window.location.origin).href
  }
  return assetPath
}
