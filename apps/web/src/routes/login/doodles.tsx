import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef } from "react";

import { DOODLE_ART } from "./doodle-art";
import type { DoodleArt, DoodleEye } from "./doodle-art";

function requireArt(name: string): DoodleArt {
  const art = DOODLE_ART[name];
  if (!art) throw new Error(`unknown doodle: ${name}`);
  return art;
}

interface DoodleSpec {
  name: string;
  style: CSSProperties;
}

// Hand-drawn geometric doodle characters (sparkles.dev-style, original SVG art).
// Percent offsets keep the cast hugging the viewport edges so the auth card
// stays clear at any window size; tato and elle intentionally bleed off-screen.
const DOODLES: DoodleSpec[] = [
  {
    name: "moso",
    style: { left: "9%", top: "36%", width: 168, rotate: "-7deg", animationDelay: "0s" },
  },
  {
    name: "zig",
    style: { right: "16%", top: "10%", width: 112, rotate: "10deg", animationDelay: "-2.1s" },
  },
  {
    name: "elle",
    style: { right: "-28px", top: "46%", width: 128, rotate: "-4deg", animationDelay: "-4.6s" },
  },
  {
    name: "pebble",
    style: { right: "11%", bottom: "14%", width: 118, rotate: "5deg", animationDelay: "-1.3s" },
  },
  {
    name: "keno",
    style: { left: "20%", bottom: "10%", width: 108, rotate: "-6deg", animationDelay: "-3.4s" },
  },
  {
    name: "tato",
    style: { left: "-24px", bottom: "5%", width: 136, rotate: "-8deg", animationDelay: "-5.8s" },
  },
];

const BOIL_MS = 140;
const GAZE_LERP = 0.16;
const BLINK_MS = 150;

function DoodleSvg({ name, style }: DoodleSpec): ReactElement {
  const art = requireArt(name);
  const frame = art.frames[0];
  if (!frame) throw new Error(`doodle ${name} has no frames`);
  return (
    <svg
      data-doodle={name}
      viewBox="0 0 200 200"
      className="login-doodle absolute"
      style={{ ...style, aspectRatio: "1" }}
    >
      <path data-part="outer" d={frame.outer} fill="#000" />
      <path data-part="inner" d={frame.inner} fill={art.fill} />
      {art.eyes.map((eye, i) => (
        <g key={i} data-part="eye" className="doodle-eye">
          <ellipse
            cx={eye.cx}
            cy={eye.cy}
            rx={eye.rx}
            ry={eye.ry}
            fill="#fff"
            transform={`rotate(${eye.rot} ${eye.cx} ${eye.cy})`}
          />
          <g data-part="pupil" transform={`translate(${eye.pupil.dx} ${eye.pupil.dy})`}>
            <ellipse
              cx={eye.cx}
              cy={eye.cy}
              rx={eye.pupil.rx}
              ry={eye.pupil.ry}
              fill="#000"
              transform={`rotate(${eye.pupil.rot} ${eye.cx} ${eye.cy})`}
            />
          </g>
        </g>
      ))}
      {frame.lashes.map((d, i) => (
        <path
          key={i}
          data-part="lash"
          d={d}
          stroke="#000"
          strokeWidth={art.lashWidths[i] ?? 3}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

interface EyeRig {
  eye: DoodleEye;
  pupilEl: SVGGElement;
  // current gaze offset in svg user units, lerped toward the target each frame
  dx: number;
  dy: number;
}

interface CharRig {
  svg: SVGSVGElement;
  rect: DOMRect;
  outerEl: SVGPathElement;
  innerEl: SVGPathElement;
  lashEls: SVGPathElement[];
  eyeEls: SVGGElement[];
  eyes: EyeRig[];
  frame: number;
  name: string;
}

export function LoginDoodles(): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = rootRef.current;
    if (!root) return;

    const rigs: CharRig[] = Array.from(
      root.querySelectorAll<SVGSVGElement>("svg[data-doodle]"),
    ).map((svg) => {
      const name = svg.dataset["doodle"] ?? "";
      const art = requireArt(name);
      const pupilEls = Array.from(svg.querySelectorAll<SVGGElement>('[data-part="pupil"]'));
      const eyes: EyeRig[] = [];
      art.eyes.forEach((eye, i) => {
        const pupilEl = pupilEls[i];
        if (pupilEl) eyes.push({ eye, pupilEl, dx: eye.pupil.dx, dy: eye.pupil.dy });
      });
      return {
        svg,
        rect: svg.getBoundingClientRect(),
        outerEl: svg.querySelector<SVGPathElement>('[data-part="outer"]') as SVGPathElement,
        innerEl: svg.querySelector<SVGPathElement>('[data-part="inner"]') as SVGPathElement,
        lashEls: Array.from(svg.querySelectorAll<SVGPathElement>('[data-part="lash"]')),
        eyeEls: Array.from(svg.querySelectorAll<SVGGElement>('[data-part="eye"]')),
        eyes,
        frame: 0,
        name,
      };
    });

    const timers: number[] = [];

    // Line boil: step each character through its 3 pre-jittered frames,
    // phase-staggered so the cast doesn't tick in unison.
    rigs.forEach((rig, i) => {
      const art = requireArt(rig.name);
      timers.push(
        window.setTimeout(() => {
          timers.push(
            window.setInterval(() => {
              rig.frame = (rig.frame + 1) % art.frames.length;
              const f = art.frames[rig.frame];
              if (!f) return;
              rig.outerEl.setAttribute("d", f.outer);
              rig.innerEl.setAttribute("d", f.inner);
              rig.lashEls.forEach((el, j) => {
                const d = f.lashes[j];
                if (d) el.setAttribute("d", d);
              });
            }, BOIL_MS),
          );
        }, i * 47),
      );
    });

    // Gaze: pupils ease toward the pointer, clamped inside the eye whites.
    // The svgs bob (CSS animation), so refresh rects at a slow cadence instead
    // of per pointer event.
    const pointer = { x: 0, y: 0, seen: false };
    const onMove = (event: MouseEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    timers.push(
      window.setInterval(() => {
        for (const rig of rigs) rig.rect = rig.svg.getBoundingClientRect();
      }, 400),
    );

    let raf = 0;
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      if (!pointer.seen) return;
      for (const rig of rigs) {
        const scale = 200 / rig.rect.width;
        for (const er of rig.eyes) {
          const eyeX = rig.rect.left + (er.eye.cx / 200) * rig.rect.width;
          const eyeY = rig.rect.top + (er.eye.cy / 200) * rig.rect.height;
          let tx = (pointer.x - eyeX) * scale;
          let ty = (pointer.y - eyeY) * scale;
          const len = Math.hypot(tx, ty);
          const max = Math.min(er.eye.rx, er.eye.ry) * 0.42;
          if (len > max) {
            tx = (tx / len) * max;
            ty = (ty / len) * max;
          }
          er.dx += (tx - er.dx) * GAZE_LERP;
          er.dy += (ty - er.dy) * GAZE_LERP;
          er.pupilEl.setAttribute(
            "transform",
            `translate(${er.dx.toFixed(2)} ${er.dy.toFixed(2)})`,
          );
        }
      }
    };
    raf = window.requestAnimationFrame(tick);

    // Blink: each character on its own irregular clock.
    rigs.forEach((rig) => {
      const blink = () => {
        rig.eyeEls.forEach((el) => el.classList.add("doodle-blink"));
        timers.push(
          window.setTimeout(() => {
            rig.eyeEls.forEach((el) => el.classList.remove("doodle-blink"));
            timers.push(window.setTimeout(blink, 2600 + Math.random() * 4400));
          }, BLINK_MS),
        );
      };
      timers.push(window.setTimeout(blink, 1400 + Math.random() * 3600));
    });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.cancelAnimationFrame(raf);
      for (const t of timers) {
        window.clearTimeout(t);
        window.clearInterval(t);
      }
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block"
    >
      {DOODLES.map((doodle) => (
        <DoodleSvg key={doodle.name} name={doodle.name} style={doodle.style} />
      ))}
    </div>
  );
}
