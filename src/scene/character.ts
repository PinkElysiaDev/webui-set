import * as THREE from 'three'
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js'
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js'
import AmmoFactory from 'three/examples/jsm/libs/ammo.wasm.js'
import ammoWasmUrl from 'three/examples/jsm/libs/ammo.wasm.wasm?url'
import type { WindField } from './windfield'

/**
 * 角色：MMD pmx 加载（MMDToon 材质）+ ammo 物理长发 + 程序化 idle
 * （呼吸/重心微摆/视线跟随/眨眼）+ 风力注入物理世界。
 */

let ammoReady: Promise<AmmoNS> | null = null

interface AmmoNS {
  btVector3: new (x: number, y: number, z: number) => BtVector3
}
interface BtVector3 {
  setValue(x: number, y: number, z: number): void
}

/** 初始化全局 Ammo（MMDPhysics 依赖 window.Ammo），进程内只做一次 */
export function initAmmo(): Promise<AmmoNS> {
  if (!ammoReady) {
    // vite 下 document.currentScript 不可用，需显式指明 wasm 文件地址
    ammoReady = AmmoFactory({ locateFile: () => ammoWasmUrl }) as Promise<AmmoNS>
    ammoReady.then((Ammo) => {
      ;(window as unknown as { Ammo: unknown }).Ammo = Ammo
    })
  }
  return ammoReady
}

interface RigidBodyLike {
  body?: {
    getMass?: () => number
    applyCentralImpulse?: (v: BtVector3) => void
    activate?: () => void
  }
  bone?: THREE.Bone | null
}

export interface CharacterHandles {
  mesh: THREE.SkinnedMesh
  /** 登录成功时切「开心」表情 */
  setHappy(): void
  update(
    dt: number,
    elapsed: number,
    camera: THREE.Camera,
    wind: WindField,
    pointer: { x: number; y: number },
  ): void
}

export async function loadCharacter(modelUrl: string, resourcePath: string): Promise<CharacterHandles> {
  const Ammo = await initAmmo()
  const loader = new MMDLoader()
  loader.setResourcePath(resourcePath)
  const mesh = await new Promise<THREE.SkinnedMesh>((resolve, reject) => {
    loader.load(modelUrl, resolve, undefined, reject)
  })

  const helper = new MMDAnimationHelper()
  helper.add(mesh, { physics: true })

  // 物理预热：先跑若干步让长发从初始姿势稳定下来
  for (let i = 0; i < 90; i += 1) helper.update(1 / 60)

  const bones = mesh.skeleton.bones
  const findBone = (...names: string[]) =>
    bones.find((bone) => names.some((n) => bone.name.includes(n)))
  const center = findBone('センター', 'center', '中心')
  const upper = findBone('上半身', 'upper', '上身')
  const head = findBone('頭', '头', 'head')
  const neck = findBone('首', 'neck', '脖')

  // 眨眼 / 微笑 morph 探测
  const dict = mesh.morphTargetDictionary ?? {}
  const influences = mesh.morphTargetInfluences!
  const morphKeys = Object.keys(dict)
  const blinkKey = morphKeys.find((k) => k.includes('まばたき') || k.includes('眨眼')) ?? null
  const smileKey =
    morphKeys.find((k) => k.includes('にっこり') || k.includes('微笑') || (k.includes('笑') && !k.includes('泣'))) ?? null
  const happyKey = morphKeys.find((k) => k.includes('にっこり') || k.includes('开心') || k.includes('喜')) ?? smileKey
  if (smileKey) influences[dict[smileKey]] = 0.35

  let blinkTimer = 2
  let blinkPhase = -1 // -1 未在眨眼

  // 风力注入：helper 内部物理的刚体列表（不存在则静默跳过）
  const physics = (
    helper.objects.get(mesh) as { physics?: { _rigidBodies?: RigidBodyLike[] } } | undefined
  )?.physics
  const rigidBodies = physics?._rigidBodies ?? []
  const impulse = new Ammo.btVector3(0, 0, 0)
  const tmpWorld = new THREE.Vector3()
  const tmpProj = new THREE.Vector3()

  function setHappy() {
    if (happyKey) influences[dict[happyKey]] = 0.9
  }

  function update(
    dt: number,
    elapsed: number,
    camera: THREE.Camera,
    wind: WindField,
    pointer: { x: number; y: number },
  ) {
    // —— 程序化 idle（kinematic 链，物理发丝跟随） ——
    if (center) center.position.y += Math.sin(elapsed * 1.7) * 0.006
    if (upper) {
      upper.rotation.z = Math.sin(elapsed * 0.5) * 0.03
      upper.rotation.x = Math.sin(elapsed * 1.7) * 0.012
    }
    if (head) {
      // 视线跟随指针（限幅 ±8°）
      head.rotation.y = THREE.MathUtils.clamp((pointer.x - 0.5) * 0.28, -0.14, 0.14)
      head.rotation.x = THREE.MathUtils.clamp((0.5 - pointer.y) * 0.2, -0.1, 0.1)
    } else if (neck) {
      neck.rotation.y = THREE.MathUtils.clamp((pointer.x - 0.5) * 0.2, -0.1, 0.1)
    }

    // —— 眨眼 ——
    blinkTimer -= dt
    if (blinkTimer <= 0 && blinkPhase < 0) {
      blinkPhase = 0
      blinkTimer = 3 + Math.random() * 3
    }
    if (blinkPhase >= 0 && blinkKey) {
      blinkPhase += dt / 0.18
      const weight = blinkPhase < 1 ? blinkPhase : Math.max(0, 2 - blinkPhase)
      influences[dict[blinkKey]] = Math.min(1, weight)
      if (blinkPhase >= 2) {
        influences[dict[blinkKey]] = 0
        blinkPhase = -1
      }
    }

    // —— 风力注入：动态刚体按屏幕位置采样风场 ——
    // 相机为轴对齐（无旋转），屏幕风可直接映射世界方向：屏左=-X、屏上=+Y
    if (rigidBodies.length > 0) {
      const gust = wind.gust()
      for (const rb of rigidBodies) {
        const body = rb.body
        if (!body?.getMass || body.getMass() <= 0 || !rb.bone) continue
        rb.bone.getWorldPosition(tmpWorld)
        tmpProj.copy(tmpWorld).project(camera)
        if (tmpProj.z > 1) continue
        const w = wind.sample((tmpProj.x + 1) / 2, (tmpProj.y + 1) / 2)
        impulse.setValue(w.x * 0.045, w.y * 0.02 + 0.004 * gust, -0.012 * gust)
        body.applyCentralImpulse?.(impulse)
        body.activate?.()
      }
    }

    helper.update(dt)
  }

  return { mesh, setHappy, update }
}
