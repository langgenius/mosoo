import type { CSSProperties, ReactElement } from "react";

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

export function LoginDoodles(): ReactElement {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block"
    >
      {DOODLES.map((doodle) => (
        <img
          key={doodle.name}
          src={`/doodles/${doodle.name}.svg`}
          alt=""
          draggable={false}
          className="login-doodle absolute"
          style={doodle.style}
        />
      ))}
    </div>
  );
}
