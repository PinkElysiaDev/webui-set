export type Pair = [number, number]
export type Rect = [number, number, number, number]

export interface CharacterLayerSpec {
  id: string
  file: string
  source: string
  registration?: { sourceAnchor: Pair; anchor: Pair; scale: number; angle: number }
  rect: Rect
  size: Pair
  motion: 'fixed' | 'hair' | 'fringe' | 'veil' | 'ribbon'
  root: Pair
  tip: Pair
  pin: Pair
  amplitude: number
  frequency: number
  phase: number
}

export interface CharacterManifest {
  version: number
  canvas: Pair
  anchors: Record<'head' | 'face' | 'hand' | 'hairRoot' | 'fingertip', Pair>
  bounds: Rect
  faceBounds: Rect
  occlusion: { minimumCoverage: number; safetyPixels: number; regions: { id: string; rects: Rect[] }[] }
  layers: CharacterLayerSpec[]
}

export function validateManifest(value: unknown, fallback = false): CharacterManifest {
  const manifest = value as CharacterManifest
  const pair = (entry: unknown): entry is Pair => Array.isArray(entry) && entry.length === 2 && entry.every(Number.isFinite)
  const rectangle = (entry: unknown): entry is Rect => Array.isArray(entry) && entry.length === 4 && entry.every(Number.isFinite)
    && entry[0] >= 0 && entry[1] >= 0 && entry[2] > 0 && entry[3] > 0
    && entry[0] + entry[2] <= 1280.001 && entry[1] + entry[3] <= 720.001
  if (!manifest || manifest.version !== 3 || !pair(manifest.canvas) || manifest.canvas[0] !== 1280 || manifest.canvas[1] !== 720
    || !rectangle(manifest.bounds) || !rectangle(manifest.faceBounds)
    || !manifest.anchors || !['head', 'face', 'hand', 'hairRoot', 'fingertip'].every(name => {
      const anchor = manifest.anchors[name as keyof CharacterManifest['anchors']]
      return pair(anchor) && anchor[0] >= 0 && anchor[0] < 1280 && anchor[1] >= 0 && anchor[1] < 720
    })
    || !manifest.occlusion || !Number.isFinite(manifest.occlusion.minimumCoverage) || manifest.occlusion.minimumCoverage < 0.95 || manifest.occlusion.minimumCoverage > 1
    || !Number.isFinite(manifest.occlusion.safetyPixels) || manifest.occlusion.safetyPixels < 0 || manifest.occlusion.safetyPixels > 32
    || !Array.isArray(manifest.occlusion.regions) || !['hand', 'hem'].every(id => manifest.occlusion.regions.some(region => region?.id === id))
    || manifest.occlusion.regions.some(region => !region || !Array.isArray(region.rects) || !region.rects.length || region.rects.length > 2048 || !region.rects.every(rectangle))
    || !Array.isArray(manifest.layers) || !manifest.layers.length || manifest.layers.length > 32) throw new Error('角色配准数据无效，请重新生成素材')
  const identifiers = new Set<string>()
  for (const spec of manifest.layers) {
    if (!spec || !/^[a-z-]+$/.test(spec.id) || identifiers.has(spec.id) || spec.file !== `${spec.id}.png`
      || typeof spec.source !== 'string' || !spec.source || !pair(spec.size) || spec.size.some(size => !Number.isInteger(size) || size <= 0 || size > 2048)
      || !pair(spec.root) || !pair(spec.tip) || !pair(spec.pin) || spec.pin[0] < 0 || spec.pin[1] < spec.pin[0]
      || !rectangle(spec.rect) || !['fixed', 'hair', 'fringe', 'veil', 'ribbon'].includes(spec.motion)
      || ![spec.amplitude, spec.frequency, spec.phase].every(Number.isFinite) || spec.amplitude < 0 || spec.amplitude > 32
      || (spec.motion !== 'fixed' && (spec.pin[1] <= spec.pin[0] || Math.hypot(spec.tip[0] - spec.root[0], spec.tip[1] - spec.root[1]) < 1))
      || (!fallback && (!spec.registration || !pair(spec.registration.sourceAnchor) || !pair(spec.registration.anchor)
        || !Number.isFinite(spec.registration.scale) || spec.registration.scale <= 0 || !Number.isFinite(spec.registration.angle)))) throw new Error('角色图层定义无效，请重新生成素材')
    identifiers.add(spec.id)
  }
  if (fallback && (manifest.layers.length !== 1 || manifest.layers[0].id !== 'fallback' || manifest.layers[0].motion !== 'fixed')) throw new Error('静态角色配置无效')
  return manifest
}
