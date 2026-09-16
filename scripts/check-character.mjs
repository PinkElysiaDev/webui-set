import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const project = fileURLToPath(new URL('../', import.meta.url))
const root = path.join(project, 'public/assets/character')
const output = path.join(project, '.asset-cache/character-check')
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
const fallbackManifest = JSON.parse(await readFile(path.join(root, 'fallback.json'), 'utf8'))
const [width, height] = fallbackManifest.layers[0].size
const density = width / manifest.canvas[0]
const composites = []
const bareLayers = []
assert.equal(manifest.version, 3)
assert.deepEqual(new Set(manifest.layers.map(layer => layer.source)), new Set(['角色本身.png', '后发发片.png', '前发发片.png', '头纱本体.png', '头纱飘带.png']))
for (const field of ['anchors', 'faceBounds', 'occlusion']) assert.deepEqual(manifest[field], fallbackManifest[field])
for (const layer of manifest.layers) {
  const bytes = await readFile(path.join(root, layer.file))
  const metadata = await sharp(bytes).metadata()
  assert.deepEqual([metadata.width, metadata.height], layer.size, layer.id)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), layer.sha256, `${layer.id} hash`)
  const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer()
  assert(pixels.some((alpha, index) => index % 4 === 3 && alpha > 128), `${layer.id} is empty`)
  const placed = { input: await sharp(bytes).resize(Math.round(layer.rect[2] * density), Math.round(layer.rect[3] * density)).png().toBuffer(), left: Math.round(layer.rect[0] * density), top: Math.round(layer.rect[1] * density) }
  assert(placed.left >= 0 && placed.top >= 0 && placed.left + layer.rect[2] * density <= width + 0.001 && placed.top + layer.rect[3] * density <= height + 0.001, `${layer.id} clipped`)
  composites.push(placed)
  if (!['veil', 'ribbon', 'ornament'].includes(layer.motion) && layer.id !== 'ornament') bareLayers.push(placed)
}
const blank = () => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
const combined = await blank().composite(composites).png().toBuffer()
const pixels = await sharp(combined).ensureAlpha().raw().toBuffer()
const fallback = await sharp(path.join(root, 'fallback.png')).ensureAlpha().raw().toBuffer()
assert.equal(pixels.compare(fallback), 0, 'fallback differs from registered layers')
for (const [name, anchor] of Object.entries(manifest.anchors)) {
  assert(pixels[(Math.round(anchor[1] * density) * width + Math.round(anchor[0] * density)) * 4 + 3] >= 32, `${name} transparent`)
}
const bare = await blank().composite(bareLayers).png().toBuffer()
const barePixels = await sharp(bare).ensureAlpha().raw().toBuffer()
for (const connection of manifest.connections) {
  let covered = 0
  let total = 0
  for (let row = Math.floor((connection.center[1] - connection.radius) * density); row <= (connection.center[1] + connection.radius) * density; row += 1) {
    for (let column = Math.floor((connection.center[0] - connection.radius) * density); column <= (connection.center[0] + connection.radius) * density; column += 1) {
      if (Math.hypot(column / density - connection.center[0], row / density - connection.center[1]) > connection.radius) continue
      total += 1
      if (barePixels[(row * width + column) * 4 + 3] >= 250) covered += 1
    }
  }
  assert(covered / total >= 0.995, `${connection.id} needs the veil to hide a hole`)
}
const regionPixels = Buffer.alloc(width * height * 4)
for (const region of manifest.occlusion.regions) {
  assert(region.rects.length, `${region.id} empty`)
  for (const [left, top, rectWidth, rectHeight] of region.rects) {
    for (let row = Math.floor(top * density); row < (top + rectHeight) * density; row += 1) {
      for (let column = Math.floor(left * density); column < (left + rectWidth) * density; column += 1) {
        const offset = (row * width + column) * 4
        regionPixels[offset + (region.id === 'hand' ? 0 : 2)] = 255
        regionPixels[offset + 3] = 145
      }
    }
  }
}
for (const name of ['hand', 'fingertip']) {
  const anchor = manifest.anchors[name]
  assert(manifest.occlusion.regions.find(region => region.id === 'hand').rects.some(([left, top, rectWidth, rectHeight]) => anchor[0] >= left && anchor[0] <= left + rectWidth && anchor[1] >= top && anchor[1] <= top + rectHeight), `${name} outside hand region`)
}
await mkdir(output, { recursive: true })
await sharp(combined).flatten({ background: '#eeeef3' }).resize(1280, 720).toFile(path.join(output, 'static.png'))
await sharp(bare).flatten({ background: '#eeeef3' }).resize(1280, 720).toFile(path.join(output, 'without-veil.png'))
await sharp(bare).flatten({ background: '#eeeef3' }).extract({ left: 1245, top: 30, width: 445, height: 520 }).toFile(path.join(output, 'head.png'))
const regionPreview = await sharp(combined).flatten({ background: '#eeeef3' }).composite([{ input: regionPixels, raw: { width, height, channels: 4 } }]).png().toBuffer()
await sharp(regionPreview).resize(1280, 720).toFile(path.join(output, 'required-regions.png'))
const report = { layers: manifest.layers.length, sources: Object.keys(manifest.sourceHashes), connections: manifest.connections, fallbackIdentical: true, regionRectangles: manifest.occlusion.regions.map(region => ({ id: region.id, count: region.rects.length })) }
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Character checks passed; previews: ${output}`)
