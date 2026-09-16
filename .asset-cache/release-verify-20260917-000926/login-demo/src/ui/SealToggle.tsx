/** 刻印式昼夜切换：环 + 花形印记，日=琥珀、夜=月蓝 */
export function SealToggle({ night, onToggle }: { night: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`seal-toggle ${night ? 'night' : ''}`}
      aria-label={night ? '切换到日间模式' : '切换到夜间模式'}
      aria-pressed={night}
      title={night ? '日间模式' : '夜间模式'}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        {/* 五瓣花印记 */}
        {[0, 72, 144, 216, 288].map((angle) => (
          <ellipse
            key={angle}
            cx="12"
            cy="7.2"
            rx="2.1"
            ry="3.4"
            transform={`rotate(${angle} 12 12)`}
            fill="var(--seal-color)"
            opacity="0.85"
          />
        ))}
        <circle cx="12" cy="12" r="1.6" fill="var(--halo)" />
      </svg>
    </button>
  )
}
