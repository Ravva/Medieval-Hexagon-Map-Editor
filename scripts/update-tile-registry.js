const fs = require('fs')
const path = require('path')

const registryPath = path.join(__dirname, '..', 'lib', 'llm', 'tile-registry.json')
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))

registry.tiles = registry.tiles.map(tile => {
  tile.is_base_tile = tile.category === 'tiles'
  return tile
})

registry.version = '1.1'
registry.generatedAt = new Date().toISOString()

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))

console.log(`Updated ${registry.tiles.length} tiles with is_base_tile field`)
console.log(`Base tiles: ${registry.tiles.filter(t => t.is_base_tile).length}`)
console.log(`Non-base tiles: ${registry.tiles.filter(t => !t.is_base_tile).length}`)
