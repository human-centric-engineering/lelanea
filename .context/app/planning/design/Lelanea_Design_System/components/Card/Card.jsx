/** Elevated surface card. Optional lowercase eyebrow, serif title, body copy and meta line. */
export function Card({ eyebrow, title, children, meta, dark = false, onClick, style }) {
  return (
    <div onClick={onClick} style={{
      background: dark ? '#3A3F42' : '#EBE6DF',
      border: dark ? '1px solid rgba(227,218,209,0.08)' : 'none',
      borderRadius: 20, padding: 22, boxSizing: 'border-box',
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
      fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>
      {eyebrow && (
        <div style={{
          fontSize: 11, letterSpacing: '0.14em', textTransform: 'lowercase',
          color: '#6F7376', fontWeight: 500, marginBottom: 10,
        }}>{eyebrow}</div>
      )}
      {title && (
        <div style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 24, lineHeight: 1.15, letterSpacing: '-0.015em',
          color: dark ? '#F3F0EC' : '#11181A', marginBottom: children ? 8 : 0,
        }}>{title}</div>
      )}
      {children && (
        <div style={{ fontSize: 14, lineHeight: 1.55, color: dark ? '#E3DAD1' : '#282C2E' }}>{children}</div>
      )}
      {meta && (
        <div style={{ fontSize: 12, color: '#6F7376', marginTop: 14 }}>{meta}</div>
      )}
    </div>
  );
}
