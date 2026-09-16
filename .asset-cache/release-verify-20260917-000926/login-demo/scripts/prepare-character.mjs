import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { characterLayout } from './character-layout.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(project, 'public/assets/character')
let source = path.join(homedir(), 'Downloads', '爱莉希雅')
for (let index = 2; index < process.argv.length; index += 1) {
  const option = process.argv[index]
  if (option === '--source' && process.argv[index + 1]) source = path.resolve(process.argv[++index])
  else if (option === '--help') {
    console.log('npm run assets:character -- --source "角色 PNG 目录"')
    process.exit(0)
  } else throw new Error(`未知或不完整参数：${option}`)
}

const density = characterLayout.density
const width = Math.round(characterLayout.canvas[0] * density)
const height = Math.round(characterLayout.canvas[1] * density)
const blank = () => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
const sources = new Map()
for (const layer of characterLayout.layers) {
  if (sources.has(layer.source)) continue
  const bytes = await readFile(path.join(source, layer.source))
  const metadata = await sharp(bytes).metadata()
  if (metadata.width !== 3840 || metadata.height !== 2160) throw new Error(`${layer.source} 必须保留 3840 × 2160 原始画布`)
  sources.set(layer.source, bytes)
}
await mkdir(output, { recursive: true })
const layers = []
const composites = []
const placedLayers = new Map()
for (const spec of characterLayout.layers) {
  const image = await rasterizeLayer(spec, sources.get(spec.source))
  placedLayers.set(spec.id, image)
  composites.push({
    input: await sharp(image.png).resize(Math.round(image.rect[2] * density), Math.round(image.rect[3] * density)).png().toBuffer(),
    left: Math.round(image.rect[0] * density), top: Math.round(image.rect[1] * density),
  })
  layers.push({
    id: spec.id, file: `${spec.id}.png`, source: spec.source, rect: image.rect, size: image.size,
    registration: { sourceAnchor: spec.sourceAnchor, anchor: spec.anchor, scale: spec.scale, angle: spec.angle },
    motion: spec.motion, root: spec.root ?? characterLayout.anchors.hairRoot, pin: spec.pin ?? [0, 0],
    tip: spec.tip ?? spec.root ?? characterLayout.anchors.hairRoot,
    amplitude: spec.amplitude ?? 0, frequency: spec.frequency ?? 0, phase: spec.phase ?? 0,
    sha256: createHash('sha256').update(image.png).digest('hex'),
  })
  console.log(`${spec.id.padEnd(15)} ${image.size.join(' × ')} · ${(image.png.length / 1024).toFixed(0)} KiB`)
}
const fallback = await blank().composite(composites).png().toBuffer()
const combined = await sharp(fallback).ensureAlpha().raw().toBuffer()
const connections = []
for (const connection of characterLayout.connections) {
  const joined = await blank().composite(connection.layers.map(id => ({ input: placedLayers.get(id).placed }))).raw().toBuffer()
  let tested = 0
  let covered = 0
  for (let vertical = Math.floor((connection.center[1] - connection.radius) * density); vertical <= (connection.center[1] + connection.radius) * density; vertical += 1) {
    for (let horizontal = Math.floor((connection.center[0] - connection.radius) * density); horizontal <= (connection.center[0] + connection.radius) * density; horizontal += 1) {
      if (Math.hypot(horizontal / density - connection.center[0], vertical / density - connection.center[1]) > connection.radius) continue
      tested += 1
      if (joined[(vertical * width + horizontal) * 4 + 3] >= 250) covered += 1
    }
  }
  const coverage = covered / tested
  if (coverage < 0.995) throw new Error(`${connection.id} connection has transparent holes: ${(coverage * 100).toFixed(2)}%`)
  connections.push({ ...connection, coverage })
}
for (const [name, anchor] of Object.entries(characterLayout.anchors)) {
  const offset = (Math.round(anchor[1] * density) * width + Math.round(anchor[0] * density)) * 4
  if ((combined[offset + 3] ?? 0) < 32) throw new Error(`${name} 锚点未落在角色上：${anchor}`)
}
const body = placedLayers.get('body')
const hand = await sharp(body.placed).composite([{ input: mask(characterLayout.occlusion.hand), blend: 'dest-in' }]).raw().toBuffer()
const hem = Buffer.alloc(width * height * 4)
const bodySpec = characterLayout.layers.find(spec => spec.id === 'body')
const bodySource = await sharp(sources.get(bodySpec.source)).resize(width, height).ensureAlpha().raw().toBuffer()
for (let horizontal = 0; horizontal < width; horizontal += 1) {
  if (bodySource[((height - 1) * width + horizontal) * 4 + 3] < 8) continue
  const target = transformPoint([horizontal / density, characterLayout.canvas[1] - 1 / density], bodySpec)
  for (let inset = 0; inset < 8; inset += 1) {
    const column = Math.round(target[0] * density)
    const row = Math.round((target[1] - inset) * density)
    if (column >= 0 && column < width && row >= 0 && row < height) hem[(row * width + column) * 4 + 3] = 255
  }
}
const regions = [{ id: 'hand', rects: coverageRects(hand) }, { id: 'hem', rects: coverageRects(hem) }]
if (regions.some(region => !region.rects.length)) throw new Error('手部或衣裙裁切边界没有覆盖探针')
const manifest = {
  version: characterLayout.version, canvas: characterLayout.canvas,
  anchors: characterLayout.anchors, bounds: [0, 0, 1280, 720], faceBounds: characterLayout.faceBounds,
  occlusion: { minimumCoverage: characterLayout.occlusion.minimumCoverage, safetyPixels: characterLayout.occlusion.safetyPixels, regions }, layers,
  connections,
  sourceHashes: Object.fromEntries([...sources].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
}
for (const [id, image] of placedLayers) await writeFile(path.join(output, `${id}.png`), image.png)
await writeFile(path.join(output, 'fallback.png'), fallback)
await writeFile(path.join(output, 'fallback.json'), `${JSON.stringify({ ...manifest, layers: [{ id: 'fallback', file: 'fallback.png', source: 'registered-composite', rect: manifest.bounds, size: [width, height], motion: 'fixed', root: characterLayout.anchors.hairRoot, tip: characterLayout.anchors.hairRoot, pin: [0, 0], amplitude: 0, frequency: 0, phase: 0 }] }, null, 2)}\n`)
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`已校验 ${sources.size} 份独立素材、${layers.length} 层角色、${regions.reduce((total, region) => total + region.rects.length, 0)} 个遮挡区域与全部锚点：${output}`)

function mask(shape) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 720"><path fill="white" d="${shape}"/></svg>`)
}

async function rasterizeLayer(spec, sourceBytes) {
  const masks = []
  if (spec.keep) masks.push({ input: mask(spec.keep), blend: 'dest-in' })
  for (const cutout of spec.remove ?? []) masks.push({ input: mask(cutout), blend: 'dest-out' })
  if (spec.opacity !== undefined) {
    masks.push({ input: { create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: spec.opacity } } }, blend: 'dest-in' })
  }
  const masked = await sharp(sourceBytes).resize(width, height).composite(masks).png().toBuffer()
  const scale = spec.scale ?? 1
  const angle = (spec.angle ?? 0) * Math.PI / 180
  const resizedWidth = Math.round(width * scale)
  const resizedHeight = Math.round(height * scale)
  const transformed = await sharp(masked).resize(resizedWidth, resizedHeight)
    .rotate(spec.angle ?? 0, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true })
  const sourceAnchor = spec.sourceAnchor ?? [0, 0]
  const anchor = spec.anchor ?? [0, 0]
  const centeredHorizontal = sourceAnchor[0] * density * scale - resizedWidth / 2
  const centeredVertical = sourceAnchor[1] * density * scale - resizedHeight / 2
  const anchorHorizontal = centeredHorizontal * Math.cos(angle) - centeredVertical * Math.sin(angle) + transformed.info.width / 2
  const anchorVertical = centeredHorizontal * Math.sin(angle) + centeredVertical * Math.cos(angle) + transformed.info.height / 2
  const offsetHorizontal = Math.round(anchor[0] * density - anchorHorizontal)
  const offsetVertical = Math.round(anchor[1] * density - anchorVertical)
  const transformedPixels = await sharp(transformed.data).ensureAlpha().raw().toBuffer()
  for (let vertical = 0; vertical < transformed.info.height; vertical += 1) {
    for (let horizontal = 0; horizontal < transformed.info.width; horizontal += 1) {
      if (horizontal + offsetHorizontal >= 0 && horizontal + offsetHorizontal < width && vertical + offsetVertical >= 0 && vertical + offsetVertical < height) continue
      if (transformedPixels[(vertical * transformed.info.width + horizontal) * 4 + 3] > 16) throw new Error(`${spec.id} 的可见轮廓被配准画布裁掉，请调整部件变换`)
    }
  }
  const clipLeft = Math.max(0, -offsetHorizontal)
  const clipTop = Math.max(0, -offsetVertical)
  const clipWidth = Math.min(transformed.info.width - clipLeft, width - Math.max(0, offsetHorizontal))
  const clipHeight = Math.min(transformed.info.height - clipTop, height - Math.max(0, offsetVertical))
  if (clipWidth <= 0 || clipHeight <= 0) throw new Error(`${spec.id} 超出配准画布`)
  const clipped = await sharp(transformed.data).extract({ left: clipLeft, top: clipTop, width: clipWidth, height: clipHeight }).png().toBuffer()
  let placed = await blank().composite([{ input: clipped, left: Math.max(0, offsetHorizontal), top: Math.max(0, offsetVertical) }]).png().toBuffer()
  if (spec.targetKeep) placed = await sharp(placed).composite([{ input: mask(spec.targetKeep), blend: 'dest-in' }]).png().toBuffer()
  const pixels = await sharp(placed).ensureAlpha().raw().toBuffer()
  if (spec.split) {
    for (let index = 0; index < width * height; index += 1) {
      const distance = Math.hypot(index % width / density - spec.anchor[0], Math.floor(index / width) / density - spec.anchor[1])
      const progress = Math.max(0, Math.min(1, (distance - 85) / 65))
      const fixed = 1 - progress * progress * (3 - 2 * progress)
      const alpha = pixels[index * 4 + 3] / 255
      const attachment = alpha * fixed
      const desired = alpha * (0.65 + 0.35 * fixed)
      pixels[index * 4 + 3] = Math.round(255 * (spec.split === 'attachment' ? attachment : attachment >= 1 ? 0 : (desired - attachment) / (1 - attachment)))
    }
    placed = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()
  }
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let vertical = 0; vertical < height; vertical += 1) {
    for (let horizontal = 0; horizontal < width; horizontal += 1) {
      if (pixels[(vertical * width + horizontal) * 4 + 3] < 3) continue
      left = Math.min(left, horizontal)
      right = Math.max(right, horizontal)
      top = Math.min(top, vertical)
      bottom = Math.max(bottom, vertical)
    }
  }
  if (right < left) throw new Error(`${spec.id} 蒙版生成了空图层`)
  const padding = Math.ceil(12 * density)
  left = Math.max(0, left - padding)
  top = Math.max(0, top - padding)
  right = Math.min(width, right + padding + 1)
  bottom = Math.min(height, bottom + padding + 1)
  const texture = await sharp(placed).extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: spec.maxSize ?? 2048, height: spec.maxSize ?? 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  return {
    rect: [left / density, top / density, (right - left) / density, (bottom - top) / density],
    size: [texture.info.width, texture.info.height], png: texture.data, placed,
  }
}

function transformPoint(point, spec) {
  const angle = spec.angle * Math.PI / 180
  const horizontal = (point[0] - spec.sourceAnchor[0]) * spec.scale
  const vertical = (point[1] - spec.sourceAnchor[1]) * spec.scale
  return [spec.anchor[0] + horizontal * Math.cos(angle) - vertical * Math.sin(angle), spec.anchor[1] + horizontal * Math.sin(angle) + vertical * Math.cos(angle)]
}

function coverageRects(pixels) {
  const step = 6
  const rectangles = []
  for (let top = 0; top < height; top += step) {
    let left = width
    let right = -1
    for (let vertical = top; vertical < Math.min(top + step, height); vertical += 1) {
      for (let horizontal = 0; horizontal < width; horizontal += 1) {
        if (pixels[(vertical * width + horizontal) * 4 + 3] < 8) continue
        left = Math.min(left, horizontal)
        right = Math.max(right, horizontal)
      }
    }
    if (right >= left) rectangles.push([left / density, top / density, (right - left + 1) / density, step / density])
  }
  return rectangles
}
