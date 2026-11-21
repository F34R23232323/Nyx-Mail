/**
 * NyxMail mobile design tokens.
 *
 * A single source of truth for colour, type, spacing and radii used by every
 * screen. Dark is the default because it matches the futuristic, zero-access
 * identity of the product; light is a full, equally polished alternative.
 */

export type ThemeMode = "dark" | "light";

export interface Palette {
  mode: ThemeMode;
  canvas: string;
  canvasRaised: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderSoft: string;
  borderStrong: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentFaint: string;
  pink: string;
  pinkSoft: string;
  mint: string;
  mintSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  star: string;
  overlay: string;
  scrim: string;
  tabBar: string;
  shadow: string;
  gradient: readonly [string, string, string];
  avatarGradients: readonly (readonly [string, string])[];
}

const dark: Palette = {
  mode: "dark",
  canvas: "#08090D",
  canvasRaised: "#0C0E14",
  surface: "#11131A",
  surfaceRaised: "#171A23",
  surfaceSunken: "#0A0B10",
  border: "#222634",
  borderSoft: "#191D27",
  borderStrong: "#303547",
  ink: "#F3F5FA",
  inkSoft: "#D9DDE8",
  muted: "#98A0B3",
  faint: "#697086",
  accent: "#8A78FF",
  accentStrong: "#A794FF",
  accentSoft: "rgba(138,120,255,0.16)",
  accentFaint: "rgba(138,120,255,0.08)",
  pink: "#FF5E8E",
  pinkSoft: "rgba(255,94,142,0.15)",
  mint: "#3FE0C5",
  mintSoft: "rgba(63,224,197,0.14)",
  warning: "#F2B95C",
  warningSoft: "rgba(242,185,92,0.14)",
  danger: "#FF7185",
  dangerSoft: "rgba(255,113,133,0.14)",
  star: "#FFC65C",
  overlay: "rgba(255,255,255,0.04)",
  scrim: "rgba(2,3,6,0.72)",
  tabBar: "#0D0F16",
  shadow: "#000000",
  gradient: ["#A794FF", "#8A78FF", "#5E45E8"],
  avatarGradients: [
    ["#7C6BFF", "#4B3AC7"],
    ["#FF6D9B", "#B92F65"],
    ["#37D6C0", "#12897C"],
    ["#FFB25C", "#C46A18"],
    ["#5CB8FF", "#1D62C4"],
    ["#C084FC", "#7C2DCE"],
    ["#6EE7A8", "#15935F"],
    ["#FF8A65", "#C43D2B"],
  ],
};

const light: Palette = {
  mode: "light",
  canvas: "#F4F4F8",
  canvasRaised: "#F9F9FC",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#EDEDF3",
  border: "#E2E2EC",
  borderSoft: "#EBEBF2",
  borderStrong: "#D2D2DF",
  ink: "#161823",
  inkSoft: "#2B2E3D",
  muted: "#666C7E",
  faint: "#959AAB",
  accent: "#6D4AFF",
  accentStrong: "#5B36F0",
  accentSoft: "rgba(109,74,255,0.12)",
  accentFaint: "rgba(109,74,255,0.06)",
  pink: "#E23F76",
  pinkSoft: "rgba(226,63,118,0.11)",
  mint: "#0F9E88",
  mintSoft: "rgba(15,158,136,0.11)",
  warning: "#B6790F",
  warningSoft: "rgba(182,121,15,0.12)",
  danger: "#D63B52",
  dangerSoft: "rgba(214,59,82,0.1)",
  star: "#E3A21A",
  overlay: "rgba(16,17,24,0.03)",
  scrim: "rgba(15,16,25,0.42)",
  tabBar: "#FFFFFF",
  shadow: "#181A2A",
  gradient: ["#8A6BFF", "#6D4AFF", "#4A2BD0"],
  avatarGradients: [
    ["#6D4AFF", "#4726CB"],
    ["#E85588", "#B02F5D"],
    ["#17A894", "#0B7165"],
    ["#E09A32", "#AD5E11"],
    ["#3D94E8", "#1554AC"],
    ["#A85DF0", "#6D1DB8"],
    ["#3DBB7A", "#137A4D"],
    ["#E87450", "#B33A26"],
  ],
};

export const palettes: Record<ThemeMode, Palette> = { dark, light };

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

export const fontSize = {
  micro: 10,
  tiny: 11,
  caption: 12,
  small: 13,
  body: 15,
  title: 17,
  heading: 20,
  display: 28,
  hero: 34,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
