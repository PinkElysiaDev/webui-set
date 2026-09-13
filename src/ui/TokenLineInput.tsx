import { useState } from 'react'

/** 下划线令牌输入：聚焦时粉线自左向右展开 */
export function TokenLineInput({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="line-input">
      <input
        type={visible ? 'text' : 'password'}
        aria-label="Panel Access Token"
        autoFocus
        value={value}
        placeholder="请输入访问令牌"
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="ink-line" aria-hidden />
      <button
        type="button"
        tabIndex={-1}
        className="eye"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '隐藏' : '显示'}
      >
        {visible ? '隐藏' : '显示'}
      </button>
    </div>
  )
}
