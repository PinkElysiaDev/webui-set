import * as THREE from 'three'

export type ThemeMode = 'day' | 'night'

const DAY_COLORS = {
  skyTop: '#fbf6ff', skyHorizon: '#ffffff', skyGlow: '#ffeef7',
  key: '#fff3ea', fill: '#ffe3f1', rim: '#ffffff', ground: '#ead5e2',
  flowers: '#ffffff', petal: '#ef9bc2', petalEdge: '#ffdfea',
  ink: '#2b1a22', card: '#ffffff', primary: '#dc185d', particle: '#f9a8c9',
  halo: '#ffe2f0', seal: '#d97706', error: '#b52946',
}

const NIGHT_COLORS: typeof DAY_COLORS = {
  skyTop: '#14182f', skyHorizon: '#342642', skyGlow: '#645581',
  key: '#bdcaff', fill: '#c1a4ee', rim: '#e1e7ff', ground: '#353355',
  flowers: '#929bcf', petal: '#b6baff', petalEdge: '#e1d7ff',
  ink: '#f3eaf9', card: '#211d37', primary: '#b8bcff', particle: '#decaff',
  halo: '#c9c8ff', seal: '#b8bcff', error: '#ffb4c4',
}

type ThemeColors = { [Key in keyof typeof DAY_COLORS]: THREE.Color }

export interface ThemeSnapshot {
  colors: ThemeColors
  blend: number
  keyIntensity: number
  fillIntensity: number
  rimIntensity: number
  hemiIntensity: number
  bloom: number
}

const dayColors = makeColors(DAY_COLORS)
const nightColors = makeColors(NIGHT_COLORS)

export class DayNightController {
  mode: ThemeMode
  private blend: number
  private target: number
  private listeners = new Set<() => void>()
  readonly snapshot: ThemeSnapshot = {
    colors: makeColors(DAY_COLORS), blend: 0,
    keyIntensity: 1, fillIntensity: 0.45, rimIntensity: 0.65,
    hemiIntensity: 1, bloom: 0.06,
  }

  constructor(mode: ThemeMode = 'day') {
    this.mode = mode
    this.blend = this.target = mode === 'night' ? 1 : 0
    this.refresh()
  }

  get settled() {
    return this.blend === this.target
  }

  setMode(mode: ThemeMode, immediate = false) {
    this.mode = mode
    this.target = mode === 'night' ? 1 : 0
    if (immediate) this.blend = this.target
    this.refresh()
  }

  update(delta: number) {
    const distance = this.target - this.blend
    this.blend += Math.sign(distance) * Math.min(Math.abs(distance), delta / 1.2)
    this.refresh()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private refresh() {
    const blend = this.blend < 0.5
      ? 2 * this.blend * this.blend
      : 1 - Math.pow(-2 * this.blend + 2, 2) / 2
    const snapshot = this.snapshot
    snapshot.blend = blend
    for (const name of Object.keys(dayColors) as (keyof ThemeColors)[]) {
      snapshot.colors[name].copy(dayColors[name]).lerp(nightColors[name], blend)
    }
    snapshot.keyIntensity = THREE.MathUtils.lerp(1, 0.7, blend)
    snapshot.fillIntensity = THREE.MathUtils.lerp(0.45, 0.4, blend)
    snapshot.rimIntensity = THREE.MathUtils.lerp(0.65, 0.95, blend)
    snapshot.hemiIntensity = THREE.MathUtils.lerp(1, 0.65, blend)
    snapshot.bloom = THREE.MathUtils.lerp(0.3, 0.55, blend)
    this.listeners.forEach(listener => listener())
  }
}

function makeColors(values: typeof DAY_COLORS): ThemeColors {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, new THREE.Color(value)])) as ThemeColors
}

export function applyTheme(snapshot: ThemeSnapshot) {
  const { colors, blend } = snapshot
  const style = document.documentElement.style
  const color = (value: THREE.Color, alpha?: number) => {
    const css = value.getStyle()
    return alpha === undefined ? css : css.replace('rgb(', 'rgba(').replace(')', `,${alpha})`)
  }
  const variables = {
    ink: color(colors.ink), 'ink-soft': color(colors.ink, 0.64),
    card: color(colors.card, 0.62), 'card-border': `rgba(255,255,255,${0.7 - blend * 0.52})`,
    line: color(colors.ink, 0.35), primary: color(colors.primary),
    'particle-tint': color(colors.particle), halo: color(colors.halo, 0.9),
    'seal-color': color(colors.seal), 'seal-glow': color(colors.seal, 0.3),
    ember: color(colors.error), 'error-bg': color(colors.error, 0.1),
    'sky-top': color(colors.skyTop), 'sky-horizon': color(colors.skyHorizon),
    'home-border': color(colors.primary, 0.4), 'home-hover': color(colors.primary, 0.1),
  }
  for (const [name, value] of Object.entries(variables)) style.setProperty(`--${name}`, value)
  style.colorScheme = blend > 0.5 ? 'dark' : 'light'
}
