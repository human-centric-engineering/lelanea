/** Tag pill for themes and filters. Selected uses heather amethyst; `tone="teal"` marks an active teaching. */
export function Chip({ children, selected = false, tone = 'default', onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const palettes = {
    default: { bg: '#EBE6DF', fg: '#11181A', border: 'rgba(111,115,118,0.24)', hoverBg: '#E3DDD4' },
    teal:    { bg: '#17718A', fg: '#F3F0EC', border: 'transparent', hoverBg: '#145F74' },
  };
  const p = selected
    ? { bg: '#806C7B', fg: '#F3F0EC', border: 'transparent', hoverBg: '#725F6D' }
    : (palettes[tone] || palettes.default);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
        fontSize: 13, lineHeight: 1, padding: '9px 15px', borderRadius: 999,
        background: hover ? p.hoverBg : p.bg, color: p.fg,
        border: `1px solid ${p.border}`, cursor: 'pointer',
        transition: 'background 200ms cubic-bezier(0.22,0.61,0.36,1)',
        ...style,
      }}>
      {children}
    </button>
  );
}
