const TONES = {
  success: { bg: '#EDF3F0', border: '#457B6A', fg: '#2E5447', dot: '#457B6A' },
  error:   { bg: '#F4E6E3', border: '#B75D52', fg: '#7A3A33', dot: '#B75D52' },
  warning: { bg: '#F6EEDA', border: '#C9A65D', fg: '#6E5524', dot: '#C9A65D' },
  info:    { bg: '#E4ECF4', border: '#497AA8', fg: '#2D4A6E', dot: '#497AA8' },
};

/** System state banner. Quiet by design — a dot, a lead phrase, then the detail. */
export function Banner({ tone = 'info', lead, children, style }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '14px 16px', borderRadius: 12,
      background: t.bg, border: `1px solid ${t.border}`, color: t.fg,
      fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
      fontSize: 14, lineHeight: 1.45, ...style,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: t.dot,
        marginTop: 7, flex: '0 0 auto',
      }} />
      <div>
        {lead && <strong style={{ fontWeight: 500 }}>{lead} </strong>}
        {children}
      </div>
    </div>
  );
}
