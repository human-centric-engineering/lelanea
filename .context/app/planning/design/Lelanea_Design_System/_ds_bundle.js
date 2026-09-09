/* @ds-bundle: {"format":4,"namespace":"LelaneaDesignSystem_a15360","components":[{"name":"Banner","sourcePath":"components/Banner/Banner.jsx"},{"name":"Button","sourcePath":"components/Button/Button.jsx"},{"name":"Card","sourcePath":"components/Card/Card.jsx"},{"name":"ChatBubble","sourcePath":"components/ChatBubble/ChatBubble.jsx"},{"name":"Chip","sourcePath":"components/Chip/Chip.jsx"},{"name":"Lotus","sourcePath":"components/Lotus/Lotus.jsx"},{"name":"LotusMark","sourcePath":"components/LotusMark/LotusMark.jsx"}],"sourceHashes":{"components/Banner/Banner.jsx":"25dd201c2828","components/Button/Button.jsx":"4a1a6d1cb3c7","components/Card/Card.jsx":"2d5025b37fc0","components/ChatBubble/ChatBubble.jsx":"9df33735853c","components/Chip/Chip.jsx":"c37b929e4526","components/Lotus/Lotus.jsx":"261d4d79d75e","components/LotusMark/LotusMark.jsx":"f3cd27344265","doc-page.js":"f52ae9c02fca","ui_kits/lelanea_app/Primitives.jsx":"d95f51b2cf25","ui_kits/lelanea_app/Screens.jsx":"925d52f46309","ui_kits/lelanea_app/ios-frame.jsx":"d67eb3ffe562","ui_kits/lelanea_app/lotus-figure.jsx":"fa789dfb3936"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.LelaneaDesignSystem_a15360 = window.LelaneaDesignSystem_a15360 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/Banner/Banner.jsx
try { (() => {
const TONES = {
  success: {
    bg: '#EDF3F0',
    border: '#457B6A',
    fg: '#2E5447',
    dot: '#457B6A'
  },
  error: {
    bg: '#F4E6E3',
    border: '#B75D52',
    fg: '#7A3A33',
    dot: '#B75D52'
  },
  warning: {
    bg: '#F6EEDA',
    border: '#C9A65D',
    fg: '#6E5524',
    dot: '#C9A65D'
  },
  info: {
    bg: '#E4ECF4',
    border: '#497AA8',
    fg: '#2D4A6E',
    dot: '#497AA8'
  }
};

/** System state banner. Quiet by design — a dot, a lead phrase, then the detail. */
function Banner({
  tone = 'info',
  lead,
  children,
  style
}) {
  const t = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      padding: '14px 16px',
      borderRadius: 12,
      background: t.bg,
      border: `1px solid ${t.border}`,
      color: t.fg,
      fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
      fontSize: 14,
      lineHeight: 1.45,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: t.dot,
      marginTop: 7,
      flex: '0 0 auto'
    }
  }), /*#__PURE__*/React.createElement("div", null, lead && /*#__PURE__*/React.createElement("strong", {
    style: {
      fontWeight: 500
    }
  }, lead, " "), children));
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Banner/Banner.jsx", error: String((e && e.message) || e) }); }

// components/Button/Button.jsx
try { (() => {
const BASE = {
  fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
  fontWeight: 500,
  lineHeight: 1,
  borderRadius: 999,
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background 200ms cubic-bezier(0.22,0.61,0.36,1), transform 200ms cubic-bezier(0.22,0.61,0.36,1)'
};
const SIZES = {
  sm: {
    fontSize: 14,
    padding: '10px 18px'
  },
  md: {
    fontSize: 16,
    padding: '14px 24px'
  },
  lg: {
    fontSize: 17,
    padding: '16px 32px'
  }
};
const VARIANTS = {
  primary: {
    background: '#C96F43',
    color: '#F3F0EC',
    hover: '#B5633B'
  },
  secondary: {
    background: '#EBE6DF',
    color: '#11181A',
    borderColor: 'rgba(111,115,118,0.24)',
    hover: '#E3DDD4'
  },
  ghost: {
    background: 'transparent',
    color: '#11181A',
    hover: '#EBE6DF'
  },
  destructive: {
    background: '#B75D52',
    color: '#F3F0EC',
    hover: '#A45248'
  }
};

/** Pill button in the Lelanea palette. Press scales to 0.98; hover deepens, never brightens. */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  return /*#__PURE__*/React.createElement("button", {
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    disabled: disabled,
    style: {
      ...BASE,
      ...SIZES[size],
      background: hover && !disabled ? v.hover : v.background,
      color: v.color,
      borderColor: v.borderColor || 'transparent',
      width: block ? '100%' : undefined,
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transform: press && !disabled ? 'scale(0.98)' : 'scale(1)',
      boxShadow: variant === 'primary' && !disabled ? '0 8px 24px rgba(201,111,67,0.22)' : 'none',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/Card/Card.jsx
try { (() => {
/** Elevated surface card. Optional lowercase eyebrow, serif title, body copy and meta line. */
function Card({
  eyebrow,
  title,
  children,
  meta,
  dark = false,
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    style: {
      background: dark ? '#3A3F42' : '#EBE6DF',
      border: dark ? '1px solid rgba(227,218,209,0.08)' : 'none',
      borderRadius: 20,
      padding: 22,
      boxSizing: 'border-box',
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)',
      fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
      cursor: onClick ? 'pointer' : 'default',
      ...style
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      letterSpacing: '0.14em',
      textTransform: 'lowercase',
      color: '#6F7376',
      fontWeight: 500,
      marginBottom: 10
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', Georgia, serif",
      fontSize: 24,
      lineHeight: 1.15,
      letterSpacing: '-0.015em',
      color: dark ? '#F3F0EC' : '#11181A',
      marginBottom: children ? 8 : 0
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      lineHeight: 1.55,
      color: dark ? '#E3DAD1' : '#282C2E'
    }
  }, children), meta && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: '#6F7376',
      marginTop: 14
    }
  }, meta));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Card/Card.jsx", error: String((e && e.message) || e) }); }

// components/ChatBubble/ChatBubble.jsx
try { (() => {
/** A single chat turn. `from="ai"` renders the stone bubble with the lotus avatar; `from="user"` the teal bubble. */
function ChatBubble({
  from = 'ai',
  children,
  avatar = true,
  style
}) {
  const isAI = from === 'ai';
  const bubble = {
    padding: '12px 16px',
    borderRadius: 20,
    maxWidth: '78%',
    fontSize: 15,
    lineHeight: 1.45,
    fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
    background: isAI ? '#EBE6DF' : '#17718A',
    color: isAI ? '#11181A' : '#F3F0EC',
    borderBottomLeftRadius: isAI ? 6 : 20,
    borderBottomRightRadius: isAI ? 20 : 6
  };
  const LM = typeof LotusMark === 'function' ? LotusMark : null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-end',
      justifyContent: isAI ? 'flex-start' : 'flex-end',
      ...style
    }
  }, isAI && avatar && LM && /*#__PURE__*/React.createElement(LM, {
    size: 34,
    water: false
  }), /*#__PURE__*/React.createElement("div", {
    style: bubble
  }, children));
}
Object.assign(__ds_scope, { ChatBubble });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ChatBubble/ChatBubble.jsx", error: String((e && e.message) || e) }); }

// components/Chip/Chip.jsx
try { (() => {
/** Tag pill for themes and filters. Selected uses heather amethyst; `tone="teal"` marks an active teaching. */
function Chip({
  children,
  selected = false,
  tone = 'default',
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const palettes = {
    default: {
      bg: '#EBE6DF',
      fg: '#11181A',
      border: 'rgba(111,115,118,0.24)',
      hoverBg: '#E3DDD4'
    },
    teal: {
      bg: '#17718A',
      fg: '#F3F0EC',
      border: 'transparent',
      hoverBg: '#145F74'
    }
  };
  const p = selected ? {
    bg: '#806C7B',
    fg: '#F3F0EC',
    border: 'transparent',
    hoverBg: '#725F6D'
  } : palettes[tone] || palettes.default;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      fontFamily: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
      fontSize: 13,
      lineHeight: 1,
      padding: '9px 15px',
      borderRadius: 999,
      background: hover ? p.hoverBg : p.bg,
      color: p.fg,
      border: `1px solid ${p.border}`,
      cursor: 'pointer',
      transition: 'background 200ms cubic-bezier(0.22,0.61,0.36,1)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Chip/Chip.jsx", error: String((e && e.message) || e) }); }

// components/Lotus/Lotus.jsx
try { (() => {
// Lotus geometry — keep in sync with assets/lotus-mark.svg, logo-wordmark.svg, thumbnail.html.
// Broad pointed petal rising from (160,175). Wide-angle tiers are short, upright ones long,
// so the bloom reads as a wide fan (measured 134 x 118, aspect 1.14).
const lotusPetal = (L, W) => `M160 175C${(160 + W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},${(160 + W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},160 ${175 - L}` + `C${(160 - W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},${(160 - W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},160 175Z`;
const LOTUS_TIERS = [{
  d: lotusPetal(60, 48),
  fill: '#17718A',
  stroke: '#0E5064',
  angles: [-66, 66, -46, 46, -25, 25],
  base: 340
}, {
  d: lotusPetal(78, 50),
  fill: '#3E96AE',
  stroke: '#17718A',
  angles: [-42, 42, -26, 26, -11, 11],
  base: 180
}, {
  d: lotusPetal(98, 52),
  fill: '#7CC0D6',
  stroke: '#2E8BA5',
  angles: [-30, 30, -15, 15, 0],
  base: 40
}];
const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0];
const LOTUS_VEIN_D = 'M160 164 160 88';
const LOTUS_CORE_CY = 172;
const LOTUS_RIPPLES = [{
  rx: 50,
  ry: 6,
  stroke: '#457B6A',
  op: 0.55,
  w: 1.6
}, {
  rx: 74,
  ry: 9,
  stroke: '#457B6A',
  op: 0.34,
  w: 1.4
}, {
  rx: 97,
  ry: 12,
  stroke: '#6FA88F',
  op: 0.2,
  w: 1.2
}];
const LOTUS_RIPPLE_CY = 188;

// `bloomFrac` is the measured share of the frame width the bloom occupies, so `size`
// means the bloom itself and stays interchangeable between Lotus and LotusMark.
const LOTUS_FRAMES = {
  water: {
    box: '58 72 204 132',
    aspect: 132 / 204,
    bloomFrac: 0.658,
    stroke: 1.5
  },
  tight: {
    box: '86 74 148 126',
    aspect: 126 / 148,
    bloomFrac: 0.95,
    stroke: 1.9
  }
};
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** The Lelanea lotus: three tiers of broad pointed petals that fan open on launch. */
function Lotus({
  size = 140,
  open: openProp,
  autoOpen = true,
  idle = true,
  water = true,
  delay = 0,
  onOpened
}) {
  const controlled = typeof openProp === 'boolean';
  const [selfOpen, setSelfOpen] = React.useState(false);
  const open = controlled ? openProp : selfOpen;
  React.useEffect(() => {
    if (controlled || !autoOpen) return;
    const t = setTimeout(() => {
      setSelfOpen(true);
      if (onOpened) setTimeout(onOpened, 2400);
    }, delay);
    return () => clearTimeout(t);
  }, [controlled, autoOpen, delay, onOpened]);
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  const frameH = frameW * f.aspect;
  const uid = React.useId ? React.useId().replace(/:/g, '') : 'lot';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: frameW,
      height: frameH,
      position: 'relative',
      display: 'inline-block',
      animation: open && idle ? 'lelanea-lotus-breath 4s ease-in-out infinite' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: -frameW * 0.16,
      background: 'radial-gradient(ellipse at 50% 62%, rgba(124,192,214,0.20) 0%, rgba(243,240,236,0) 62%)',
      pointerEvents: 'none',
      opacity: open ? 1 : 0,
      transition: `opacity 1600ms ${EASE}`
    }
  }), /*#__PURE__*/React.createElement("svg", {
    width: frameW,
    height: frameH,
    viewBox: f.box,
    style: {
      position: 'relative',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: `lotus-core-${uid}`,
    cx: "50%",
    cy: "42%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#F0A078"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "55%",
    stopColor: "#C96F43"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#9C5530"
  }))), water && /*#__PURE__*/React.createElement("g", {
    fill: "none",
    strokeLinecap: "round",
    style: {
      transformOrigin: `160px ${LOTUS_RIPPLE_CY}px`,
      transform: open ? 'scale(1)' : 'scale(0.55)',
      opacity: open ? 1 : 0,
      transition: `transform 2600ms ${EASE} 300ms, opacity 2000ms ${EASE} 300ms`
    }
  }, LOTUS_RIPPLES.map((r, i) => /*#__PURE__*/React.createElement("ellipse", {
    key: i,
    cx: "160",
    cy: LOTUS_RIPPLE_CY,
    rx: r.rx,
    ry: r.ry,
    stroke: r.stroke,
    strokeOpacity: r.op,
    strokeWidth: r.w
  }))), LOTUS_TIERS.map((tier, ti) => /*#__PURE__*/React.createElement("g", {
    key: ti,
    fill: tier.fill,
    stroke: tier.stroke,
    strokeWidth: f.stroke,
    strokeLinejoin: "round"
  }, tier.angles.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: tier.d,
    style: {
      transformOrigin: '160px 175px',
      transform: open ? `rotate(${a}deg) scale(1)` : `rotate(${a * 0.18}deg) scale(0.34)`,
      opacity: open ? 1 : 0,
      transition: `transform 2200ms ${EASE} ${tier.base + i * 70}ms, opacity 1500ms ${EASE} ${tier.base + i * 70}ms`
    }
  })))), /*#__PURE__*/React.createElement("g", {
    stroke: "#A8D6E5",
    strokeWidth: "1.2",
    fill: "none",
    style: {
      opacity: open ? 0.5 : 0,
      transition: `opacity 1400ms ${EASE} 900ms`
    }
  }, LOTUS_VEIN_ANGLES.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: LOTUS_VEIN_D,
    style: {
      transformOrigin: '160px 175px',
      transform: `rotate(${a}deg)`
    }
  }))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY,
    rx: "8",
    ry: "10",
    fill: `url(#lotus-core-${uid})`,
    style: {
      transformOrigin: `160px ${LOTUS_CORE_CY}px`,
      transform: open ? 'scale(1)' : 'scale(0.3)',
      opacity: open ? 1 : 0,
      filter: open ? 'drop-shadow(0 0 12px rgba(201,111,67,0.5))' : 'none',
      transition: `transform 1500ms ${EASE} 240ms, opacity 1200ms ${EASE} 240ms, filter 1500ms ${EASE} 240ms`
    }
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY - 3,
    rx: "2.8",
    ry: "3.4",
    fill: "#F5B896",
    style: {
      opacity: open ? 0.85 : 0,
      transition: `opacity 1200ms ${EASE} 600ms`
    }
  })));
}
if (typeof document !== 'undefined' && !document.getElementById('lelanea-lotus-kf')) {
  const s = document.createElement('style');
  s.id = 'lelanea-lotus-kf';
  s.textContent = '@keyframes lelanea-lotus-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}';
  document.head.appendChild(s);
}
Object.assign(__ds_scope, { Lotus });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Lotus/Lotus.jsx", error: String((e && e.message) || e) }); }

// components/LotusMark/LotusMark.jsx
try { (() => {
// Lotus geometry — keep in sync with assets/lotus-mark.svg, logo-wordmark.svg, thumbnail.html.
// Broad pointed petal rising from (160,175). Wide-angle tiers are short, upright ones long,
// so the bloom reads as a wide fan (measured 134 x 118, aspect 1.14).
const lotusPetal = (L, W) => `M160 175C${(160 + W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},${(160 + W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},160 ${175 - L}` + `C${(160 - W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},${(160 - W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},160 175Z`;
const LOTUS_TIERS = [{
  d: lotusPetal(60, 48),
  fill: '#17718A',
  stroke: '#0E5064',
  angles: [-66, 66, -46, 46, -25, 25],
  base: 340
}, {
  d: lotusPetal(78, 50),
  fill: '#3E96AE',
  stroke: '#17718A',
  angles: [-42, 42, -26, 26, -11, 11],
  base: 180
}, {
  d: lotusPetal(98, 52),
  fill: '#7CC0D6',
  stroke: '#2E8BA5',
  angles: [-30, 30, -15, 15, 0],
  base: 40
}];
const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0];
const LOTUS_VEIN_D = 'M160 164 160 88';
const LOTUS_CORE_CY = 172;
const LOTUS_RIPPLES = [{
  rx: 50,
  ry: 6,
  stroke: '#457B6A',
  op: 0.55,
  w: 1.6
}, {
  rx: 74,
  ry: 9,
  stroke: '#457B6A',
  op: 0.34,
  w: 1.4
}, {
  rx: 97,
  ry: 12,
  stroke: '#6FA88F',
  op: 0.2,
  w: 1.2
}];
const LOTUS_RIPPLE_CY = 188;

// `bloomFrac` is the measured share of the frame width the bloom occupies, so `size`
// means the bloom itself and stays interchangeable between Lotus and LotusMark.
const LOTUS_FRAMES = {
  water: {
    box: '58 72 204 132',
    aspect: 132 / 204,
    bloomFrac: 0.658,
    stroke: 1.5
  },
  tight: {
    box: '86 74 148 126',
    aspect: 126 / 148,
    bloomFrac: 0.95,
    stroke: 1.9
  }
};

/** Static lotus glyph for avatars, favicons and inline marks. `water={false}` crops tight to the bloom. */
function LotusMark({
  size = 32,
  water = true,
  style
}) {
  const uid = React.useId ? React.useId().replace(/:/g, '') : 'lm';
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  return /*#__PURE__*/React.createElement("svg", {
    width: Math.round(frameW),
    height: Math.round(frameW * f.aspect),
    viewBox: f.box,
    style: style,
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: `lm-${uid}`,
    cx: "50%",
    cy: "42%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#F0A078"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "55%",
    stopColor: "#C96F43"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#9C5530"
  }))), water && /*#__PURE__*/React.createElement("g", {
    fill: "none",
    strokeLinecap: "round"
  }, LOTUS_RIPPLES.map((r, i) => /*#__PURE__*/React.createElement("ellipse", {
    key: i,
    cx: "160",
    cy: LOTUS_RIPPLE_CY,
    rx: r.rx,
    ry: r.ry,
    stroke: r.stroke,
    strokeOpacity: r.op,
    strokeWidth: r.w
  }))), LOTUS_TIERS.map((t, ti) => /*#__PURE__*/React.createElement("g", {
    key: ti,
    fill: t.fill,
    stroke: t.stroke,
    strokeWidth: f.stroke,
    strokeLinejoin: "round"
  }, t.angles.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: t.d,
    transform: `rotate(${a} 160 175)`
  })))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY,
    rx: "8",
    ry: "10",
    fill: `url(#lm-${uid})`
  }));
}
Object.assign(__ds_scope, { LotusMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/LotusMark/LotusMark.jsx", error: String((e && e.message) || e) }); }

// doc-page.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <doc-page> — paged-document shell for printable HTML.
 *
 * FIRST, decide how the document paginates — up front, before building:
 *
 * - FLOWING document (the default): write the whole document as one
 *   normal HTML flow inside <doc-page>; the browser's print engine
 *   splits it onto pages at export. Use for long-form documents with a
 *   single text flow: reports, memos, letters, essays.
 * - EXPLICIT pagination: a fixed set of pre-paginated pages, one
 *   <section class="page"> child per page. Use when the user asks for a
 *   specific page count, or the design implies one: a one-page resume, a
 *   two-sided flier, a poster, a certificate, a brochure — any richly
 *   laid-out document without a single text flow.
 * - If in doubt, ask the user as part of the build.
 *
 * PAGE SIZING — paper differs by country (letter vs A4), so the printed
 * sheet is not one fixed truth:
 * - FLOWING documents pin NO paper size: the print engine paginates
 *   onto the user's real paper, and the content reflows to it.
 * - EXPLICITLY PAGINATED documents print each page at a FIXED page box
 *   with overflow hidden — letter by default, size="a4" for a clearly
 *   metric user, the user's chosen paper when they export. Design each
 *   page to FILL that box, fitting letter and A4 alike without overlap.
 * - width/height pin an explicit fixed size, ONLY when the user gives
 *   one.
 * Never write your own @page rule or hard-code paper dimensions in the
 * content.
 *
 * Sizing modes (attributes):
 *   (none)                      — portrait: flowing docs use the user's
 *           paper; explicitly paginated pages use the named size box
 *           (letter unless size="a4")
 *   orientation="landscape"     — the same, landscape
 *   width / height              — explicit fixed size, ONLY when the user
 *           gives one (e.g. width="22in" height="30in" for a 22×30
 *           poster): the page IS the design's size, printed at true
 *           dimensions (or scaled onto the user's paper at print time).
 *           Any absolute CSS length: px/in/mm/cm/pt/pc.
 * The component announces the chosen mode to the host app at runtime (a
 * meta tag it injects), so the print path can inject the user's true
 * paper size.
 *
 * On screen the document renders on a desk background: a flowing
 * document as one tall scrolling sheet (Google Docs' pageless view);
 * explicitly paginated documents as one card per page.
 *
 * EXPLICIT pagination usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page>
 *     <section class="page" id="p1">…one page's design…</section>
 *     <section class="page" id="p2">…</section>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * How the page box works, concretely: each .page prints as ONE full-bleed
 * sheet at a FIXED physical size — letter by default (set size="a4" for
 * a clearly metric user), the user's chosen paper when they export —
 * with overflow hidden. Nothing scrolls and nothing reflows onto a next
 * sheet: content that misses the box is CLIPPED. Design each page to
 * FILL that page box, and to fit it — letter and A4 alike — without
 * overlap. Each page is a size container; don't size anything in
 * viewport units (they track the window, not the page), and never set
 * width or height on the .page section itself (the component sizes the
 * page box; an authored height like 100% is meaningless at print and is
 * overridden). The component owns the page box, the screen card chrome,
 * and the page breaks (never add your own break-before/after). Don't mix
 * .page sections with flowing content or header/footer slots in the same
 * document.
 *
 * FLOWING usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page margin="0.75in">
 *     <h1>Title</h1>
 *     <p>…body…</p>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * There is no manual page-splitting — the browser's print engine
 * paginates at export. Standard break-hygiene rules (`break-inside:
 * avoid` on figures, code blocks, images and table rows; `orphans/
 * widows: 3`) are applied so paragraphs and groups split cleanly. On
 * screen and at print, headings default to `text-wrap: balance` and
 * body text to `text-wrap: pretty`; the defaults have zero specificity,
 * so any text-wrap you declare wins.
 *
 * Other attributes:
 *   size    — letter | a4 | legal (default letter). Flowing documents:
 *           preview proportion only — it does NOT pin their printed
 *           paper (the print dialog's paper governs); leave it alone
 *           there. Explicitly paginated documents: it sets the page box
 *           the cards and the pinned @page share (the export dialog's
 *           choice overrides both at print) — set size="a4" for a
 *           clearly metric user. Scaled-fit: names the sheet the fit is
 *           computed against, same a4-for-metric-users advice.
 *   content-width / content-height — the design's own fixed dimensions
 *           (CSS lengths), for scaling a fixed-size design ONTO the
 *           named sheet: content lays out at exactly this size, and the
 *           component scales it to fit that sheet's printable area
 *           (centered horizontally, top-aligned; the export dialog
 *           re-fits to the user's actual paper choice where available).
 *           Both must be set; they do not change the page box. For pages
 *           WITHOUT running header/footer slots.
 *   margin  — printable inset on every page of a FLOWING document
 *           (default 0.75in); margin="0" makes pages full-bleed.
 *           Explicitly paginated pages are always full-bleed.
 *
 * Running header/footer (flowing documents only): give an element
 * `slot="header"` or `slot="footer"` and it repeats on every printed
 * page via `position: fixed`. To keep body text from sliding under it,
 * the component prints inside a single-cell table whose <thead>/<tfoot>
 * are spacers sized to the header/footer height — browsers repeat
 * thead/tfoot on every page, so each sheet's content starts below the
 * header and ends above the footer. On screen the header/footer render
 * once at the top/bottom of the sheet.
 *
 * At print the component injects `@page { margin: 0 }` (which leaves
 * Chrome no margin box to draw its date/URL/page-count header in) and
 * moves the visual margin onto the sheet's own padding. It also marks
 * the document as owning its print CSS (a
 * `meta[name="omelette-owns-print"]` it injects at runtime), so the
 * PDF export never injects page-geometry CSS of its own on top.
 *
 * Print best practices for the content you author:
 * - Multi-column text: use CSS columns (`column-count` +
 *   `column-gap`), never side-by-side flex/grid columns — only real
 *   CSS columns flow and break across pages. `column-span: all` lets
 *   a heading span the columns; `hyphens: auto` (needs `lang` on
 *   the html element) keeps narrow columns readable.
 * - Page breaks in flowing documents: `break-before: page` on an
 *   element that must start a new page (a chapter, an appendix). Add
 *   your own kept-together blocks (callouts, stat tiles, cards) to a
 *   `break-inside: avoid` rule, and keep each one shorter than a page.
 * - Extend `orphans: 3; widows: 3` to any custom text blocks you add
 *   (p and li are covered by default).
 * - Give long tables a <thead> — browsers repeat it on every printed
 *   page.
 * - No `position: fixed`/`sticky` and no viewport units in content:
 *   fixed elements stamp every printed page (running headers/footers go
 *   in the component's slots) and `100vh` mis-sizes at print.
 *
 * Author content as static HTML so the user can click-to-edit any text
 * directly. Do not set width/padding/background on the document body —
 * the component owns the sheet box.
 */
/* END USAGE */

(() => {
  const PAPER = {
    letter: ['8.5in', '11in'],
    a4: ['210mm', '297mm'],
    legal: ['8.5in', '14in']
  };
  const CSS_LENGTH = /^\d+(\.\d+)?(px|in|mm|cm|pt|pc)$/;
  // Unitless "0" is a valid CSS length and the natural way to write
  // margin="0"; normalise it to 0px so max()/calc() (which reject a bare
  // number) keep working.
  const safeLen = (v, fb) => {
    v = (v || '').trim();
    return v === '0' ? '0px' : CSS_LENGTH.test(v) ? v : fb;
  };
  // WebKit (Safari and every iOS browser shell) never repeats a table's
  // thead/tfoot on printed pages (WebKit bug 17205), so the spacer-borne
  // vertical margins of a FLOWING document reach only the first page
  // there. Engine check, not browser check: vendor is 'Apple Computer,
  // Inc.' exactly for WebKit and 'Google Inc.' for Blink.
  const WK_PRINT = /apple/i.test(navigator.vendor || '');
  // CSS length → px number (CSS absolute units are exact: 1in = 96px).
  // Returns NaN for anything safeLen would reject — callers gate on it.
  const PX_PER = {
    px: 1,
    in: 96,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16
  };
  const toPx = v => {
    const m = /^(\d+(?:\.\d+)?)(px|in|mm|cm|pt|pc)$/.exec((v || '').trim());
    return m ? parseFloat(m[1]) * PX_PER[m[2]] : NaN;
  };
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      /* When the viewport is narrower than the page, grow to wrap the
       * sheet (plus this padding) instead of staying viewport-width, so
       * the desk background and right margin reach the sheet's far edge
       * in the horizontal scroll. */
      min-width: max-content;
      min-height: 100vh;
      background: #f5f5f4;
      padding: 48px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      --doc-page-w: 8.5in;
      --doc-page-h: 11in;
      --doc-page-margin: 0.75in;
      --doc-hdr-h: 0px;
      --doc-ftr-h: 0px;
      --doc-hdr-pad: 0px;
      --doc-ftr-pad: 0px;
    }
    .sheet {
      width: var(--doc-page-w);
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 2px 10px rgba(20, 20, 19, 0.12);
      border-radius: 7px;
      box-sizing: border-box;
      padding: var(--doc-page-margin);
    }
    .frame { width: 100%; border-collapse: collapse; }
    /* Scaled-fit mode (content-width/content-height): the inner .fit box
     * lays the content out at its authored fixed size and scales it onto
     * the printable area; .fit-box reserves the scaled footprint in flow
     * (transforms don't affect layout) and centers it. Without the mode,
     * both divs are unstyled block pass-throughs. */
    /* Explicit pagination: direct .page children are the pages. The sheet
     * becomes a transparent stack and each page carries the card look on
     * screen; at print each page is exactly one full-bleed sheet. The
     * ::slotted defaults are deliberately weak (document CSS wins), so
     * authored page styling can override any of this. */
    .sheet.paginated {
      background: transparent;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
    }
    .paginated ::slotted(.page) {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: var(--doc-page-ar);
      container-type: size;
      overflow: hidden;
      box-sizing: border-box;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
      break-inside: avoid;
    }
    .paginated ::slotted(.page:not(:first-child)) { margin-top: 1rem; }
    @media print {
      .sheet.paginated { padding: 0; }
      /* The flowing-document vertical inset lives on the repeating
       * thead/tfoot spacers, not the sheet padding — they must go too,
       * or each full-sheet .page is pushed ~margin down and spills onto
       * a second sheet. Paginated pages are full-bleed by definition
       * (content owns its insets). */
      .sheet.paginated .hdr-space,
      .sheet.paginated .ftr-space { height: 0; }
      .paginated ::slotted(.page) {
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        /* Physical page-box sizing, no viewport units: Safari resolves
         * 100vh against the window, not the page box, so a vh-sized card
         * paginates wrong there. --doc-page-w/h are the named size by
         * default and are overridden to the user's chosen paper by the
         * export path, so every card is exactly one sheet either way.
         * Width + height (same source values as @page size) rather than
         * width + aspect-ratio: the ratio is a 6-decimal rounding of the
         * same division, and a few millionths of overflow would spill a
         * blank sheet after every page. The screen-only aspect-ratio
         * (preview proportions) must not leak into print. cqh typography
         * tracks the same box.
         *
         * Every declaration is !important: per CSS Scoping, unimportant
         * shadow ::slotted rules LOSE to the document context, so a page
         * section's authored inline style would silently beat this print
         * geometry. A model-authored height:100% did exactly that — the
         * percentage resolves as auto in the all-auto print ancestry, the
         * base rule's size containment turns auto into ZERO, and
         * overflow:hidden then paints nothing: a blank PDF with perfect
         * page boxes. At print the component's geometry is the design's
         * whole contract, so it must win over any authored sizing. */
        aspect-ratio: auto !important;
        width: var(--doc-page-w) !important;
        height: var(--doc-page-h) !important;
        overflow: hidden !important;
      }
      .paginated ::slotted(.page:not(:first-child)) {
        break-before: page !important;
        margin-top: 0 !important;
      }
    }
    .fit-mode .fit-box {
      width: calc(var(--doc-fit-w) * var(--doc-fit-scale));
      height: calc(var(--doc-fit-h) * var(--doc-fit-scale));
      margin: 0 auto;
      break-inside: avoid;
    }
    /* Monolithic at print: Blink slices a transform-scaled child at
     * fragmentainer boundaries mapped in UNSCALED layout coordinates
     * (transforms are paint-time), so the .fit box (authored size, e.g.
     * 1400x990) gets cut at the page's free block space and spills onto
     * a second sheet even though its SCALED footprint fits the page by
     * construction. overflow:hidden makes .fit-box a scroll container —
     * monolithic under fragmentation (css-break-3) — so the scaled
     * content prints atomically on one sheet. No clipping for content
     * within the authored box: .fit-box is calc-sized to exactly the
     * scaled footprint. (Content that bleeds past content-width/height
     * is clipped at the footprint — fit mode's contract; it previously
     * painted beyond it at print.) Print-only, so the screen rendering
     * keeps visible overflow for editor affordances.
     * The export path injects the same rule into frozen copies
     * (print-eval.ts om-print-fit-contain). The .fit-mode scope is
     * load-bearing: .fit-box wraps slotted content in EVERY mode, and an
     * unscoped overflow:hidden would make whole flowing documents
     * monolithic (one truncated sheet). overflow:hidden, never clip —
     * clip is not a scroll container, so not monolithic. */
    @media print {
      .fit-mode .fit-box { overflow: hidden; }
    }
    .fit-mode .fit {
      width: var(--doc-fit-w);
      height: var(--doc-fit-h);
      transform: scale(var(--doc-fit-scale));
      transform-origin: top left;
    }
    .frame td, .frame th { padding: 0; text-align: left; font-weight: inherit; }
    .hdr-space { height: var(--doc-hdr-h); }
    .ftr-space { height: var(--doc-ftr-h); }
    ::slotted([slot="header"]),
    ::slotted([slot="footer"]) { display: block; box-sizing: border-box; }
    @media print {
      :host { background: none; padding: 0; min-width: 0; min-height: 0; }
      .sheet {
        width: auto; margin: 0; box-shadow: none; border-radius: 0;
        padding: 0 var(--doc-page-margin);
      }
      /* The thead/tfoot spacers repeat on every page, so they carry the
       * vertical page margin (which the sheet's own padding cannot, since
       * that padding is consumed once on the first/last page). The running
       * header/footer are fixed inside that band. */
      /* The 0.35in is breathing room between a running header/footer and
       * the body; without one the spacer is exactly the page margin, so a
       * margin="0" full-bleed document gets truly full-bleed pages. */
      .hdr-space { height: max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))); }
      .ftr-space { height: max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))); }
      /* WebKit flowing documents: @page carries the vertical margin (see
       * _syncPrintPageRule), so the spacers keep only whatever a running
       * header/footer needs BEYOND it — page 1 would otherwise double its
       * top inset. Paginated sheets already zero their spacers above. */
      .sheet.wk-print:not(.paginated) .hdr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))) - var(--doc-page-margin))); }
      .sheet.wk-print:not(.paginated) .ftr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))) - var(--doc-page-margin))); }
      ::slotted([slot="header"]) {
        position: fixed; top: 0; left: 0; right: 0; margin: 0;
        padding: calc(var(--doc-page-margin) * 0.45) var(--doc-page-margin) 0;
      }
      ::slotted([slot="footer"]) {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0;
        padding: 0 var(--doc-page-margin) calc(var(--doc-page-margin) * 0.45);
      }
    }
  `;
  class DocPage extends HTMLElement {
    static get observedAttributes() {
      return ['size', 'width', 'height', 'margin', 'orientation', 'content-width', 'content-height'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._mo = typeof MutationObserver === 'function' ? new MutationObserver(() => this._scheduleMeasure()) : null;
    }

    /** The named paper's [w, h], swapped when orientation="landscape".
     *  Only the named size swaps — explicit width/height are exact values
     *  the author already oriented. */
    _paperSize() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()] || PAPER.letter;
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? [named[1], named[0]] : named;
    }
    get pageWidth() {
      return safeLen(this.getAttribute('width'), this._paperSize()[0]);
    }
    get pageHeight() {
      return safeLen(this.getAttribute('height'), this._paperSize()[1]);
    }
    get pageMargin() {
      return safeLen(this.getAttribute('margin'), '0.75in');
    }

    /** Scaled-fit mode's content box [w, h] as CSS lengths, or null when
     *  the mode is off (either attribute missing/invalid/zero — a partial
     *  declaration falls back to normal flow rather than guessing). */
    _contentFit() {
      const w = safeLen(this.getAttribute('content-width'), null);
      const h = safeLen(this.getAttribute('content-height'), null);
      if (!w || !h) return null;
      const wPx = toPx(w),
        hPx = toPx(h);
      return wPx > 0 && hPx > 0 ? [w, h, wPx, hPx] : null;
    }
    connectedCallback() {
      if (!this._sheet) this._render();
      this._syncSize();
      this._syncPrintPageRule();
      this._ensureTextWrapDefaults();
      this._ensureOwnsPrintMeta();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      if (this._mo) this._mo.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      this._onResize = () => this._scheduleMeasure();
      window.addEventListener('resize', this._onResize);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._scheduleMeasure());
      }
      this._scheduleMeasure();
    }
    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      if (this._mo) this._mo.disconnect();
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      // Drop the head rules when the last doc-page leaves, so a deleted
      // document's @page geometry and text-wrap defaults can't apply to
      // whatever replaces it.
      const survivor = document.querySelector('doc-page');
      if (!survivor) {
        ['doc-page-print', 'doc-page-text-wrap', 'doc-page-owns-print', 'doc-page-fixed-size', 'doc-page-print-sizing'].forEach(id => {
          const tag = document.getElementById(id);
          if (tag) tag.remove();
        });
        // A live deck-stage deferred its own print-sizing meta to ours —
        // hand the page-global meta over so the deck isn't left unmarked.
        const deck = document.querySelector('deck-stage');
        if (deck && typeof deck._ensurePrintSizingMeta === 'function') {
          deck._ensurePrintSizingMeta();
        }
      } else {
        // A departed owner hands each page-global meta to whatever
        // doc-page remains (or it's removed).
        if (typeof survivor._syncFixedSizeMeta === 'function') {
          survivor._syncFixedSizeMeta();
        }
        if (typeof survivor._syncPrintSizingMeta === 'function') {
          survivor._syncPrintSizingMeta();
        }
      }
    }
    attributeChangedCallback() {
      if (!this._sheet) return;
      this._syncSize();
      this._syncPrintPageRule();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      this._scheduleMeasure();
    }
    _render() {
      this._root.innerHTML = `
        <style>${stylesheet}</style>
        <style id="vars"></style>
        <div class="sheet" data-screen-label="Document">
          <table class="frame" role="presentation">
            <thead><tr><th><div class="hdr-space"><slot name="header"></slot></div></th></tr></thead>
            <tbody><tr><td class="body"><div class="fit-box"><div class="fit"><slot></slot></div></div></td></tr></tbody>
            <tfoot><tr><td><div class="ftr-space"><slot name="footer"></slot></div></td></tr></tfoot>
          </table>
        </div>`;
      this._sheet = this._root.querySelector('.sheet');
      this._vars = this._root.getElementById('vars');
    }

    /** Runtime sizing lives in a shadow <style> :host rule, never on the
     *  light-DOM host element, so serialize-persist can't write it back. */
    _syncSize(hdrH, ftrH) {
      // Scaled-fit mode: content at its authored size, scaled onto the
      // printable area (page minus margins on both axes). The factor is a
      // plain number var so calc(length * number) stays valid; 4 decimals
      // keeps the shadow style stable across re-measures. Upscaling is
      // allowed — print transforms are vector, so text and CSS stay crisp
      // (raster images soften, which the catalog bullet warns about).
      const fit = this._contentFit();
      let fitVars = '';
      if (fit) {
        const marginPx = toPx(this.pageMargin) || 0;
        const availW = toPx(this.pageWidth) - 2 * marginPx;
        const availH = toPx(this.pageHeight) - 2 * marginPx;
        const scale = Math.min(availW / fit[2], availH / fit[3]);
        if (scale > 0 && Number.isFinite(scale)) {
          fitVars = '--doc-fit-w:' + fit[0] + ';' + '--doc-fit-h:' + fit[1] + ';' + '--doc-fit-scale:' + scale.toFixed(4) + ';';
        }
      }
      this._sheet.classList.toggle('fit-mode', !!fitVars);
      // Numeric w/h ratio for the paginated page cards' aspect-ratio —
      // aspect-ratio takes a number, not a length ratio, so compute it
      // here (CSS length division isn't portable). 6 decimals keeps the
      // shadow style stable across re-syncs.
      const arW = toPx(this.pageWidth);
      const arH = toPx(this.pageHeight);
      const ar = arW > 0 && arH > 0 ? (arW / arH).toFixed(6) : '0.772727';
      this._vars.textContent = ':host{' + fitVars + '--doc-page-ar:' + ar + ';' + '--doc-page-w:' + this.pageWidth + ';' + '--doc-page-h:' + this.pageHeight + ';' + '--doc-page-margin:' + this.pageMargin + ';' + '--doc-hdr-h:' + (hdrH || 0) + 'px;' + '--doc-ftr-h:' + (ftrH || 0) + 'px;' + '--doc-hdr-pad:' + (hdrH ? '0.35in' : '0px') + ';' + '--doc-ftr-pad:' + (ftrH ? '0.35in' : '0px') + '}';
    }

    /** @page is a no-op inside shadow DOM, so the rule lives in <head>.
     *  Re-appended on every sync so it stays last in source order — the
     *  @page cascade is source-order per descriptor, so this rule wins
     *  over any other @page rule in the document.
     *
     *  The @page SIZE is pinned where the page box IS part of the design:
     *  explicit-fixed-size mode (width + height authored), scaled-fit
     *  mode (the named sheet the fit targets), and explicit pagination
     *  (the named size the cards share — so card and sheet agree on
     *  every print path, and the export path's chosen paper overrides
     *  BOTH with one later rule). For FLOWING documents no paper size is
     *  emitted at all — the true size comes from the user's preference,
     *  injected by the export path or chosen in the print dialog — so a
     *  flowing document never fights the paper it lands on.
     *  margin: 0 is emitted in every mode: it leaves Chrome no margin box
     *  to draw its date/URL/page-count header in, and the visual margin
     *  lives on the sheet's own padding. */
    _syncPrintPageRule() {
      const id = 'doc-page-print';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      document.head.appendChild(tag);
      // Three print-geometry regimes:
      // - true-size: the page IS the design — pin its exact size.
      // - scaled-fit (content-width/height): the fit factor is computed
      //   against the NAMED paper's printable area, so that paper must
      //   stay pinned or the scaled content overflows a smaller sheet
      //   (the export path re-fits and re-pins at print time on top).
      // - default modes: no paper size — but landscape still needs the
      //   paper-agnostic 'size: landscape' keyword, because the size
      //   descriptor is what carries orientation; without it a landscape
      //   document prints portrait whenever nothing injects a size.
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      // Explicit pagination pins the page box to the SAME values that
      // size the cards (the named size by default, the export path's
      // chosen paper when its later rule overrides both) — card and
      // sheet agree on every print path, and a mismatched real paper
      // shrinks-to-fit in the dialog instead of clipping a Letter card
      // on A4. Declared before the paginated read below so both derive
      // from one check.
      const paginatedNow = this.querySelector(':scope > .page') !== null;
      const sizeDescriptor = this._trueSizePx() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : this._contentFit() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : paginatedNow ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : landscape ? 'size: landscape; ' : '';
      // WebKit never repeats the thead/tfoot spacers that carry a flowing
      // document's vertical page margins (see WK_PRINT above), so pages
      // after the first print edge-to-edge there. Carry the VERTICAL
      // margins on @page for WebKit instead, and the shadow print CSS
      // trims the first-page spacers by the same amount (.sheet.wk-print
      // rules). Horizontal inset stays on the sheet's own padding in
      // every engine. Blink keeps margin: 0 (a nonzero margin there
      // re-opens the box Chrome draws its header furniture in). One cost,
      // learned in testing: Safari's own date/URL headers are a USER
      // dialog setting ("Print headers and footers") that renders in the
      // margin area when room exists — margin: 0 only suppressed it by
      // leaving no room, and no CSS controls it. The export dialog's
      // Safari guide teaches turning the setting off for flowing
      // documents. Explicitly paginated and fixed-size documents keep
      // margin: 0 everywhere: their pages ARE the sheet.
      const wkFlowing = WK_PRINT && !paginatedNow && !this._trueSizePx() && !this._contentFit();
      const marginDescriptor = wkFlowing ? 'margin: ' + this.pageMargin + ' 0; ' : 'margin: 0; ';
      // Shadow-internal marker (never serialized), kept in lockstep with
      // the @page decision above: the print CSS trims the first-page
      // spacers ONLY while @page actually carries the margins — a
      // true-size or scaled-fit sheet keeps margin: 0 and must keep its
      // spacers too. Re-synced here so attribute changes and pagination
      // flips move both together.
      if (this._sheet) this._sheet.classList.toggle('wk-print', wkFlowing);
      tag.textContent = '@page { ' + sizeDescriptor + marginDescriptor + '} ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; height: auto !important; overflow: visible !important; } ' + 'h1,h2,h3,h4,h5,h6 { break-after: avoid; } ' + 'figure,pre,blockquote,img,svg,tr { break-inside: avoid; } ' + 'p,li { orphans: 3; widows: 3; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; ' + 'backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }

    /** Typographic defaults for document text: balance headings, avoid
     *  widowed/orphaned words in body copy (browsers without text-wrap
     *  support drop the declarations). Zero-specificity via :where() so
     *  any text-wrap authored on those elements wins; document-level so the
     *  rules reach the slotted (light DOM) content — shadow styles can't.
     *  data-omelette-injected marks the tag for the host editor to strip
     *  at serialize, so it is never written back as authored source. */
    _ensureTextWrapDefaults() {
      if (document.getElementById('doc-page-text-wrap')) return;
      const tag = document.createElement('style');
      tag.id = 'doc-page-text-wrap';
      tag.setAttribute('data-omelette-injected', '');
      tag.textContent = ':where(h1,h2,h3,h4,h5,h6){text-wrap:balance}' + ':where(p,li,blockquote,figcaption){text-wrap:pretty}';
      document.head.appendChild(tag);
    }

    /** Declares that this document owns its print CSS. The instant-PDF
     *  export checks for the meta by NAME PRESENCE alone (content is
     *  ignored) and skips its automatic print-CSS injections, so the
     *  component's @page geometry is never overridden by a heuristic.
     *  data-omelette-injected keeps it out of serialized source. */
    _ensureOwnsPrintMeta() {
      if (document.getElementById('doc-page-owns-print')) return;
      const tag = document.createElement('meta');
      tag.id = 'doc-page-owns-print';
      tag.name = 'omelette-owns-print';
      tag.content = 'true';
      tag.setAttribute('data-omelette-injected', '');
      document.head.appendChild(tag);
    }

    /** This page's valid true-size page box (explicit width AND height)
     *  as [w, h] px ints, or null when the mode is off. */
    _trueSizePx() {
      if (!safeLen(this.getAttribute('width'), null) || !safeLen(this.getAttribute('height'), null)) return null;
      const w = Math.round(toPx(this.pageWidth));
      const h = Math.round(toPx(this.pageHeight));
      return w > 0 && h > 0 ? [w, h] : null;
    }

    /** True-size pages (explicit width AND height) also declare the page
     *  box as the preview size: the in-app preview reads
     *  meta[name="omelette-fixed-size"] (content "W,H" in px ints) and
     *  scales the sheet into view — without it an 18in poster previews at
     *  true size with scrollbars. Never overrides an author-set meta
     *  (only the component's own id is managed). The meta is page-global
     *  while doc-page instances are not, so every sync recomputes the
     *  page-wide owner — the first connected true-size doc-page — and a
     *  non-true-size sibling's sync can never delete the owner's meta.
     *  Removed when no true-size page remains (the owner's disconnect
     *  re-syncs via any survivor) or when an author-set meta exists. */
    _syncFixedSizeMeta() {
      const id = 'doc-page-fixed-size';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-fixed-size"]:not([data-omelette-injected])');
      // The page-wide owner, not this instance: an upgraded true-size page
      // anywhere in the document keeps the meta alive and sized.
      let box = null;
      for (const el of document.querySelectorAll('doc-page')) {
        box = typeof el._trueSizePx === 'function' ? el._trueSizePx() : null;
        if (box) break;
      }
      if (!box || authored) {
        if (own) own.remove();
        return;
      }
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-fixed-size';
      tag.content = box[0] + ',' + box[1];
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }

    /** This page's print-sizing mode: 'fixed' when an explicit width AND
     *  height are authored (the page is the design's own size), else the
     *  default paper in the authored orientation. */
    _printSizingMode() {
      if (this._trueSizePx()) return 'fixed';
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? 'default-landscape' : 'default-portrait';
    }

    /** Announces the print-sizing mode to the host app:
     *  meta[name="omelette-print-sizing"] with content 'default-portrait',
     *  'default-landscape', or 'fixed' (fixed pages also carry the
     *  omelette-fixed-size meta with the page box in px). The export path
     *  probes it to decide what true paper size to inject at print time —
     *  in the default modes the component emits no paper size of its own.
     *  Same page-global ownership rules as the fixed-size meta above:
     *  first connected doc-page owns it, an authored meta is never
     *  overridden, removed when no doc-page remains. */
    _syncPrintSizingMeta() {
      const id = 'doc-page-print-sizing';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-print-sizing"]:not([data-omelette-injected])');
      // A fixed page wins outright (mirroring the fixed-size loop above,
      // so the two metas can never contradict each other in a mixed
      // multi-page document); otherwise the first page's mode holds.
      let mode = null;
      for (const el of document.querySelectorAll('doc-page')) {
        if (typeof el._printSizingMode !== 'function') continue;
        const m = el._printSizingMode();
        if (m === 'fixed') {
          mode = m;
          break;
        }
        if (mode === null) mode = m;
      }
      if (!mode || authored) {
        if (own) own.remove();
        return;
      }
      // A deck-stage that connected first injected its own meta and
      // defers to any existing one — take it over, or the document ends
      // up with two conflicting injected metas (a doc-page page is the
      // document; the deck re-ensures its meta if every doc-page leaves).
      const deckMeta = document.getElementById('deck-stage-print-sizing');
      if (deckMeta) deckMeta.remove();
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-print-sizing';
      tag.content = mode;
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }
    _scheduleMeasure() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._measure();
      });
    }

    /** Slot heights feed the print spacers (--doc-hdr-h / --doc-ftr-h), so
     *  they re-measure on content mutation, resize, and font load. The
     *  same pass detects explicit pagination (direct .page children) and
     *  toggles the sheet between the flowing-document card and the
     *  page-per-card stack — content edits can add or remove pages at any
     *  time, so this tracks the same mutations the measurement does. */
    _measure() {
      const hdr = this.querySelector(':scope > [slot="header"]');
      const ftr = this.querySelector(':scope > [slot="footer"]');
      const wasPaginated = this._sheet.classList.contains('paginated');
      this._sheet.classList.toggle('paginated', this.querySelector(':scope > .page') !== null);
      // The WebKit @page margin is flowing-only, so a pagination flip
      // must re-emit the rule (content edits can add or remove .page
      // sections at any time).
      if (this._sheet.classList.contains('paginated') !== wasPaginated) {
        this._syncPrintPageRule();
      }
      this._syncSize(hdr ? hdr.offsetHeight : 0, ftr ? ftr.offsetHeight : 0);
    }
  }
  if (!customElements.get('doc-page')) {
    customElements.define('doc-page', DocPage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "doc-page.js", error: String((e && e.message) || e) }); }

// ui_kits/lelanea_app/Primitives.jsx
try { (() => {
/* Shared UI primitives for the Lelanea app kit */

const Eyebrow = ({
  children,
  style = {}
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'lowercase',
    color: '#6F7376',
    fontWeight: 500,
    ...style
  }
}, children);

// Lotus geometry — keep in sync with assets/lotus-mark.svg, logo-wordmark.svg, thumbnail.html.
// Broad pointed petal rising from (160,175). Wide-angle tiers are short, upright ones long,
// so the bloom reads as a wide fan (measured 134 x 118, aspect 1.14).
const lotusPetal = (L, W) => `M160 175C${(160 + W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},${(160 + W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},160 ${175 - L}` + `C${(160 - W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},${(160 - W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},160 175Z`;
const LOTUS_TIERS = [{
  d: lotusPetal(60, 48),
  fill: '#17718A',
  stroke: '#0E5064',
  angles: [-66, 66, -46, 46, -25, 25],
  base: 340
}, {
  d: lotusPetal(78, 50),
  fill: '#3E96AE',
  stroke: '#17718A',
  angles: [-42, 42, -26, 26, -11, 11],
  base: 180
}, {
  d: lotusPetal(98, 52),
  fill: '#7CC0D6',
  stroke: '#2E8BA5',
  angles: [-30, 30, -15, 15, 0],
  base: 40
}];
const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0];
const LOTUS_VEIN_D = 'M160 164 160 88';
const LOTUS_CORE_CY = 172;
const LOTUS_RIPPLES = [{
  rx: 50,
  ry: 6,
  stroke: '#457B6A',
  op: 0.55,
  w: 1.6
}, {
  rx: 74,
  ry: 9,
  stroke: '#457B6A',
  op: 0.34,
  w: 1.4
}, {
  rx: 97,
  ry: 12,
  stroke: '#6FA88F',
  op: 0.2,
  w: 1.2
}];
const LOTUS_RIPPLE_CY = 188;

// `bloomFrac` is the measured share of the frame width the bloom occupies, so `size`
// means the bloom itself and stays interchangeable between Lotus and LotusMark.
const LOTUS_FRAMES = {
  water: {
    box: '58 72 204 132',
    aspect: 132 / 204,
    bloomFrac: 0.658,
    stroke: 1.5
  },
  tight: {
    box: '86 74 148 126',
    aspect: 126 / 148,
    bloomFrac: 0.95,
    stroke: 1.9
  }
};
const LotusMark = ({
  size = 32,
  water = true,
  style = {}
}) => {
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  const gid = `lmc${Math.round(size)}${water ? 'w' : 't'}`;
  return /*#__PURE__*/React.createElement("svg", {
    width: Math.round(frameW),
    height: Math.round(frameW * f.aspect),
    viewBox: f.box,
    style: style,
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: gid,
    cx: "50%",
    cy: "42%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#F0A078"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "55%",
    stopColor: "#C96F43"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#9C5530"
  }))), water && /*#__PURE__*/React.createElement("g", {
    fill: "none",
    strokeLinecap: "round"
  }, LOTUS_RIPPLES.map((r, i) => /*#__PURE__*/React.createElement("ellipse", {
    key: i,
    cx: "160",
    cy: LOTUS_RIPPLE_CY,
    rx: r.rx,
    ry: r.ry,
    stroke: r.stroke,
    strokeOpacity: r.op,
    strokeWidth: r.w
  }))), LOTUS_TIERS.map((t, ti) => /*#__PURE__*/React.createElement("g", {
    key: ti,
    fill: t.fill,
    stroke: t.stroke,
    strokeWidth: f.stroke,
    strokeLinejoin: "round"
  }, t.angles.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: t.d,
    transform: `rotate(${a} 160 175)`
  })))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY,
    rx: "8",
    ry: "10",
    fill: `url(#${gid})`
  }));
};

// Small stroke icons (Lucide-style, 1.5px)
const Icon = ({
  name,
  size = 22,
  color = 'currentColor'
}) => {
  const s = {
    width: size,
    height: size,
    fill: 'none',
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };
  const paths = {
    home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z"
    })),
    sit: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 12a4 4 0 0 1 8 0"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "1.2",
      fill: color
    })),
    journal: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M5 4h11l3 3v13H5z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 9h8M8 13h8M8 17h5"
    })),
    practice: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2c3 3 3 7 0 10-3-3-3-7 0-10z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 12c3-1 6 1 7 4-3 1-6-1-7-4z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 12c-3-1-6 1-7 4 3 1 6-1 7-4z"
    })),
    you: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "8",
      r: "4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M4 21a8 8 0 0 1 16 0"
    })),
    arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M5 12h14M13 6l6 6-6 6"
    })),
    up: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 19V5M6 11l6-6 6 6"
    })),
    close: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 6l12 12M18 6L6 18"
    })),
    plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    })),
    check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M5 12l5 5 9-10"
    })),
    clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 7v5l3 2"
    })),
    sparkle: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"
    })),
    chevron: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 6l6 6-6 6"
    }))
  };
  return /*#__PURE__*/React.createElement("svg", {
    style: s,
    viewBox: "0 0 24 24"
  }, paths[name]);
};
const Pill = ({
  children,
  active,
  onClick,
  style = {}
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  style: {
    border: active ? 'none' : '1px solid rgba(111,115,118,0.24)',
    background: active ? '#17718A' : '#EBE6DF',
    color: active ? '#F3F0EC' : '#11181A',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    cursor: 'pointer',
    lineHeight: 1,
    ...style
  }
}, children);
const TabBar = ({
  active,
  onChange
}) => {
  const items = [{
    k: 'home',
    label: 'home'
  }, {
    k: 'sit',
    label: 'sit'
  }, {
    k: 'journal',
    label: 'journal'
  }, {
    k: 'practice',
    label: 'practices'
  }, {
    k: 'you',
    label: 'you'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 36,
      left: 0,
      right: 0,
      display: 'flex',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 40
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      pointerEvents: 'auto',
      background: 'rgba(235,230,223,0.92)',
      backdropFilter: 'blur(16px) saturate(140%)',
      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
      padding: 6,
      borderRadius: 999,
      display: 'flex',
      gap: 2,
      boxShadow: '0 8px 24px rgba(17,24,26,0.08), 0 2px 8px rgba(17,24,26,0.04)'
    }
  }, items.map(it => {
    const on = active === it.k;
    return /*#__PURE__*/React.createElement("button", {
      key: it.k,
      onClick: () => onChange(it.k),
      style: {
        background: on ? '#F3F0EC' : 'transparent',
        color: on ? '#17718A' : '#6F7376',
        border: 'none',
        padding: '8px 12px',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: "'Hanken Grotesk', system-ui",
        fontSize: 12,
        fontWeight: on ? 500 : 400,
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: it.k,
      size: 18,
      color: on ? '#17718A' : '#6F7376'
    }), on && /*#__PURE__*/React.createElement("span", null, it.label));
  })));
};
Object.assign(window, {
  Eyebrow,
  LotusMark,
  Icon,
  Pill,
  TabBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lelanea_app/Primitives.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lelanea_app/Screens.jsx
try { (() => {
/* Screens — Lelanea coaching app. Each receives {onNav} for navigation. */

const Screen = ({
  children,
  style = {}
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    height: '100%',
    background: '#F3F0EC',
    color: '#11181A',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    position: 'relative',
    overflow: 'hidden',
    ...style
  }
}, children);

/* ---------- HomeScreen — opens with the lotus ---------- */
const HomeScreen = ({
  onNav,
  opened,
  setOpened
}) => {
  const [greeted, setGreeted] = React.useState(opened);
  React.useEffect(() => {
    if (!opened) {
      const t = setTimeout(() => {
        setOpened(true);
        setGreeted(true);
      }, 2600);
      return () => clearTimeout(t);
    }
  }, []);
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '80px 24px 0',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    style: {
      opacity: greeted ? 1 : 0,
      transition: 'opacity 800ms'
    }
  }, "a place to return to")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      placeItems: 'center',
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(Lotus, {
    size: 142,
    open: opened ? true : undefined,
    autoOpen: !opened
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 32px',
      textAlign: 'center',
      opacity: greeted ? 1 : 0,
      transform: greeted ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 1200ms cubic-bezier(0.22,0.61,0.36,1), transform 1200ms cubic-bezier(0.22,0.61,0.36,1)',
      transitionDelay: '600ms'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', Georgia, serif",
      fontSize: 40,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      color: '#11181A'
    }
  }, "Welcome."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      color: '#282C2E',
      fontSize: 16,
      lineHeight: 1.55,
      maxWidth: 320,
      margin: '10px auto 0'
    }
  }, "Take a slow breath. When you're ready, we can begin.")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 130,
      display: 'flex',
      justifyContent: 'center',
      opacity: greeted ? 1 : 0,
      transition: 'opacity 1000ms',
      transitionDelay: '1200ms'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onNav('sit'),
    style: {
      background: '#C96F43',
      color: '#F3F0EC',
      border: 'none',
      padding: '15px 36px',
      borderRadius: 999,
      fontSize: 16,
      fontWeight: 500,
      cursor: 'pointer',
      boxShadow: '0 8px 24px rgba(201,111,67,0.28)',
      fontFamily: "'Hanken Grotesk', system-ui",
      whiteSpace: 'nowrap'
    }
  }, "Begin a sit")));
};

/* ---------- SitScreen — chat with the AI ---------- */
const SitScreen = ({
  onNav
}) => {
  const [msgs, setMsgs] = React.useState([{
    who: 'ai',
    text: "What would you like to bring in today?"
  }]);
  const [val, setVal] = React.useState('');
  const endRef = React.useRef(null);
  React.useEffect(() => {
    endRef.current?.scrollTo?.(0, 99999);
  }, [msgs]);
  const send = () => {
    if (!val.trim()) return;
    const user = val.trim();
    setMsgs(m => [...m, {
      who: 'me',
      text: user
    }]);
    setVal('');
    setTimeout(() => {
      setMsgs(m => [...m, {
        who: 'ai',
        text: "Let's sit with that. What's underneath — before you name it?"
      }]);
    }, 900);
  };
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
      padding: '58px 20px 14px',
      background: 'linear-gradient(to bottom, rgba(243,240,236,0.96), rgba(243,240,236,0.7) 70%, transparent)',
      backdropFilter: 'blur(12px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(LotusMark, {
    size: 36,
    water: false
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 20,
      lineHeight: 1
    }
  }, "A sit"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: '#6F7376',
      letterSpacing: '0.1em',
      textTransform: 'lowercase',
      marginTop: 2
    }
  }, "with lelanea's teachings")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => onNav('home'),
    style: {
      width: 34,
      height: 34,
      borderRadius: 999,
      border: '1px solid rgba(111,115,118,0.24)',
      background: '#EBE6DF',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 16,
    color: "#11181A"
  })))), /*#__PURE__*/React.createElement("div", {
    ref: endRef,
    style: {
      position: 'absolute',
      inset: '110px 0 120px',
      overflowY: 'auto',
      padding: '10px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, msgs.map((m, i) => m.who === 'ai' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(LotusMark, {
    size: 30,
    water: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#EBE6DF',
      color: '#11181A',
      padding: '12px 16px',
      borderRadius: 20,
      borderBottomLeftRadius: 6,
      maxWidth: '78%',
      fontSize: 15,
      lineHeight: 1.45
    }
  }, m.text)) : /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#17718A',
      color: '#F3F0EC',
      padding: '12px 16px',
      borderRadius: 20,
      borderBottomRightRadius: 6,
      maxWidth: '78%',
      fontSize: 15,
      lineHeight: 1.45
    }
  }, m.text)))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 28,
      padding: '28px 16px 10px',
      background: 'linear-gradient(to top, rgba(243,240,236,0.98) 30%, rgba(243,240,236,0))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      background: '#EBE6DF',
      padding: '8px 8px 8px 16px',
      borderRadius: 999,
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: val,
    onChange: e => setVal(e.target.value),
    onKeyDown: e => e.key === 'Enter' && send(),
    placeholder: "What's arriving?",
    style: {
      flex: 1,
      border: 'none',
      background: 'transparent',
      outline: 'none',
      fontFamily: "'Hanken Grotesk', system-ui",
      fontSize: 15,
      color: '#11181A',
      padding: '6px 0'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: send,
    style: {
      width: 38,
      height: 38,
      borderRadius: 999,
      border: 'none',
      background: val.trim() ? '#C96F43' : '#C4B3BE',
      color: '#F3F0EC',
      cursor: val.trim() ? 'pointer' : 'default',
      display: 'grid',
      placeItems: 'center',
      transition: 'background 200ms'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "up",
    size: 18,
    color: "#F3F0EC"
  })))));
};

/* ---------- JournalScreen ---------- */
const JournalScreen = ({
  onNav
}) => {
  const entries = [{
    eyb: 'yesterday',
    t: 'You returned to the body three times.',
    b: 'Notice that. Return is a practice — it doesn\'t have to be dramatic.',
    meta: '4 min'
  }, {
    eyb: 'tuesday',
    t: 'Something soft arrived.',
    b: 'The tightness in your chest opened when you named it grief.',
    meta: '8 min'
  }, {
    eyb: 'last week',
    t: 'What\'s underneath the hurry?',
    b: 'You stayed with the question. You didn\'t need the answer.',
    meta: '3 min'
  }];
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '62px 24px 20px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "your journal"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 36,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      marginTop: 6,
      color: '#11181A'
    }
  }, "What the work", /*#__PURE__*/React.createElement("br", null), "has held.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 20px 140px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      overflowY: 'auto',
      height: 'calc(100% - 170px)'
    }
  }, entries.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: '#EBE6DF',
      borderRadius: 20,
      padding: 20,
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, e.eyb), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 22,
      lineHeight: 1.2,
      marginTop: 8,
      color: '#11181A'
    }
  }, e.t), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 14,
      color: '#282C2E',
      lineHeight: 1.5
    }
  }, e.b), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontSize: 12,
      color: '#6F7376'
    }
  }, e.meta, " \xB7 saved")))));
};

/* ---------- PracticesScreen ---------- */
const PracticesScreen = ({
  onNav
}) => {
  const themes = ['Return', 'Breath', 'Witness', 'Body', 'Grief', 'Silence', 'Boundary'];
  const [active, setActive] = React.useState('Return');
  const practices = [{
    ttl: 'The practice of return',
    len: '6 min',
    body: 'Return to what was here before the thought.'
  }, {
    ttl: 'Noticing without naming',
    len: '4 min',
    body: 'Let the sensation stay a sensation for one more breath.'
  }, {
    ttl: 'A soft witness',
    len: '8 min',
    body: 'Watch the self that watches. That one is also welcome.'
  }];
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '62px 24px 12px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "practices"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 36,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      marginTop: 6
    }
  }, "Short sits,", /*#__PURE__*/React.createElement("br", null), "drawn from the work.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 20px',
      display: 'flex',
      gap: 8,
      overflowX: 'auto'
    }
  }, themes.map(t => /*#__PURE__*/React.createElement(Pill, {
    key: t,
    active: active === t,
    onClick: () => setActive(t)
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 20px 140px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, practices.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: '#EBE6DF',
      borderRadius: 20,
      padding: 18,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 52,
      height: 52,
      borderRadius: 999,
      background: '#F3F0EC',
      display: 'grid',
      placeItems: 'center',
      flex: '0 0 auto',
      boxShadow: '0 0 24px rgba(201,111,67,0.18)'
    }
  }, /*#__PURE__*/React.createElement(LotusMark, {
    size: 42,
    water: false
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 18,
      lineHeight: 1.15
    }
  }, p.ttl), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: '#282C2E',
      marginTop: 3,
      lineHeight: 1.4
    }
  }, p.body), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: '#6F7376',
      marginTop: 6,
      display: 'flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 12,
    color: "#6F7376"
  }), " ", p.len)), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron",
    size: 16,
    color: "#6F7376"
  })))));
};

/* ---------- YouScreen ---------- */
const YouScreen = ({
  onNav
}) => {
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '62px 24px 12px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "you"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 36,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      marginTop: 6
    }
  }, "Amara")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#EBE6DF',
      borderRadius: 20,
      padding: 18,
      display: 'flex',
      justifyContent: 'space-around',
      boxShadow: '0 1px 2px rgba(17,24,26,0.04), 0 2px 6px rgba(17,24,26,0.04)'
    }
  }, [{
    n: '12',
    l: 'sits this month'
  }, {
    n: '47',
    l: 'reflections'
  }, {
    n: '6',
    l: 'days in a row'
  }].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 32,
      lineHeight: 1,
      color: '#17718A'
    }
  }, s.n), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: '#6F7376',
      letterSpacing: '0.1em',
      textTransform: 'lowercase',
      marginTop: 6
    }
  }, s.l))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 20px 140px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    style: {
      padding: '8px 4px'
    }
  }, "practice"), [{
    i: 'clock',
    l: 'Sit length',
    v: '10 min'
  }, {
    i: 'sparkle',
    l: 'Daily invitation',
    v: 'mornings'
  }, {
    i: 'journal',
    l: 'Journal',
    v: 'on'
  }].map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: '#EBE6DF',
      borderRadius: 16,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.i,
    size: 20,
    color: "#6F7376"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 15
    }
  }, r.l), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6F7376',
      fontSize: 13
    }
  }, r.v), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron",
    size: 14,
    color: "#6F7376"
  }))), /*#__PURE__*/React.createElement(Eyebrow, {
    style: {
      padding: '16px 4px 8px'
    }
  }, "account"), ['Sessions with a human coach', 'Notifications', 'Privacy', 'Sign out'].map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: '#EBE6DF',
      borderRadius: 16,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 15
    }
  }, l), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron",
    size: 14,
    color: "#6F7376"
  })))));
};

/* ---------- OnboardingScreen ---------- */
const OnboardingScreen = ({
  onNav
}) => {
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '90px 28px 0',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(LotusMark, {
    size: 110
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: 44,
      lineHeight: 1.05,
      letterSpacing: '-0.02em',
      marginTop: 24
    }
  }, "You've arrived."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Cormorant Garamond', serif",
      fontStyle: 'italic',
      fontSize: 20,
      color: '#282C2E',
      marginTop: 18,
      lineHeight: 1.35,
      maxWidth: 320,
      margin: '18px auto 0'
    }
  }, "A quiet companion to Lelanea's Unity Consciousness work \u2014 for the space between sessions.")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 48,
      left: 24,
      right: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onNav('home'),
    style: {
      background: '#C96F43',
      color: '#F3F0EC',
      border: 'none',
      padding: '16px',
      borderRadius: 999,
      fontSize: 16,
      fontWeight: 500,
      cursor: 'pointer',
      boxShadow: '0 8px 24px rgba(201,111,67,0.28)',
      fontFamily: "'Hanken Grotesk', system-ui"
    }
  }, "Begin"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onNav('home'),
    style: {
      background: 'transparent',
      color: '#11181A',
      border: 'none',
      padding: '12px',
      fontSize: 14,
      cursor: 'pointer',
      fontFamily: "'Hanken Grotesk', system-ui"
    }
  }, "I have an account")));
};
Object.assign(window, {
  HomeScreen,
  SitScreen,
  JournalScreen,
  PracticesScreen,
  YouScreen,
  OnboardingScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lelanea_app/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lelanea_app/ios-frame.jsx
try { (() => {
// iOS.jsx — Simplified iOS 26 (Liquid Glass) device frame
// Based on the iOS 26 UI Kit + Figma status bar spec. No assets, no deps.
// Exports: IOSDevice, IOSStatusBar, IOSNavBar, IOSGlassPill, IOSList, IOSListRow, IOSKeyboard

// ─────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────
function IOSStatusBar({
  dark = false,
  time = '9:41'
}) {
  const c = dark ? '#fff' : '#000';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 154,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '21px 24px 19px',
      boxSizing: 'border-box',
      position: 'relative',
      zIndex: 20,
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: '-apple-system, "SF Pro", system-ui',
      fontWeight: 590,
      fontSize: 17,
      lineHeight: '22px',
      color: c
    }
  }, time)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingTop: 1,
      paddingRight: 1
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "19",
    height: "12",
    viewBox: "0 0 19 12"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "7.5",
    width: "3.2",
    height: "4.5",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4.8",
    y: "5",
    width: "3.2",
    height: "7",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "9.6",
    y: "2.5",
    width: "3.2",
    height: "9.5",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14.4",
    y: "0",
    width: "3.2",
    height: "12",
    rx: "0.7",
    fill: c
  })), /*#__PURE__*/React.createElement("svg", {
    width: "17",
    height: "12",
    viewBox: "0 0 17 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z",
    fill: c
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z",
    fill: c
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "8.5",
    cy: "10.5",
    r: "1.5",
    fill: c
  })), /*#__PURE__*/React.createElement("svg", {
    width: "27",
    height: "13",
    viewBox: "0 0 27 13"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0.5",
    y: "0.5",
    width: "23",
    height: "12",
    rx: "3.5",
    stroke: c,
    strokeOpacity: "0.35",
    fill: "none"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "2",
    width: "20",
    height: "9",
    rx: "2",
    fill: c
  }), /*#__PURE__*/React.createElement("path", {
    d: "M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z",
    fill: c,
    fillOpacity: "0.4"
  }))));
}

// ─────────────────────────────────────────────────────────────
// Liquid glass pill — blur + tint + shine
// ─────────────────────────────────────────────────────────────
function IOSGlassPill({
  children,
  dark = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      minWidth: 44,
      borderRadius: 9999,
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: dark ? '0 2px 6px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.07), 0 3px 10px rgba(0,0,0,0.06)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 9999,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      background: dark ? 'rgba(120,120,128,0.28)' : 'rgba(255,255,255,0.5)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 9999,
      boxShadow: dark ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15), inset -1px -1px 1px rgba(255,255,255,0.08)' : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
      border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      padding: '0 4px'
    }
  }, children));
}

// ─────────────────────────────────────────────────────────────
// Navigation bar — glass pills + large title
// ─────────────────────────────────────────────────────────────
function IOSNavBar({
  title = 'Title',
  dark = false,
  trailingIcon = true
}) {
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#404040';
  const text = dark ? '#fff' : '#000';
  const pillIcon = content => /*#__PURE__*/React.createElement(IOSGlassPill, {
    dark: dark
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, content));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      paddingTop: 62,
      paddingBottom: 10,
      position: 'relative',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px'
    }
  }, pillIcon(/*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "20",
    viewBox: "0 0 12 20",
    fill: "none",
    style: {
      marginLeft: -1
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M10 2L2 10l8 8",
    stroke: muted,
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), trailingIcon && pillIcon(/*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "6",
    viewBox: "0 0 22 6"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "3",
    cy: "3",
    r: "2.5",
    fill: muted
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "3",
    r: "2.5",
    fill: muted
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "3",
    r: "2.5",
    fill: muted
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 16px',
      fontFamily: '-apple-system, system-ui',
      fontSize: 34,
      fontWeight: 700,
      lineHeight: '41px',
      color: text,
      letterSpacing: 0.4
    }
  }, title));
}

// ─────────────────────────────────────────────────────────────
// Grouped list (inset card, r:26) + row (52px)
// ─────────────────────────────────────────────────────────────
function IOSListRow({
  title,
  detail,
  icon,
  chevron = true,
  isLast = false,
  dark = false
}) {
  const text = dark ? '#fff' : '#000';
  const sec = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const ter = dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)';
  const sep = dark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      minHeight: 52,
      padding: '0 16px',
      position: 'relative',
      fontFamily: '-apple-system, system-ui',
      fontSize: 17,
      letterSpacing: -0.43
    }
  }, icon && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 7,
      background: icon,
      marginRight: 12,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      color: text
    }
  }, title), detail && /*#__PURE__*/React.createElement("span", {
    style: {
      color: sec,
      marginRight: 6
    }
  }, detail), chevron && /*#__PURE__*/React.createElement("svg", {
    width: "8",
    height: "14",
    viewBox: "0 0 8 14",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 1l6 6-6 6",
    stroke: ter,
    strokeWidth: "2",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), !isLast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      left: icon ? 58 : 16,
      height: 0.5,
      background: sep
    }
  }));
}
function IOSList({
  header,
  children,
  dark = false
}) {
  const hc = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const bg = dark ? '#1C1C1E' : '#fff';
  return /*#__PURE__*/React.createElement("div", null, header && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: '-apple-system, system-ui',
      fontSize: 13,
      color: hc,
      textTransform: 'uppercase',
      padding: '8px 36px 6px',
      letterSpacing: -0.08
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      background: bg,
      borderRadius: 26,
      margin: '0 16px',
      overflow: 'hidden'
    }
  }, children));
}

// ─────────────────────────────────────────────────────────────
// Device frame
// ─────────────────────────────────────────────────────────────
function IOSDevice({
  children,
  width = 402,
  height = 874,
  dark = false,
  title,
  keyboard = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      borderRadius: 48,
      overflow: 'hidden',
      position: 'relative',
      background: dark ? '#000' : '#F2F2F7',
      boxShadow: '0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)',
      fontFamily: '-apple-system, system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 11,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 126,
      height: 37,
      borderRadius: 24,
      background: '#000',
      zIndex: 50
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement(IOSStatusBar, {
    dark: dark
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }
  }, title !== undefined && /*#__PURE__*/React.createElement(IOSNavBar, {
    title: title,
    dark: dark
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto'
    }
  }, children), keyboard && /*#__PURE__*/React.createElement(IOSKeyboard, {
    dark: dark
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 60,
      height: 34,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingBottom: 8,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 139,
      height: 5,
      borderRadius: 100,
      background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.25)'
    }
  })));
}

// ─────────────────────────────────────────────────────────────
// Keyboard — iOS 26 liquid glass
// ─────────────────────────────────────────────────────────────
function IOSKeyboard({
  dark = false
}) {
  const glyph = dark ? 'rgba(255,255,255,0.7)' : '#595959';
  const sugg = dark ? 'rgba(255,255,255,0.6)' : '#333';
  const keyBg = dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)';

  // special-key icons
  const icons = {
    shift: /*#__PURE__*/React.createElement("svg", {
      width: "19",
      height: "17",
      viewBox: "0 0 19 17"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M9.5 1L1 9.5h4.5V16h8V9.5H18L9.5 1z",
      fill: glyph
    })),
    del: /*#__PURE__*/React.createElement("svg", {
      width: "23",
      height: "17",
      viewBox: "0 0 23 17"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M7 1h13a2 2 0 012 2v11a2 2 0 01-2 2H7l-6-7.5L7 1z",
      fill: "none",
      stroke: glyph,
      strokeWidth: "1.6",
      strokeLinejoin: "round"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M10 5l7 7M17 5l-7 7",
      stroke: glyph,
      strokeWidth: "1.6",
      strokeLinecap: "round"
    })),
    ret: /*#__PURE__*/React.createElement("svg", {
      width: "20",
      height: "14",
      viewBox: "0 0 20 14"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M18 1v6H4m0 0l4-4M4 7l4 4",
      fill: "none",
      stroke: "#fff",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }))
  };
  const key = (content, {
    w,
    flex,
    ret,
    fs = 25,
    k
  } = {}) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      height: 42,
      borderRadius: 8.5,
      flex: flex ? 1 : undefined,
      width: w,
      minWidth: 0,
      background: ret ? '#08f' : keyBg,
      boxShadow: '0 1px 0 rgba(0,0,0,0.075)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, "SF Compact", system-ui',
      fontSize: fs,
      fontWeight: 458,
      color: ret ? '#fff' : glyph
    }
  }, content);
  const row = (keys, pad = 0) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6.5,
      justifyContent: 'center',
      padding: `0 ${pad}px`
    }
  }, keys.map(l => key(l, {
    flex: true,
    k: l
  })));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 15,
      borderRadius: 27,
      overflow: 'hidden',
      padding: '11px 0 2px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      boxShadow: dark ? '0 -2px 20px rgba(0,0,0,0.09)' : '0 -1px 6px rgba(0,0,0,0.018), 0 -3px 20px rgba(0,0,0,0.012)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 27,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      background: dark ? 'rgba(120,120,128,0.14)' : 'rgba(255,255,255,0.25)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 27,
      boxShadow: dark ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15)' : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
      border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      alignItems: 'center',
      padding: '8px 22px 13px',
      width: '100%',
      boxSizing: 'border-box',
      position: 'relative'
    }
  }, ['"The"', 'the', 'to'].map((w, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 25,
      background: '#ccc',
      opacity: 0.3
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: 'center',
      fontFamily: '-apple-system, system-ui',
      fontSize: 17,
      color: sugg,
      letterSpacing: -0.43,
      lineHeight: '22px'
    }
  }, w)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 13,
      padding: '0 6.5px',
      width: '100%',
      boxSizing: 'border-box',
      position: 'relative'
    }
  }, row(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']), row(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], 20), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14.25,
      alignItems: 'center'
    }
  }, key(icons.shift, {
    w: 45,
    k: 'shift'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6.5,
      flex: 1
    }
  }, ['z', 'x', 'c', 'v', 'b', 'n', 'm'].map(l => key(l, {
    flex: true,
    k: l
  }))), key(icons.del, {
    w: 45,
    k: 'del'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center'
    }
  }, key('ABC', {
    w: 92.25,
    fs: 18,
    k: 'abc'
  }), key('', {
    flex: true,
    k: 'space'
  }), key(icons.ret, {
    w: 92.25,
    ret: true,
    k: 'ret'
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 56,
      width: '100%',
      position: 'relative'
    }
  }));
}
Object.assign(window, {
  IOSDevice,
  IOSStatusBar,
  IOSNavBar,
  IOSGlassPill,
  IOSList,
  IOSListRow,
  IOSKeyboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lelanea_app/ios-frame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lelanea_app/lotus-figure.jsx
try { (() => {
/* Animated lotus for the app kit. Geometry mirrors components/Lotus/Lotus.jsx. */

// Lotus geometry — keep in sync with assets/lotus-mark.svg, logo-wordmark.svg, thumbnail.html.
// Broad pointed petal rising from (160,175). Wide-angle tiers are short, upright ones long,
// so the bloom reads as a wide fan (measured 134 x 118, aspect 1.14).
const lotusPetal = (L, W) => `M160 175C${(160 + W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},${(160 + W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},160 ${175 - L}` + `C${(160 - W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},${(160 - W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},160 175Z`;
const LOTUS_TIERS = [{
  d: lotusPetal(60, 48),
  fill: '#17718A',
  stroke: '#0E5064',
  angles: [-66, 66, -46, 46, -25, 25],
  base: 340
}, {
  d: lotusPetal(78, 50),
  fill: '#3E96AE',
  stroke: '#17718A',
  angles: [-42, 42, -26, 26, -11, 11],
  base: 180
}, {
  d: lotusPetal(98, 52),
  fill: '#7CC0D6',
  stroke: '#2E8BA5',
  angles: [-30, 30, -15, 15, 0],
  base: 40
}];
const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0];
const LOTUS_VEIN_D = 'M160 164 160 88';
const LOTUS_CORE_CY = 172;
const LOTUS_RIPPLES = [{
  rx: 50,
  ry: 6,
  stroke: '#457B6A',
  op: 0.55,
  w: 1.6
}, {
  rx: 74,
  ry: 9,
  stroke: '#457B6A',
  op: 0.34,
  w: 1.4
}, {
  rx: 97,
  ry: 12,
  stroke: '#6FA88F',
  op: 0.2,
  w: 1.2
}];
const LOTUS_RIPPLE_CY = 188;

// `bloomFrac` is the measured share of the frame width the bloom occupies, so `size`
// means the bloom itself and stays interchangeable between Lotus and LotusMark.
const LOTUS_FRAMES = {
  water: {
    box: '58 72 204 132',
    aspect: 132 / 204,
    bloomFrac: 0.658,
    stroke: 1.5
  },
  tight: {
    box: '86 74 148 126',
    aspect: 126 / 148,
    bloomFrac: 0.95,
    stroke: 1.9
  }
};
const Lotus = ({
  size = 140,
  open: openProp,
  autoOpen = true,
  idle = true,
  water = true,
  onOpened,
  delay = 0
}) => {
  const controlled = typeof openProp === 'boolean';
  const [selfOpen, setSelfOpen] = React.useState(false);
  const open = controlled ? openProp : selfOpen;
  const ease = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  React.useEffect(() => {
    if (controlled || !autoOpen) return;
    const t = setTimeout(() => {
      setSelfOpen(true);
      if (onOpened) setTimeout(onOpened, 2400);
    }, delay);
    return () => clearTimeout(t);
  }, [controlled, autoOpen, delay, onOpened]);
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  const frameH = frameW * f.aspect;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: frameW,
      height: frameH,
      position: 'relative',
      display: 'inline-block',
      animation: open && idle ? 'lotus-breath 4s ease-in-out infinite' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: -frameW * 0.16,
      background: 'radial-gradient(ellipse at 50% 62%, rgba(124,192,214,0.20) 0%, rgba(243,240,236,0) 62%)',
      pointerEvents: 'none',
      opacity: open ? 1 : 0,
      transition: `opacity 1600ms ${ease}`
    }
  }), /*#__PURE__*/React.createElement("svg", {
    width: frameW,
    height: frameH,
    viewBox: f.box,
    style: {
      position: 'relative',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("radialGradient", {
    id: "lotus-core-anim",
    cx: "50%",
    cy: "42%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#F0A078"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "55%",
    stopColor: "#C96F43"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#9C5530"
  }))), water && /*#__PURE__*/React.createElement("g", {
    fill: "none",
    strokeLinecap: "round",
    style: {
      transformOrigin: `160px ${LOTUS_RIPPLE_CY}px`,
      transform: open ? 'scale(1)' : 'scale(0.55)',
      opacity: open ? 1 : 0,
      transition: `transform 2600ms ${ease} 300ms, opacity 2000ms ${ease} 300ms`
    }
  }, LOTUS_RIPPLES.map((r, i) => /*#__PURE__*/React.createElement("ellipse", {
    key: i,
    cx: "160",
    cy: LOTUS_RIPPLE_CY,
    rx: r.rx,
    ry: r.ry,
    stroke: r.stroke,
    strokeOpacity: r.op,
    strokeWidth: r.w
  }))), LOTUS_TIERS.map((tier, ti) => /*#__PURE__*/React.createElement("g", {
    key: ti,
    fill: tier.fill,
    stroke: tier.stroke,
    strokeWidth: f.stroke,
    strokeLinejoin: "round"
  }, tier.angles.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: tier.d,
    style: {
      transformOrigin: '160px 175px',
      transform: open ? `rotate(${a}deg) scale(1)` : `rotate(${a * 0.18}deg) scale(0.34)`,
      opacity: open ? 1 : 0,
      transition: `transform 2200ms ${ease} ${tier.base + i * 70}ms, opacity 1500ms ${ease} ${tier.base + i * 70}ms`
    }
  })))), /*#__PURE__*/React.createElement("g", {
    stroke: "#A8D6E5",
    strokeWidth: "1.2",
    fill: "none",
    style: {
      opacity: open ? 0.5 : 0,
      transition: `opacity 1400ms ${ease} 900ms`
    }
  }, LOTUS_VEIN_ANGLES.map((a, i) => /*#__PURE__*/React.createElement("path", {
    key: `${a}-${i}`,
    d: LOTUS_VEIN_D,
    style: {
      transformOrigin: '160px 175px',
      transform: `rotate(${a}deg)`
    }
  }))), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY,
    rx: "8",
    ry: "10",
    fill: "url(#lotus-core-anim)",
    style: {
      transformOrigin: `160px ${LOTUS_CORE_CY}px`,
      transform: open ? 'scale(1)' : 'scale(0.3)',
      opacity: open ? 1 : 0,
      filter: open ? 'drop-shadow(0 0 12px rgba(201,111,67,0.5))' : 'none',
      transition: `transform 1500ms ${ease} 240ms, opacity 1200ms ${ease} 240ms, filter 1500ms ${ease} 240ms`
    }
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "160",
    cy: LOTUS_CORE_CY - 3,
    rx: "2.8",
    ry: "3.4",
    fill: "#F5B896",
    style: {
      opacity: open ? 0.85 : 0,
      transition: `opacity 1200ms ${ease} 600ms`
    }
  })));
};
if (typeof document !== 'undefined' && !document.getElementById('lotus-keyframes')) {
  const s = document.createElement('style');
  s.id = 'lotus-keyframes';
  s.textContent = '@keyframes lotus-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}';
  document.head.appendChild(s);
}
window.Lotus = Lotus;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lelanea_app/lotus-figure.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.ChatBubble = __ds_scope.ChatBubble;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Lotus = __ds_scope.Lotus;

__ds_ns.LotusMark = __ds_scope.LotusMark;

})();
