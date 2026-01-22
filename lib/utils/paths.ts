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
 * In development: /assets/... -> /api/assets/...
 * In production: /assets/... -> /Medieval-Hexagon-Map-Editor/assets/...
 */
export function getAssetPath(path: string): string {
  if (!path.startsWith('/assets/')) {
    return path
  }

  const basePath = getBasePath()

  if (process.env.NODE_ENV === 'production') {
    // In production, assets are served statically
    return `${basePath}${path}`
  } else {
    // In development, assets are served through API route
    return path.replace('/assets/', '/api/assets/')
  }
}

/**
 * Get the full URL for an asset
 */
export function getAssetUrl(path: string): string {
  if (typeof window !== 'undefined') {
    return new URL(getAssetPath(path), window.location.origin).href
  }
  return getAssetPath(path)
}
