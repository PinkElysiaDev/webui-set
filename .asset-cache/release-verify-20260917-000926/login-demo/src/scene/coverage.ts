import type { Rect } from './character-manifest'

export class AlphaPyramid {
  private levels: { width: number; height: number; minimum: Uint8Array; maximum: Uint8Array }[] = []

  constructor(width: number, height: number, alpha: Uint8Array) {
    this.levels.push({ width, height, minimum: alpha, maximum: alpha })
    while (width > 1 || height > 1) {
      const previous = this.levels[this.levels.length - 1]
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
      const minimum = new Uint8Array(width * height).fill(255)
      const maximum = new Uint8Array(width * height)
      for (let row = 0; row < previous.height; row += 1) {
        for (let column = 0; column < previous.width; column += 1) {
          const target = Math.floor(row / 2) * width + Math.floor(column / 2)
          const source = row * previous.width + column
          minimum[target] = Math.min(minimum[target], previous.minimum[source])
          maximum[target] = Math.max(maximum[target], previous.maximum[source])
        }
      }
      this.levels.push({ width, height, minimum, maximum })
    }
  }

  range(left: number, top: number, right: number, bottom: number, mode: 'minimum' | 'maximum') {
    const original = this.levels[0]
    if (right <= 0 || bottom <= 0 || left >= original.width || top >= original.height) return 0
    if (mode === 'minimum' && (left < 0 || top < 0 || right > original.width || bottom > original.height)) return 0
    left = Math.max(0, left)
    top = Math.max(0, top)
    right = Math.min(original.width, right)
    bottom = Math.min(original.height, bottom)
    const levelIndex = Math.min(this.levels.length - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, Math.min(right - left, bottom - top)))) - 1))
    const level = this.levels[levelIndex]
    const block = 2 ** levelIndex
    const firstColumn = Math.floor(left / block)
    const firstRow = Math.floor(top / block)
    const lastColumn = Math.min(level.width, Math.ceil(right / block))
    const lastRow = Math.min(level.height, Math.ceil(bottom / block))
    const pixels = level[mode]
    let result = mode === 'minimum' ? 255 : 0
    for (let row = firstRow; row < lastRow; row += 1) {
      for (let column = firstColumn; column < lastColumn; column += 1) {
        const alpha = pixels[row * level.width + column]
        result = mode === 'minimum' ? Math.min(result, alpha) : Math.max(result, alpha)
        if (result === (mode === 'minimum' ? 0 : 255)) return result / 255
      }
    }
    return result / 255
  }
}

export interface CoverageSource {
  alphaIn(rect: Rect, width: number, height: number, safety: number, mode: 'minimum' | 'maximum'): number
}

export class FlowerCoverage {
  readonly step = 4
  readonly ready: boolean
  private columns: number
  private rows: number
  private missing: Uint32Array

  constructor(readonly width: number, readonly height: number, readonly threshold: number, readonly safety: number, private sources: CoverageSource[]) {
    this.ready = sources.length > 0
    this.columns = Math.ceil(width / this.step)
    this.rows = Math.ceil(height / this.step)
    const stride = this.columns + 1
    this.missing = new Uint32Array(stride * (this.rows + 1))
    for (let row = 0; row < this.rows; row += 1) {
      let missingInRow = 0
      for (let column = 0; column < this.columns; column += 1) {
        const rect: Rect = [column * this.step, row * this.step, Math.min(this.step, width - column * this.step), Math.min(this.step, height - row * this.step)]
        let transparent = 1
        for (const source of sources) transparent *= 1 - source.alphaIn(rect, width, height, safety, 'minimum')
        if (1 - transparent < threshold) missingInRow += 1
        this.missing[(row + 1) * stride + column + 1] = this.missing[row * stride + column + 1] + missingInRow
      }
    }
  }

  count(rect: Rect, margin = 0) {
    const left = Math.max(0, Math.min(this.columns, Math.floor((rect[0] - margin) / this.step)))
    const top = Math.max(0, Math.min(this.rows, Math.floor((rect[1] - margin) / this.step)))
    const right = Math.max(left, Math.min(this.columns, Math.ceil((rect[0] + rect[2] + margin) / this.step)))
    const bottom = Math.max(top, Math.min(this.rows, Math.ceil((rect[1] + rect[3] + margin) / this.step)))
    const stride = this.columns + 1
    const uncovered = this.missing[bottom * stride + right] - this.missing[top * stride + right]
      - this.missing[bottom * stride + left] + this.missing[top * stride + left]
    return { uncovered, total: (right - left) * (bottom - top) }
  }

  covers(rects: Rect[], margin = 0) {
    return this.ready && rects.every(rect => this.count(rect, margin).uncovered === 0)
  }

  clear(rect: Rect) {
    let transparent = 1
    for (const source of this.sources) transparent *= 1 - source.alphaIn(rect, this.width, this.height, this.safety, 'maximum')
    return 1 - transparent < 0.05
  }

  margin(rects: Rect[]) {
    if (!this.covers(rects)) return 0
    let lower = 0
    let upper = 32
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2)
      if (this.covers(rects, middle)) lower = middle
      else upper = middle
    }
    return this.safety + lower
  }
}
