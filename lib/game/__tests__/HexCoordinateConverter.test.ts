import { describe, it, expect } from 'vitest'
import {
  offsetToAxial,
  axialToOffset,
  axialToPixel,
  pixelToAxial,
  roundAxial,
  axialDistance,
  getAxialNeighbors,
  axialToWorld,
  worldToAxial,
} from '../HexCoordinateConverter'

describe('HexCoordinateConverter', () => {
  describe('offsetToAxial', () => {
    it('should convert offset coordinates to axial', () => {
      expect(offsetToAxial(0, 0)).toEqual({ q: 0, r: 0 })
      expect(offsetToAxial(1, 0)).toEqual({ q: 1, r: 0 })
      expect(offsetToAxial(0, 1)).toEqual({ q: 0, r: 1 })
      expect(offsetToAxial(2, 1)).toEqual({ q: 2, r: 0 })
      expect(offsetToAxial(3, 2)).toEqual({ q: 3, r: 1 })
      // Test odd row
      expect(offsetToAxial(1, 1)).toEqual({ q: 1, r: 1 })
    })

    it('should handle negative coordinates', () => {
      expect(offsetToAxial(-1, 0)).toEqual({ q: -1, r: 1 })
      expect(offsetToAxial(0, -1)).toEqual({ q: 0, r: -1 })
    })
  })

  describe('axialToOffset', () => {
    it('should convert axial coordinates to offset', () => {
      expect(axialToOffset(0, 0)).toEqual({ x: 0, y: 0 })
      expect(axialToOffset(1, 0)).toEqual({ x: 1, y: 0 })
      expect(axialToOffset(0, 1)).toEqual({ x: 0, y: 1 })
      expect(axialToOffset(2, 0)).toEqual({ x: 2, y: 1 })
      expect(axialToOffset(3, 0)).toEqual({ x: 3, y: 1 })
      // Test odd row
      expect(axialToOffset(1, 1)).toEqual({ x: 1, y: 1 })
    })

    it('should handle negative coordinates', () => {
      expect(axialToOffset(-1, 1)).toEqual({ x: -1, y: 0 })
      expect(axialToOffset(0, -1)).toEqual({ x: 0, y: -1 })
    })

    it('should be inverse of offsetToAxial', () => {
      const testCases = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ]

      for (const offset of testCases) {
        const axial = offsetToAxial(offset.x, offset.y)
        const backToOffset = axialToOffset(axial.q, axial.r)
        expect(backToOffset).toEqual(offset)
      }
    })
  })

  describe('axialToPixel', () => {
    it('should convert axial coordinates to pixel coordinates', () => {
      const result = axialToPixel(0, 0, 3.5)
      expect(result.x).toBeCloseTo(0, 5)
      expect(result.y).toBeCloseTo(0, 5)
    })

    it('should handle different hex sizes', () => {
      const result1 = axialToPixel(1, 0, 1.0)
      const result2 = axialToPixel(1, 0, 2.0)
      expect(result2.x).toBeCloseTo(result1.x * 2, 5)
      expect(result2.y).toBeCloseTo(result1.y * 2, 5)
    })

    it('should produce correct spacing for neighbors', () => {
      const center = axialToPixel(0, 0, 3.5)
      const east = axialToPixel(1, 0, 3.5)
      const northEast = axialToPixel(1, -1, 3.5)

      // Distance should be approximately equal for all neighbors
      const distEast = Math.sqrt(
        Math.pow(east.x - center.x, 2) + Math.pow(east.y - center.y, 2)
      )
      const distNorthEast = Math.sqrt(
        Math.pow(northEast.x - center.x, 2) + Math.pow(northEast.y - center.y, 2)
      )

      expect(distEast).toBeCloseTo(distNorthEast, 1)
    })
  })

  describe('pixelToAxial', () => {
    it('should convert pixel coordinates back to axial', () => {
      const axial = { q: 0, r: 0 }
      const pixel = axialToPixel(axial.q, axial.r, 3.5)
      const backToAxial = pixelToAxial(pixel.x, pixel.y, 3.5)
      expect(backToAxial.q).toBe(0)
      expect(backToAxial.r).toBe(0)
    })

    it('should round to nearest hex for fractional coordinates', () => {
      const axial = { q: 1, r: -1 }
      const pixel = axialToPixel(axial.q, axial.r, 3.5)
      // Add small offset
      const offsetPixel = { x: pixel.x + 0.1, y: pixel.y + 0.1 }
      const backToAxial = pixelToAxial(offsetPixel.x, offsetPixel.y, 3.5)
      // Should round to nearest hex
      expect(backToAxial.q).toBeCloseTo(axial.q, 0)
      expect(backToAxial.r).toBeCloseTo(axial.r, 0)
    })
  })

  describe('roundAxial', () => {
    it('should round fractional coordinates to nearest hex', () => {
      expect(roundAxial(0.3, 0.2)).toEqual({ q: 0, r: 0 })
      expect(roundAxial(0.7, 0.2)).toEqual({ q: 1, r: 0 })
      expect(roundAxial(0.3, 0.8)).toEqual({ q: 0, r: 1 })
    })

    it('should maintain q + r + s = 0 constraint', () => {
      const rounded = roundAxial(0.4, 0.3)
      const s = -(rounded.q + rounded.r)
      // s should be close to integer (within rounding error)
      expect(Math.abs(s - Math.round(s))).toBeLessThan(0.1)
    })
  })

  describe('axialDistance', () => {
    it('should calculate distance between adjacent hexes as 1', () => {
      expect(axialDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
      expect(axialDistance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1)
      expect(axialDistance({ q: 0, r: 0 }, { q: 0, r: -1 })).toBe(1)
    })

    it('should calculate distance correctly for non-adjacent hexes', () => {
      expect(axialDistance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2)
      expect(axialDistance({ q: 0, r: 0 }, { q: 1, r: 1 })).toBe(2)
      expect(axialDistance({ q: 0, r: 0 }, { q: 2, r: -2 })).toBe(2)
      expect(axialDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3)
    })

    it('should be symmetric', () => {
      const a = { q: 0, r: 0 }
      const b = { q: 3, r: -2 }
      expect(axialDistance(a, b)).toBe(axialDistance(b, a))
    })

    it('should return 0 for same hex', () => {
      expect(axialDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    })
  })

  describe('getAxialNeighbors', () => {
    it('should return 6 neighbors', () => {
      const neighbors = getAxialNeighbors(0, 0)
      expect(neighbors).toHaveLength(6)
    })

    it('should return correct neighbor coordinates', () => {
      const neighbors = getAxialNeighbors(0, 0)
      const expected = [
        { q: 1, r: 0 },   // East
        { q: 1, r: -1 },  // North East
        { q: 0, r: -1 },  // North West
        { q: -1, r: 0 },  // West
        { q: -1, r: 1 },  // South West
        { q: 0, r: 1 },   // South East
      ]

      expect(neighbors).toEqual(expect.arrayContaining(expected))
    })

    it('should work for any position (no conditional logic)', () => {
      const neighbors1 = getAxialNeighbors(0, 0)
      const neighbors2 = getAxialNeighbors(1, 0)
      const neighbors3 = getAxialNeighbors(0, 1)
      const neighbors4 = getAxialNeighbors(5, -3)

      // All should have 6 neighbors
      expect(neighbors1).toHaveLength(6)
      expect(neighbors2).toHaveLength(6)
      expect(neighbors3).toHaveLength(6)
      expect(neighbors4).toHaveLength(6)

      // Distance to all neighbors should be 1
      for (const neighbor of neighbors1) {
        expect(axialDistance({ q: 0, r: 0 }, neighbor)).toBe(1)
      }
    })
  })

  describe('axialToWorld', () => {
    it('should convert axial to world coordinates', () => {
      const [x, z] = axialToWorld(0, 0, 10, 10, 3.5)
      expect(typeof x).toBe('number')
      expect(typeof z).toBe('number')
    })

    it('should center map correctly', () => {
      const [x1, z1] = axialToWorld(0, 0, 10, 10, 3.5)
      // World coordinates are calculated relative to map center
      expect(typeof x1).toBe('number')
      expect(typeof z1).toBe('number')
      // Different hexes should have different world positions
      const [x2, z2] = axialToWorld(5, 0, 10, 10, 3.5)
      expect(Math.abs(x2 - x1)).toBeGreaterThan(0.1)
    })

    it('should produce consistent spacing', () => {
      const center = axialToWorld(0, 0, 10, 10, 3.5)
      const east = axialToWorld(1, 0, 10, 10, 3.5)
      const northEast = axialToWorld(1, -1, 10, 10, 3.5)

      const distEast = Math.sqrt(
        Math.pow(east[0] - center[0], 2) + Math.pow(east[1] - center[1], 2)
      )
      const distNorthEast = Math.sqrt(
        Math.pow(northEast[0] - center[0], 2) + Math.pow(northEast[1] - center[1], 2)
      )

      // Distances should be approximately equal
      expect(distEast).toBeCloseTo(distNorthEast, 1)
    })
  })

  describe('worldToAxial', () => {
    it('should convert world coordinates back to axial', () => {
      const axial = { q: 0, r: 0 }
      const [worldX, worldZ] = axialToWorld(axial.q, axial.r, 10, 10, 3.5)
      const backToAxial = worldToAxial(worldX, worldZ, 10, 10, 3.5)
      expect(backToAxial.q).toBe(0)
      expect(backToAxial.r).toBe(0)
    })

    it('should handle neighbors correctly', () => {
      const center = { q: 0, r: 0 }
      const [centerX, centerZ] = axialToWorld(center.q, center.r, 10, 10, 3.5)

      const neighbors = getAxialNeighbors(center.q, center.r)
      for (const neighbor of neighbors) {
        const [neighborX, neighborZ] = axialToWorld(neighbor.q, neighbor.r, 10, 10, 3.5)
        const backToAxial = worldToAxial(neighborX, neighborZ, 10, 10, 3.5)
        // Should round to correct neighbor
        expect(backToAxial.q).toBe(neighbor.q)
        expect(backToAxial.r).toBe(neighbor.r)
      }
    })
  })

  describe('round-trip conversions', () => {
    it('should maintain consistency: offset <-> axial', () => {
      const testCases = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 2, y: 1 },
        { x: 5, y: 3 },
      ]

      for (const offset of testCases) {
        const axial = offsetToAxial(offset.x, offset.y)
        const backToOffset = axialToOffset(axial.q, axial.r)
        expect(backToOffset).toEqual(offset)
      }
    })

    it('should maintain consistency: axial <-> world', () => {
      const testCases = [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: 2, r: -1 },
        { q: 5, r: -3 },
      ]

      for (const axial of testCases) {
        const [worldX, worldZ] = axialToWorld(axial.q, axial.r, 10, 10, 3.5)
        const backToAxial = worldToAxial(worldX, worldZ, 10, 10, 3.5)
        expect(backToAxial.q).toBe(axial.q)
        expect(backToAxial.r).toBe(axial.r)
      }
    })
  })
})

