import { useId } from "react";

/** The Fetchly mark: a sleek lightning-bolt download arrow. */
export function LogoMark({ size = 22, glass = "white" }: { size?: number; glass?: "white" | "indigo" }) {
  const id = useId().replace(/:/g, "");
  const white = glass === "white";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={`${id}f`} x1="20" y1="8" x2="44" y2="56" gradientUnits="userSpaceOnUse">
          {white ? (
            <>
              <stop stopColor="#a78bfa" />
              <stop offset="0.5" stopColor="#60a5fa" />
              <stop offset="1" stopColor="#22d3ee" />
            </>
          ) : (
            <>
              <stop stopColor="#8b5cf6" />
              <stop offset="0.5" stopColor="#3b82f6" />
              <stop offset="1" stopColor="#06b6d4" />
            </>
          )}
        </linearGradient>
      </defs>
      <path
        d="M31 8h11L32.5 24H43L31 38h9.5L29 56 17.5 38H27l6-10H22L31 8z"
        fill={`url(#${id}f)`}
        stroke="#fff"
        strokeOpacity={white ? 0.35 : 0.25}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark on the dark rounded brand tile (reads the same in both themes). */
export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-tile" style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <LogoMark size={Math.round(size * 0.78)} />
    </span>
  );
}
