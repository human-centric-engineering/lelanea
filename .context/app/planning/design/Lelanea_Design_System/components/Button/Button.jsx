const BASE = {
  fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
  fontWeight: 500, lineHeight: 1, borderRadius: 999,
  border: '1px solid transparent', cursor: 'pointer',
  transition: 'background 200ms cubic-bezier(0.22,0.61,0.36,1), transform 200ms cubic-bezier(0.22,0.61,0.36,1)',
};

const SIZES = {
  sm: { fontSize: 14, padding: '10px 18px' },
  md: { fontSize: 16, padding: '14px 24px' },
  lg: { fontSize: 17, padding: '16px 32px' },
};

const VARIANTS = {
  primary:     { background: '#C96F43', color: '#F3F0EC', hover: '#B5633B' },
  secondary:   { background: '#EBE6DF', color: '#11181A', borderColor: 'rgba(111,115,118,0.24)', hover: '#E3DDD4' },
  ghost:       { background: 'transparent', color: '#11181A', hover: '#EBE6DF' },
  destructive: { background: '#B75D52', color: '#F3F0EC', hover: '#A45248' },
};

/** Pill button in the Lelanea palette. Press scales to 0.98; hover deepens, never brightens. */
export function Button({ children, variant = 'primary', size = 'md', block = false, disabled = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      disabled={disabled}
      style={{
        ...BASE, ...SIZES[size],
        background: hover && !disabled ? v.hover : v.background,
        color: v.color,
        borderColor: v.borderColor || 'transparent',
        width: block ? '100%' : undefined,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transform: press && !disabled ? 'scale(0.98)' : 'scale(1)',
        boxShadow: variant === 'primary' && !disabled ? '0 8px 24px rgba(201,111,67,0.22)' : 'none',
        ...style,
      }}>
      {children}
    </button>
  );
}
