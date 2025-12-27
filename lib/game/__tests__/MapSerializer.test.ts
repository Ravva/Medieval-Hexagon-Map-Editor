import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MapSerializer, type MapFileFormat, type MapFileFormatV1 } from '../MapSerializer'
import { Map as GameMap } from '../Map'
import { Hex, TERRAIN_TYPES } from '../Hex'

describe('MapSerializer', () => {
  let map: GameMap

  beforeEach(() => {
    map = new GameMap(10, 10)
  })

  describe('serialize', () => {
    it('should serialize empty map', () => {
      const jsonString = MapSerializer.serialize(map, 'small')
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.version).toBe('2.0')
      expect(parsed.format).toBe('warlords-map')
      expect(parsed.map.width).toBe(10)
      expect(parsed.map.height).toBe(10)
      expect(parsed.metadata.mapSize).toBe('small')
      expect(Object.keys(parsed.hexes).length).toBe(0)
    })

    it('should serialize map with hexes', () => {
      const hex1 = new Hex(0, 0, TERRAIN_TYPES.PLAINS)
      hex1.height = 0
      map.setHex(0, 0, hex1)

      const hex2 = new Hex(5, 0, TERRAIN_TYPES.FOREST)
      hex2.height = 1
      hex2.rotation = Math.PI / 3
      map.setHex(5, 0, hex2)

      const jsonString = MapSerializer.serialize(map, 'medium')
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.hexes['0,0']).toBeDefined()
      expect(parsed.hexes['0,0'].length).toBe(1)
      expect(parsed.hexes['0,0'][0].q).toBe(0)
      expect(parsed.hexes['0,0'][0].r).toBe(0)
      expect(parsed.hexes['0,0'][0].terrain).toBe(TERRAIN_TYPES.PLAINS)
      expect(parsed.hexes['0,0'][0].height).toBe(0)
      expect(parsed.hexes['0,0'][0].rotation).toBeUndefined() // Default value omitted

      expect(parsed.hexes['5,0']).toBeDefined()
      expect(parsed.hexes['5,0'][0].terrain).toBe(TERRAIN_TYPES.FOREST)
      expect(parsed.hexes['5,0'][0].height).toBe(1)
      expect(parsed.hexes['5,0'][0].rotation).toBeCloseTo(Math.PI / 3)
    })

    it('should serialize hex stacks (multiple hexes at same position)', () => {
      const hex1 = new Hex(3, 0, TERRAIN_TYPES.PLAINS)
      hex1.height = 0
      map.setHex(3, 0, hex1)

      const hex2 = new Hex(3, 0, TERRAIN_TYPES.FOREST)
      hex2.height = 1
      map.setHex(3, 0, hex2)

      const jsonString = MapSerializer.serialize(map, 'small')
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.hexes['3,0']).toBeDefined()
      expect(parsed.hexes['3,0'].length).toBe(2)
      expect(parsed.hexes['3,0'][0].height).toBe(0)
      expect(parsed.hexes['3,0'][1].height).toBe(1)
    })

    it('should serialize model data', () => {
      const hex = new Hex(1, 0, TERRAIN_TYPES.MOUNTAIN)
      hex.height = 0
      hex.modelData = {
        obj: '/assets/tile.obj',
        mtl: '/assets/tile.mtl',
        name: 'tile_01',
      }
      map.setHex(1, 0, hex)

      const jsonString = MapSerializer.serialize(map, 'small')
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.hexes['1,0'][0].modelData).toBeDefined()
      expect(parsed.hexes['1,0'][0].modelData?.obj).toBe('/assets/tile.obj')
      expect(parsed.hexes['1,0'][0].modelData?.mtl).toBe('/assets/tile.mtl')
      expect(parsed.hexes['1,0'][0].modelData?.name).toBe('tile_01')
    })

    it('should serialize buildings', () => {
      const buildingData = new Map<string, { obj: string; mtl: string; name: string }>()
      buildingData.set('5,0', {
        obj: '/assets/building.obj',
        mtl: '/assets/building.mtl',
        name: 'building_01',
      })

      const jsonString = MapSerializer.serialize(map, 'small', {
        includeBuildings: true,
        buildingData,
      })
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.buildings).toBeDefined()
      expect(parsed.buildings?.length).toBe(1)
      expect(parsed.buildings?.[0].q).toBe(5)
      expect(parsed.buildings?.[0].r).toBe(0)
      expect(parsed.buildings?.[0].modelData.name).toBe('building_01')
    })

    it('should include metadata', () => {
      const jsonString = MapSerializer.serialize(map, 'large', {
        name: 'Test Map',
        description: 'A test map',
      })
      const parsed = JSON.parse(jsonString) as MapFileFormat

      expect(parsed.metadata.name).toBe('Test Map')
      expect(parsed.metadata.description).toBe('A test map')
      expect(parsed.metadata.mapSize).toBe('large')
      expect(parsed.metadata.createdAt).toBeTypeOf('number')
      expect(parsed.metadata.modifiedAt).toBeTypeOf('number')
    })
  })

  describe('deserialize', () => {
    it('should deserialize empty map', () => {
      const mapFile: MapFileFormat = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {},
      }

      const jsonString = JSON.stringify(mapFile)
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      expect(deserializedMap.width).toBe(10)
      expect(deserializedMap.height).toBe(10)

      // Check that map is empty
      expect(deserializedMap.hexes.size).toBe(0)
    })

    it('should deserialize map with hexes (version 2.0)', () => {
      const mapFile: MapFileFormat = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'medium',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {
          '0,0': [
            {
              q: 0,
              r: 0,
              terrain: TERRAIN_TYPES.PLAINS,
              height: 0,
            },
          ],
          '5,0': [
            {
              q: 5,
              r: 0,
              terrain: TERRAIN_TYPES.FOREST,
              height: 1,
              rotation: Math.PI / 3,
            },
          ],
        },
      }

      const jsonString = JSON.stringify(mapFile)
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      const hex1 = deserializedMap.getHex(0, 0, 0)
      expect(hex1).toBeDefined()
      expect(hex1?.terrain).toBe(TERRAIN_TYPES.PLAINS)
      expect(hex1?.height).toBe(0)

      const hex2 = deserializedMap.getHex(5, 0, 1)
      expect(hex2).toBeDefined()
      expect(hex2?.terrain).toBe(TERRAIN_TYPES.FOREST)
      expect(hex2?.height).toBe(1)
      expect(hex2?.rotation).toBeCloseTo(Math.PI / 3)
    })

    it('should migrate from version 1.0 to 2.0', () => {
      const mapFileV1: MapFileFormatV1 = {
        version: '1.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {
          '0,0': [
            {
              x: 0,
              y: 0,
              terrain: TERRAIN_TYPES.PLAINS,
              height: 0,
            },
          ],
          '1,0': [
            {
              x: 1,
              y: 0,
              terrain: TERRAIN_TYPES.FOREST,
              height: 1,
            },
          ],
        },
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const jsonString = JSON.stringify(mapFileV1)
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      // Migration should convert offset to axial
      // offset(0,0) -> axial(0,0)
      const hex1 = deserializedMap.getHex(0, 0, 0)
      expect(hex1).toBeDefined()
      expect(hex1?.terrain).toBe(TERRAIN_TYPES.PLAINS)

      // offset(1,0) -> axial(1,0)
      const hex2 = deserializedMap.getHex(1, 0, 1)
      expect(hex2).toBeDefined()
      expect(hex2?.terrain).toBe(TERRAIN_TYPES.FOREST)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Map version 1.0 detected')
      )

      consoleSpy.mockRestore()
    })

    it('should deserialize hex stacks', () => {
      const mapFile: MapFileFormat = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {
          '3,0': [
            {
              q: 3,
              r: 0,
              terrain: TERRAIN_TYPES.PLAINS,
              height: 0,
            },
            {
              q: 3,
              r: 0,
              terrain: TERRAIN_TYPES.FOREST,
              height: 1,
            },
          ],
        },
      }

      const jsonString = JSON.stringify(mapFile)
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      const stack = deserializedMap.getHexStack(3, 0)
      expect(stack.length).toBe(2)
      expect(stack[0].height).toBe(0)
      expect(stack[1].height).toBe(1)
    })

    it('should deserialize model data', () => {
      const mapFile: MapFileFormat = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {
          '1,0': [
            {
              q: 1,
              r: 0,
              terrain: TERRAIN_TYPES.MOUNTAIN,
              height: 0,
              modelData: {
                obj: '/assets/tile.obj',
                mtl: '/assets/tile.mtl',
                name: 'tile_01',
              },
            },
          ],
        },
      }

      const jsonString = JSON.stringify(mapFile)
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      const hex = deserializedMap.getHex(1, 0, 0)
      expect(hex?.modelData).toBeDefined()
      expect(hex?.modelData?.obj).toBe('/assets/tile.obj')
      expect(hex?.modelData?.mtl).toBe('/assets/tile.mtl')
      expect(hex?.modelData?.name).toBe('tile_01')
    })

    it('should throw error for invalid format', () => {
      const invalidFile = {
        format: 'invalid-format',
        version: '2.0',
      }

      expect(() => {
        MapSerializer.deserialize(JSON.stringify(invalidFile))
      }).toThrow('Invalid map format')
    })

    it('should warn about version mismatch but still load', () => {
      const mapFile: MapFileFormat = {
        version: '2.1', // Future version
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {},
      }

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const jsonString = JSON.stringify(mapFile)

      expect(() => {
        MapSerializer.deserialize(jsonString)
      }).not.toThrow()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Map version mismatch')
      )

      consoleSpy.mockRestore()
    })
  })

  describe('validate', () => {
    it('should validate correct map file', () => {
      const mapFile: MapFileFormat = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
        hexes: {},
      }

      const validation = MapSerializer.validate(mapFile)
      expect(validation.valid).toBe(true)
      expect(validation.errors.length).toBe(0)
    })

    it('should reject invalid format', () => {
      const invalidFile = {
        format: 'wrong-format',
        version: '2.0',
      }

      const validation = MapSerializer.validate(invalidFile)
      expect(validation.valid).toBe(false)
      expect(validation.errors.some(err => err.includes('Invalid format'))).toBe(true)
    })

    it('should reject missing version', () => {
      const invalidFile = {
        format: 'warlords-map',
        map: { width: 10, height: 10 },
        hexes: {},
      }

      const validation = MapSerializer.validate(invalidFile)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing version field')
    })

    it('should reject invalid map dimensions', () => {
      const invalidFile: Partial<MapFileFormat> = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: -1,
          height: 10,
        },
        hexes: {},
      }

      const validation = MapSerializer.validate(invalidFile)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Invalid map width')
    })

    it('should reject missing hexes field', () => {
      const invalidFile: Partial<MapFileFormat> = {
        version: '2.0',
        format: 'warlords-map',
        metadata: {
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          mapSize: 'small',
        },
        map: {
          width: 10,
          height: 10,
        },
      }

      const validation = MapSerializer.validate(invalidFile)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing or invalid hexes field')
    })

    it('should reject missing metadata', () => {
      const invalidFile: Partial<MapFileFormat> = {
        version: '2.0',
        format: 'warlords-map',
        map: {
          width: 10,
          height: 10,
        },
        hexes: {},
      }

      const validation = MapSerializer.validate(invalidFile)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing metadata field')
    })
  })

  describe('estimateSize', () => {
    it('should estimate size for empty map', () => {
      const size = MapSerializer.estimateSize(map)
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThan(1000) // Base overhead
    })

    it('should estimate size for map with hexes', () => {
      for (let i = 0; i < 5; i++) {
        const hex = new Hex(i, 0, TERRAIN_TYPES.PLAINS)
        hex.height = 0
        map.setHex(i, 0, hex)
      }

      const size = MapSerializer.estimateSize(map)
      expect(size).toBeGreaterThan(500) // Base + 5 hexes
    })
  })

  describe('round-trip serialization', () => {
    it('should preserve all hex data through serialize/deserialize', () => {
      // Create complex map
      const hex1 = new Hex(0, 0, TERRAIN_TYPES.PLAINS)
      hex1.height = 0
      hex1.rotation = Math.PI / 4
      hex1.modelData = {
        obj: '/assets/tile.obj',
        mtl: '/assets/tile.mtl',
        name: 'tile_01',
      }
      hex1.hasRiver = true
      map.setHex(0, 0, hex1)

      const hex2 = new Hex(0, 0, TERRAIN_TYPES.FOREST)
      hex2.height = 1
      map.setHex(0, 0, hex2)

      // Serialize and deserialize
      const jsonString = MapSerializer.serialize(map, 'small')
      const { map: deserializedMap } = MapSerializer.deserialize(jsonString)

      // Verify first hex
      const deserializedHex1 = deserializedMap.getHex(0, 0, 0)
      expect(deserializedHex1?.terrain).toBe(TERRAIN_TYPES.PLAINS)
      expect(deserializedHex1?.height).toBe(0)
      expect(deserializedHex1?.rotation).toBeCloseTo(Math.PI / 4)
      expect(deserializedHex1?.modelData?.name).toBe('tile_01')
      expect(deserializedHex1?.hasRiver).toBe(true)

      // Verify second hex
      const deserializedHex2 = deserializedMap.getHex(0, 0, 1)
      expect(deserializedHex2?.terrain).toBe(TERRAIN_TYPES.FOREST)
      expect(deserializedHex2?.height).toBe(1)
    })
  })
})
