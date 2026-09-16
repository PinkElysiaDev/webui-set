import type { CharacterManifest, Rect } from './character-manifest'
import type { FlowerCoverage } from './coverage'

export interface Placement { horizontal: number; vertical: number; scale: number }
export interface CharacterViewport {
  width: number
  height: number
  card?: { left: number; right: number; top: number; bottom: number }
  coverage: FlowerCoverage
}

export function screenRect(rect: Rect, placement: Placement): Rect {
  return [placement.horizontal + rect[0] * placement.scale, placement.vertical + rect[1] * placement.scale, rect[2] * placement.scale, rect[3] * placement.scale]
}

export function placeCharacter(manifest: CharacterManifest, viewport: CharacterViewport) {
  const { width, height, card, coverage } = viewport
  const narrow = width < 1024
  // 桌面布局中卡片是右侧竖向面板，立绘放在面板左侧；窄屏（底部面板）沿用原有策略
  const right = !narrow && card ? card.left - 24 : width - Math.max(24, width * 0.025)
  const left = narrow ? width * 0.34 : 24
  const initialScale = narrow
    ? Math.min(width * 0.82 / 240, height * 0.95 / 720)
    : Math.min(Math.max(120, right - left - 36) / manifest.canvas[0], height * 0.76 / manifest.canvas[1])
  const initial = (scale: number): Placement => ({
    horizontal: narrow ? width * 0.67 - manifest.anchors.face[0] * scale : right - manifest.canvas[0] * scale,
    vertical: narrow ? 18 : Math.max(height * 0.065, height * 0.8 - manifest.canvas[1] * scale),
    scale,
  })
  let placement = initial(initialScale)
  let satisfied = false
  let reason = coverage.ready ? '手部或衣裙裁切边界无法在保留完整头脸的同时安全遮挡' : '中景／前景遮挡数据不可用'
  let downwardAdjustment = 0
  const logicalRects = manifest.occlusion.regions.flatMap(region => region.rects)
  if (coverage.ready) {
    search: for (let attempt = 0; attempt <= 12; attempt += 1) {
      const candidate = initial(initialScale * (1 - attempt * 0.04))
      const face = screenRect(manifest.faceBounds, candidate)
      if (face[0] < 16 || face[0] + face[2] > width - 16) continue
      let maximumVertical = height - 24 - (manifest.faceBounds[1] + manifest.faceBounds[3]) * candidate.scale
      if (card && face[0] < card.right + 24 && face[0] + face[2] > card.left - 24) {
        maximumVertical = Math.min(maximumVertical, card.top - 24 - (manifest.faceBounds[1] + manifest.faceBounds[3]) * candidate.scale)
      }
      const start = candidate.vertical
      for (let vertical = start; vertical <= maximumVertical; vertical += 1) {
        candidate.vertical = vertical
        const rects = logicalRects.map(rect => screenRect(rect, candidate))
        if (!coverage.covers(rects) || !coverage.clear(screenRect(manifest.faceBounds, candidate))) continue
        placement = { ...candidate }
        downwardAdjustment = vertical - start
        satisfied = true
        reason = ''
        break search
      }
    }
  }
  const regions = manifest.occlusion.regions.map(region => {
    const counts = region.rects.map(rect => coverage.count(screenRect(rect, placement)))
    const total = counts.reduce((sum, count) => sum + count.total, 0)
    const uncovered = counts.reduce((sum, count) => sum + count.uncovered, 0)
    return { id: region.id, coverage: total ? 1 - uncovered / total : 1, samples: total, uncovered }
  })
  return {
    placement,
    occlusion: {
      satisfied, reason, alphaThreshold: manifest.occlusion.minimumCoverage,
      coverage: Math.min(...regions.map(region => region.coverage)), regions,
      safetyPixels: coverage.safety,
      minimumSafetyPixels: satisfied ? coverage.margin(logicalRects.map(rect => screenRect(rect, placement))) : 0,
      downwardAdjustment, scaleReduction: 1 - placement.scale / initialScale,
    },
  }
}
