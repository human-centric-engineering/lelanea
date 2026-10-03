import { colourCss, type Colour } from '@/components/app/ui/lotus-colour';
import type { LotusShape } from '@/components/app/ui/lotus-draw';

/**
 * Paint a lotus draw list as SVG elements.
 *
 * No hooks and no browser APIs, so the still mark renders on the server.
 * `idPrefix` must be unique per bloom on the page: gradients are referenced
 * by id, and two blooms sharing ids would paint each other's colours.
 *
 * `paint` turns a colour expression into an attribute value. The default is
 * CSS over the live tokens; the asset script passes one that resolves them to
 * literals, for the places (favicon, social card, email) that cannot read
 * `var()`.
 */
export function lotusSvgElements(
  shapes: readonly LotusShape[],
  idPrefix: string,
  paint: (c: Colour) => string = colourCss
) {
  const defs: React.ReactNode[] = [];
  const body: React.ReactNode[] = [];
  const path = (pts: readonly number[], close: boolean) => {
    let d = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
    return close ? `${d}Z` : d;
  };

  shapes.forEach((s, i) => {
    const id = `${idPrefix}-${i}`;
    switch (s.kind) {
      case 'band': {
        defs.push(
          <linearGradient
            key={id}
            id={id}
            gradientUnits="userSpaceOnUse"
            x1={s.from[0]}
            y1={s.from[1]}
            x2={s.to[0]}
            y2={s.to[1]}
          >
            {s.stops.map((stop) => (
              <stop
                key={stop.offset}
                offset={`${Math.round(stop.offset * 100)}%`}
                stopColor={paint(stop.colour)}
              />
            ))}
          </linearGradient>
        );
        // Stroking a band with its own fill closes the hairline seam between
        // neighbouring bands that anti-aliasing would otherwise leave.
        const d = path(s.points, true);
        body.push(
          <path
            key={id}
            d={d}
            fill={`url(#${id})`}
            stroke={`url(#${id})`}
            strokeWidth={0.6}
            strokeLinejoin="round"
          />
        );
        break;
      }
      case 'line':
        body.push(
          <path
            key={id}
            d={path(s.points, false)}
            fill="none"
            stroke={paint(s.colour)}
            strokeOpacity={s.opacity}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
        break;
      case 'fill':
        body.push(
          <path
            key={id}
            d={path(s.points, true)}
            fill={paint(s.colour)}
            stroke={paint(s.stroke)}
            strokeWidth={s.strokeWidth}
            opacity={s.opacity}
          />
        );
        break;
      case 'ring':
        body.push(
          <ellipse
            key={id}
            cx={s.cx}
            cy={s.cy}
            rx={s.rx}
            ry={s.ry}
            fill="none"
            stroke={paint(s.colour)}
            strokeOpacity={s.opacity}
            strokeWidth={s.width}
          />
        );
        break;
      case 'glow':
        defs.push(
          <radialGradient key={id} id={id}>
            <stop offset="0%" stopColor={paint(s.colour)} />
            <stop offset="100%" stopColor={paint(s.colour)} stopOpacity={0} />
          </radialGradient>
        );
        body.push(
          <ellipse
            key={id}
            cx={s.cx}
            cy={s.cy}
            rx={s.rx}
            ry={s.ry}
            fill={`url(#${id})`}
            opacity={s.opacity}
          />
        );
        break;
    }
  });

  return (
    <>
      <defs>{defs}</defs>
      {body}
    </>
  );
}
