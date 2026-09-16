import { useState } from 'react'
import type { Stage } from '../scene/stage'

type ItemId = 'far' | 'mid' | 'character' | 'front'

interface SequenceItem { id: ItemId; label: string; start: number }

const GAP = 0.9

/**
 * 入场时序调试面板（仅 ?sequence 参数时挂载，DEV 工具，不入正式交互）。
 * 自由排列四个元素的淡入开始时刻，即时重放整段入场。
 */
export function SequencePanel({ stageRef }: { stageRef: React.RefObject<Stage | null> }) {
  const [order, setOrder] = useState<SequenceItem[]>([
    { id: 'far', label: '花海1 · 远景小花带', start: 0.3 },
    { id: 'mid', label: '花海2 · 中景郁金香', start: 1.2 },
    { id: 'character', label: '人物 · 爱莉希雅', start: 2.1 },
    { id: 'front', label: '花海3 · 前景大花', start: 3.0 },
  ])

  function replay(list: SequenceItem[]) {
    const sequence = { far: 0, mid: 0, character: 0, front: 0 }
    for (const item of list) sequence[item.id] = item.start
    stageRef.current?.replaySequence(sequence)
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...order]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const renumbered = next.map((item, position) => ({ ...item, start: Number((0.3 + position * GAP).toFixed(1)) }))
    setOrder(renumbered)
    replay(renumbered)
  }

  function setStart(id: ItemId, start: number) {
    const next = order.map(item => item.id === id ? { ...item, start } : item)
    setOrder(next)
    replay(next)
  }

  return (
    <aside className="sequence-panel">
      <b>入场时序调试</b>
      <span className="sequence-hint">上→下 = 出现顺序；◀▶ 交换位置；数字 = 开始秒数（天空 t=0 常驻）</span>
      <ol>
        {order.map((item, index) => (
          <li key={item.id} data-id={item.id}>
            <span className="sequence-name">{item.label}</span>
            <button type="button" aria-label="上移" onClick={() => move(index, -1)} disabled={index === 0}>◀</button>
            <input
              type="number" min={0} max={10} step={0.1} value={item.start}
              onChange={event => setStart(item.id, Number(event.target.value))}
            />
            <button type="button" aria-label="下移" onClick={() => move(index, 1)} disabled={index === order.length - 1}>▶</button>
          </li>
        ))}
      </ol>
      <button type="button" className="sequence-replay" onClick={() => replay(order)}>重放入场</button>
    </aside>
  )
}
