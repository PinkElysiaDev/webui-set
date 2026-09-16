import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const project = fileURLToPath(new URL('../', import.meta.url))
const options = { url: 'http://127.0.0.1:5180/?inspect', playwright: process.env.PLAYWRIGHT_MODULE, output: '.asset-cache/scene-check', 'wind-seconds': '30' }
for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index].replace(/^--/, '')
  if (name === 'help') {
    console.log('node scripts/check-scene.mjs --playwright <playwright-core/index.mjs> [--url <dev URL>] [--baseline-prefix <PNG prefix>] [--wind-seconds 30]')
    process.exit(0)
  }
  if (!['url', 'playwright', 'output', 'wind-seconds', 'baseline-prefix'].includes(name) || !process.argv[index + 1]) throw new Error(`Unknown option: ${process.argv[index]}`)
  options[name] = process.argv[++index]
}
const { chromium } = await import(options.playwright ? pathToFileURL(path.resolve(options.playwright)).href : 'playwright-core')
const url = new URL(options.url)
url.searchParams.set('inspect', '')
const output = path.resolve(project, options.output)
await mkdir(output, { recursive: true })
const errors = []
const report = { matrix: [], resources: [], wind: null, errors }
const browser = await chromium.launch({ headless: true })
const sizes = [[1280, 720], [1440, 900], [1920, 1080], [2560, 1080], [2560, 1440], [768, 1024], [390, 844]]
const scene = page => page.evaluate(() => window.__loginDemo.snapshot())
const settled = async page => {
  await page.waitForFunction(() => window.__loginDemo && Object.values(window.__loginDemo.snapshot().status).every(resource => resource.state !== 'loading'))
  await page.waitForTimeout(120)
}
const openPage = async (reducedMotion = 'reduce') => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  return page
}
const quiet = page => page.evaluate(() => { window.__loginDemo.petals(false); window.__loginDemo.contact(false) })

try {
  const page = await openPage()
  await page.goto(url.href, { waitUntil: 'networkidle' })
  await settled(page)
  await quiet(page)
  await page.evaluate(async () => {
    const { AlphaPyramid, FlowerCoverage } = await import('/src/scene/coverage.ts')
    const { validateManifest } = await import('/src/scene/character-manifest.ts')
    const pixels = new Uint8Array(64).fill(255)
    pixels[5 * 8 + 3] = 0
    const alpha = new AlphaPyramid(8, 8, pixels)
    if (alpha.range(3, 5, 4, 6, 'minimum') !== 0 || alpha.range(0, 0, 2, 2, 'minimum') !== 1) throw new Error('Interior alpha holes are not preserved')
    const composed = new FlowerCoverage(8, 8, 0.98, 0, [{ alphaIn: () => 0.9 }, { alphaIn: () => 0.9 }])
    if (!composed.covers([[0, 0, 8, 8]]) || new FlowerCoverage(8, 8, 0.98, 0, []).covers([[0, 0, 8, 8]])) throw new Error('Composited coverage is invalid')
    const valid = await fetch('/assets/character/manifest.json').then(response => response.json())
    validateManifest(valid)
    for (const invalid of [null, { ...valid, version: 2 }, { ...valid, layers: [{ ...valid.layers[0], tip: null }] }, { ...valid, occlusion: { ...valid.occlusion, regions: [] } }]) {
      let rejected = false
      try { validateManifest(invalid) } catch { rejected = true }
      if (!rejected) throw new Error('Invalid manifest accepted')
    }
  })
  for (const fallback of [false, true]) {
    if (fallback) {
      await page.route('**/assets/character/front-hair.png', route => route.abort())
      await page.reload({ waitUntil: 'networkidle' })
      await settled(page)
      await quiet(page)
    }
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(200)
      for (const theme of ['day', 'night']) {
        const isNight = await page.locator('html').evaluate(element => element.classList.contains('theme-night'))
        if (isNight !== (theme === 'night')) await page.locator('.seal-toggle').click()
        await page.locator('input').focus()
        await page.mouse.move(0, 0)
        await page.waitForTimeout(350)
        const snapshot = await scene(page)
        const character = snapshot.character
        assert(character && character.animated !== fallback, `${width}x${height} character mode`)
        const card = await page.locator('form').boundingBox()
        if (character.visible) {
          assert(character.occlusion.satisfied && character.occlusion.coverage === 1 && character.occlusion.minimumSafetyPixels >= 3)
          assert(character.faceBounds[0] >= 16 && character.faceBounds[0] + character.faceBounds[2] <= width - 16)
          assert(character.faceBounds[1] >= 0 && character.faceBounds[1] + character.faceBounds[3] <= height - 24)
          if (width >= 1024) assert(character.placement.horizontal >= card.x + card.width + 24)
        } else {
          assert(!character.occlusion.satisfied && character.occlusion.reason && !character.contactVisible)
        }
        for (const layer of character.layers) {
          assert.equal(layer.pinnedMaximumWeight, 0, `${layer.id} root moves`)
          assert(layer.motion === 'fixed' ? layer.maximumWeight === 0 : layer.maximumWeight > 0, `${layer.id} motion weights`)
        }
        const name = `${fallback ? 'fallback' : 'layered'}-${theme}-${width}x${height}`
        const visible = await page.screenshot({ path: path.join(output, `${name}.png`) })
        await page.evaluate(() => window.__loginDemo.character(false))
        await page.waitForTimeout(80)
        const flowers = await page.screenshot({ path: path.join(output, `flowers-${name}.png`) })
        const hiddenDifference = character.visible ? await regionDifference(visible, flowers, character.requiredRegions.flatMap(region => region.rects)) : { samples: 0, maximum: 0, different: 0 }
        assert(hiddenDifference.maximum <= 8, `${name}: character leaks through mandatory coverage (${JSON.stringify(hiddenDifference)})`)
        let baselineDifference
        if (!fallback && theme === 'day' && options['baseline-prefix']) {
          const baseline = await readFile(`${path.resolve(project, options['baseline-prefix'])}-${width}x${height}.png`)
          baselineDifference = await regionDifference(baseline, flowers, [[0, 0, width, height]], [[Math.max(0, width - 410), height - 260, 410, 260], [card.x - 2, card.y - 2, card.width + 4, card.height + 4], [8, height - 86, 84, 84]])
          assert.equal(baselineDifference.maximum, 0, `${name}: frozen flowers changed outside DOM overlays`)
        }
        report.matrix.push({ name, character, hiddenDifference, baselineDifference })
        await page.evaluate(() => window.__loginDemo.character(true))
      }
      console.log(`${fallback ? 'fallback' : 'layered'} ${width}x${height}: day/night checked`)
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.unroute('**/assets/character/front-hair.png')
  await page.getByRole('button', { name: '重试场景资源' }).click()
  await settled(page)
  assert((await scene(page)).character.animated)
  report.resources.push('missing layer -> fallback -> retry')
  await page.route('**/assets/character/manifest.json', route => route.fulfill({ contentType: 'application/json', body: '{"version":2}' }))
  await page.reload({ waitUntil: 'networkidle' })
  await settled(page)
  assert.equal((await scene(page)).character.animated, false)
  await page.unroute('**/assets/character/manifest.json')
  report.resources.push('invalid manifest -> independent fallback metadata')
  const flowerRoute = /\/assets\/scene\/(mid|front)\.png/
  await page.route(flowerRoute, route => route.abort())
  await page.reload({ waitUntil: 'networkidle' })
  await settled(page)
  const missingFlowers = await scene(page)
  assert(!missingFlowers.character.visible && !missingFlowers.character.occlusion.satisfied && !missingFlowers.contact.visible)
  await page.unroute(flowerRoute)
  await page.getByRole('button', { name: '重试场景资源' }).click()
  await settled(page)
  assert((await scene(page)).character.visible)
  report.resources.push('missing occluders -> hidden character/contact -> retry')
  await page.route('**/assets/character/**', route => route.abort())
  await page.reload({ waitUntil: 'networkidle' })
  await settled(page)
  assert.equal((await scene(page)).character, null)
  await checkLogin(page)
  report.resources.push('all character assets missing -> login still works')
  await page.close()

  const moving = await openPage('no-preference')
  await moving.goto(url.href, { waitUntil: 'networkidle' })
  await settled(moving)
  await quiet(moving)
  await moving.evaluate(() => window.__loginDemo.motion(false))
  await moving.waitForTimeout(100)
  const original = await scene(moving)
  const stationary = await moving.screenshot({ path: path.join(output, 'wind-zero.png') })
  await moving.evaluate(() => window.__loginDemo.motion(true))
  const seconds = Number(options['wind-seconds'])
  assert(Number.isFinite(seconds) && seconds >= 0)
  for (let second = 0; second < seconds; second += 1) {
    if (second >= seconds / 2) await moving.mouse.move(1500 + Math.sin(second) * 350, 430 + Math.cos(second) * 220, { steps: 4 })
    await moving.waitForTimeout(1000)
    const current = await scene(moving)
    assert.deepEqual(current.character.placement, original.character.placement, 'character follows moving flowers')
    assert(current.character.occlusion.satisfied)
    if (second % 5 === 4) await moving.screenshot({ path: path.join(output, `wind-${second + 1}s.png`) })
  }
  const windy = await moving.screenshot({ path: path.join(output, 'wind-pointer.png') })
  const root = original.character.anchors.hairRoot
  const pinnedDifference = await regionDifference(stationary, windy, [[root.horizontal - 22, root.vertical - 18, 36, 36]])
  assert.equal(pinnedDifference.maximum, 0, 'fixed root or attachment moves')
  const hairDifference = await regionDifference(stationary, windy, [[original.character.placement.horizontal + 100, original.character.placement.vertical + 140, 620, 260]])
  if (seconds >= 5) assert(hairDifference.different > 100, 'hair/veil motion not visible')
  report.wind = { seconds, pinnedDifference, hairDifference, snapshot: await scene(moving) }
  await moving.locator('.seal-toggle').click()
  await moving.waitForTimeout(1400)
  await moving.screenshot({ path: path.join(output, 'wind-night.png') })
  await checkLogin(moving)
  report.resources.push('animated theme switch, empty/wrong/123 token, transition')
  await moving.close()
  assert.deepEqual(errors, [])
  console.log(`Scene checks passed; report: ${output}`)
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}

async function checkLogin(page) {
  await page.getByRole('button', { name: '立即登录' }).click()
  await page.getByRole('alert').filter({ hasText: '请输入' }).waitFor()
  await page.locator('input').fill('wrong')
  await page.getByRole('button', { name: '立即登录' }).click()
  await page.getByRole('alert').filter({ hasText: '密钥不正确' }).waitFor()
  await page.locator('input').fill('123')
  await page.getByRole('button', { name: '立即登录' }).click()
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  assert(page.url().endsWith('#/home'))
}

async function regionDifference(first, second, rects, ignore) {
  const original = await sharp(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const current = await sharp(second).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(original.info, current.info)
  const { width, height } = original.info
  let maximum = 0
  let different = 0
  let samples = 0
  for (const [left, top, rectWidth, rectHeight] of rects) {
    for (let row = Math.max(0, Math.floor(top)); row < Math.min(height, Math.ceil(top + rectHeight)); row += 1) {
      for (let column = Math.max(0, Math.floor(left)); column < Math.min(width, Math.ceil(left + rectWidth)); column += 1) {
        if (ignore?.some(([ignoreLeft, ignoreTop, ignoreWidth, ignoreHeight]) => column >= ignoreLeft && column < ignoreLeft + ignoreWidth && row >= ignoreTop && row < ignoreTop + ignoreHeight)) continue
        samples += 1
        let delta = 0
        for (let channel = 0; channel < 3; channel += 1) delta = Math.max(delta, Math.abs(original.data[(row * width + column) * 4 + channel] - current.data[(row * width + column) * 4 + channel]))
        maximum = Math.max(maximum, delta)
        if (delta) different += 1
      }
    }
  }
  return { samples, maximum, different }
}
