'use client';

import { useEffect, useRef } from 'react';

import {
  DEFAULT_CONFIG,
  FACES,
  LIGHT_DIR,
  PADS,
  POD,
  STAMEN_COUNT,
  STAMEN_CROWN,
  padOutline,
  stamenPath,
  type Mix,
  breathEase,
  openedMs,
  petalPoint,
  petalPoses,
  viewDir,
  type LotusConfig,
  type PetalPose,
} from '@/components/app/lab/lotus-model';

/**
 * Prototype C (t-131): the same 3D lotus model, meshed and lit in Three.js.
 *
 * `three` is imported inside the effect, so it is a separate chunk that loads
 * after hydration — nothing on the server, nothing in the first-load bundle.
 * The cost is a blank frame until it arrives.
 */

const NU = 26;
const NV = 13;

// Same frame as the SVG prototype's viewBox, in model units.
const FRAME = { left: -1.5, right: 1.5, top: 1.32, bottom: -0.55 };

export interface LotusThreeProps {
  size?: number;
  frozenMs?: number;
  reducedMotion?: boolean;
  playKey?: number;
  config?: LotusConfig;
}

export function LotusThree({
  size = 300,
  frozenMs,
  reducedMotion,
  playKey = 0,
  config = DEFAULT_CONFIG,
}: LotusThreeProps) {
  const host = useRef<HTMLDivElement>(null);
  const height = (size * (FRAME.top - FRAME.bottom)) / (FRAME.right - FRAME.left);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};

    void import('three').then((THREE) => {
      if (disposed) return;
      const css = getComputedStyle(el);
      const token = (name: string) =>
        name === 'white' || name === 'black'
          ? new THREE.Color(name)
          : new THREE.Color(css.getPropertyValue(name).trim() || '#888');
      const mix = (m: Mix) => {
        const c = token(m.a);
        return m.b && m.t ? c.lerp(token(m.b), m.t) : c;
      };

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(size, height);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(
        FRAME.left,
        FRAME.right,
        FRAME.top,
        FRAME.bottom,
        0.1,
        50
      );
      const VIEW_DIR = viewDir(config);
      const OPENED_MS = openedMs(config);
      camera.position.set(VIEW_DIR[0] * 10, VIEW_DIR[1] * 10, VIEW_DIR[2] * 10);
      camera.lookAt(0, 0, 0);

      scene.add(
        new THREE.HemisphereLight(0xffffff, token(config.shadowTone), 1.9 * config.exposure)
      );
      const sun = new THREE.DirectionalLight(0xffffff, 1.8 * config.exposure);
      sun.position.set(LIGHT_DIR[0] * 5, LIGHT_DIR[1] * 5, LIGHT_DIR[2] * 5);
      scene.add(sun);

      // ---- Petals: one grid per petal, two meshes (inner face, outer face)
      // sharing its position and normal attributes, coloured separately.
      const index: number[] = [];
      for (let i = 0; i < NU - 1; i++) {
        for (let j = 0; j < NV - 1; j++) {
          const a = i * NV + j;
          const b = (i + 1) * NV + j;
          index.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const gradient = (stops: readonly Mix[]) => {
        const [c0, c1, c2] = stops.map(mix);
        const out = new Float32Array(NU * NV * 3);
        const c = new THREE.Color();
        for (let i = 0; i < NU; i++) {
          const u = i / (NU - 1);
          if (u < 0.5) c.lerpColors(c0, c1, u / 0.5);
          else c.lerpColors(c1, c2, (u - 0.5) / 0.5);
          for (let j = 0; j < NV; j++) c.toArray(out, (i * NV + j) * 3);
        }
        return new THREE.BufferAttribute(out, 3);
      };

      const petals = petalPoses(0, config).map((pose) => {
        const position = new THREE.BufferAttribute(new Float32Array(NU * NV * 3), 3);
        const palette = FACES[pose.tier.face];
        const make = (stops: readonly Mix[], side: number) => {
          const g = new THREE.BufferGeometry();
          g.setIndex(index);
          g.setAttribute('position', position);
          g.setAttribute('color', gradient(stops));
          const m = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.55,
            side: side as 0 | 1,
          });
          const mesh = new THREE.Mesh(g, m);
          scene.add(mesh);
          return mesh;
        };
        // (u, v) winding makes the FRONT side the petal's inner face.
        const inner = make(palette.inner, THREE.FrontSide);
        const outer = make(palette.outer, THREE.BackSide);
        return { position, inner, outer };
      });

      const writePetal = (pose: PetalPose, k: number) => {
        const { position, inner, outer } = petals[k];
        for (let i = 0; i < NU; i++) {
          for (let j = 0; j < NV; j++) {
            const p = petalPoint(pose, i / (NU - 1), (j / (NV - 1)) * 2 - 1);
            position.setXYZ(i * NV + j, p[0], p[1], p[2]);
          }
        }
        position.needsUpdate = true;
        inner.geometry.computeVertexNormals();
        outer.geometry.setAttribute('normal', inner.geometry.getAttribute('normal'));
        inner.geometry.computeBoundingSphere();
        outer.geometry.computeBoundingSphere();
      };

      // ---- Seed pod, its seeds, and the stamens round it.
      const core = new THREE.Group();
      scene.add(core);
      const podH = POD.top - POD.bottom;
      const pod = new THREE.Mesh(
        new THREE.CylinderGeometry(POD.radiusTop, POD.radiusBottom, podH, 40),
        new THREE.MeshStandardMaterial({ color: token('--color-lotus-core'), roughness: 0.7 })
      );
      pod.position.y = POD.bottom + podH / 2;
      core.add(pod);
      const seedMat = new THREE.MeshStandardMaterial({ color: token('--color-lotus-core-deep') });
      const seedGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16);
      [[0, 0], ...Array.from({ length: 7 }, (_, i) => [0.62, (i / 7) * Math.PI * 2 + 0.3])].forEach(
        ([r, a]) => {
          const s = new THREE.Mesh(seedGeo, seedMat);
          s.position.set(
            POD.radiusTop * r * Math.cos(a),
            POD.top + 0.002,
            POD.radiusTop * r * Math.sin(a)
          );
          core.add(s);
        }
      );
      const filament = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.004, 0.004, 1, 5),
        new THREE.MeshStandardMaterial({ color: token('--color-lotus-core-light') }),
        STAMEN_COUNT
      );
      const anther = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.014, 8, 6),
        new THREE.MeshStandardMaterial({ color: token('--color-lotus-glint') }),
        STAMEN_COUNT
      );
      core.add(filament, anther);

      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const writeStamens = (g: number) => {
        for (let i = 0; i < STAMEN_COUNT; i++) {
          const a = (i / STAMEN_COUNT) * Math.PI * 2;
          const r0 = POD.radiusBottom * 1.05;
          const r1 = (POD.radiusTop + 0.08 + (i % 3) * 0.022) * (0.6 + 0.4 * g);
          const y0 = POD.bottom + 0.02;
          const y1 = POD.bottom + (0.2 + (i % 4) * 0.02) * g;
          const p0 = new THREE.Vector3(r0 * Math.cos(a), y0, r0 * Math.sin(a));
          const p1 = new THREE.Vector3(r1 * Math.cos(a), y1, r1 * Math.sin(a));
          const dir = p1.clone().sub(p0);
          const len = Math.max(0.0001, dir.length());
          q.setFromUnitVectors(up, dir.normalize());
          m4.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
          filament.setMatrixAt(i, m4);
          m4.compose(p1, q, new THREE.Vector3(g, g, g));
          anther.setMatrixAt(i, m4);
        }
        filament.instanceMatrix.needsUpdate = true;
        anther.instanceMatrix.needsUpdate = true;
      };

      core.visible = config.centre === 'pod';

      // ---- The water lily's stamen crown: tubes built at full length, grown by
      // scaling the group.
      const crown = new THREE.Group();
      if (config.centre === 'stamens') {
        scene.add(crown);
        const tones = ['--color-lotus-core', '--color-lotus-core-light', '--color-lotus-core'].map(
          (t) =>
            new THREE.MeshStandardMaterial({
              color: token(t),
              roughness: 0.6,
              emissive: token('--color-lotus-core'),
              emissiveIntensity: 0.25,
            })
        );
        for (let i = 0; i < STAMEN_CROWN; i++) {
          const pts = stamenPath(i, 1, 10).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
          const tube = new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(pts),
            12,
            0.013 - 0.004 * (i / STAMEN_CROWN),
            6
          );
          crown.add(new THREE.Mesh(tube, tones[i % 3]));
        }
        // A warm glow at the heart, lighting the petal bases.
        const glow = new THREE.PointLight(token('--color-lotus-core-light'), 1.6, 1.3, 1.4);
        glow.position.set(0, 0.22, 0);
        crown.add(glow);
      }

      // ---- Lily pads.
      if (config.pads) {
        const padMat = new THREE.MeshStandardMaterial({
          color: token('--color-lotus-petal-outer-edge').lerp(new THREE.Color('black'), 0.35),
          roughness: 0.8,
        });
        PADS.forEach((pad) => {
          const outline = padOutline(pad);
          const shape = new THREE.Shape(
            outline.slice(1).map((p) => new THREE.Vector2(p[0], -p[2]))
          );
          shape.lineTo(pad.x, -pad.z);
          const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1), padMat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.y = -0.012;
          scene.add(mesh);
        });
      }

      // ---- Ripples on the water.
      const ripples = new THREE.Group();
      scene.add(ripples);
      [
        { r: 0.7, o: 0.55, c: '--color-lotus-ripple' },
        { r: 1.04, o: 0.34, c: '--color-lotus-ripple' },
        { r: 1.36, o: 0.2, c: '--color-lotus-ripple-far' },
      ].forEach(({ r, o, c }) => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r - 0.007, r + 0.007, 96),
          new THREE.MeshBasicMaterial({ color: token(c), transparent: true, opacity: o })
        );
        ring.rotation.x = -Math.PI / 2;
        ripples.add(ring);
      });

      const draw = (ms: number) => {
        petalPoses(ms, config).forEach(writePetal);
        const g = breathEase(Math.min(1, Math.max(0, (ms - 500) / 1600)));
        core.scale.set(0.55 + 0.45 * g, Math.max(0.01, g), 0.55 + 0.45 * g);
        core.visible = config.centre === 'pod' && g > 0.01;
        writeStamens(Math.max(0.01, g));
        crown.scale.set(1, Math.max(0.01, g), 1);
        crown.visible = g > 0.01;
        const rp = breathEase(Math.min(1, Math.max(0, (ms - 300) / 2600)));
        // Flattened like the SVG's hand-drawn ellipses: a stylised water line,
        // not a literal ring seen from 38° above.
        const k = 0.55 + 0.45 * rp;
        ripples.scale.set(k, k, k * 0.3);
        ripples.children.forEach((c, i) => {
          const mat = (c as InstanceType<typeof THREE.Mesh>).material as InstanceType<
            typeof THREE.MeshBasicMaterial
          >;
          mat.opacity = [0.55, 0.34, 0.2][i] * rp;
        });
        renderer.render(scene, camera);
      };

      if (frozenMs !== undefined) draw(frozenMs);
      else if (reducedMotion) draw(OPENED_MS);
      else {
        const t0 = performance.now();
        const tick = (now: number) => {
          const ms = now - t0;
          draw(ms);
          if (ms < OPENED_MS + 100) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }

      cleanup = () => {
        cancelAnimationFrame(raf);
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as InstanceType<typeof THREE.Mesh>;
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, [size, height, frozenMs, reducedMotion, playKey, config]);

  return <div ref={host} style={{ width: size, height }} aria-hidden="true" />;
}
