/**
 * A world's whole visual identity in one object: sky, horizon, ground and the
 * silhouette on the skyline. Levels reference a theme instead of hardcoding colours,
 * so a new world is a palette plus a layout rather than a new renderer.
 */
export interface Theme {
  id: string;
  /** Sky gradient stops, top to bottom, at 0 / 0.42 / 0.78 / 1. */
  sky: [string, string, string, string];
  hillFar: string;
  hillNear: string;
  /** Distant silhouette drawn behind the hills. */
  skyline: "city" | "castle" | "spires" | "mesa" | "none";
  skylineColor: string;
  /** Lit windows in the skyline; set alpha to 0 for uninhabited worlds. */
  windowColor: string;
  cloudColor: string;
  cloudAlpha: number;
  cloudCount: number;
  /** The local star, moon, or nothing. */
  sun: { xFrac: number; yOffset: number; color: string; radius: number } | null;
  /** Second body in the sky — alien worlds get a companion moon. */
  moon: { xFrac: number; yOffset: number; color: string; radius: number } | null;
  /** Number of background stars; 0 for daytime. */
  stars: number;
  starColor: string;
  /** Warm haze layered over the world for depth. */
  haze: string;
  /** Default terrain colours for this world. */
  ground: string;
  groundTop: string;
  rock: string;
  rockTop: string;
  /** Full-screen colour wash applied over the finished frame. */
  ambient?: string;
  ambientAlpha?: number;
  /** Whether terrain sprouts tufts along its top edge. Dead worlds shouldn't. */
  vegetation: boolean;
}

export const THEMES: Record<string, Theme> = {
  day: {
    id: "day",
    sky: ["#243a63", "#4a7bb0", "#8fb8d6", "#d9d2b6"],
    hillFar: "#6d90a8",
    hillNear: "#4e6b82",
    skyline: "city",
    skylineColor: "#5c7690",
    windowColor: "rgba(255,214,120,0.25)",
    cloudColor: "255,255,255",
    cloudAlpha: 0.72,
    cloudCount: 16,
    sun: { xFrac: 0.78, yOffset: 300, color: "255,240,190", radius: 260 },
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "210,200,170",
    ground: "#3a4b3a",
    groundTop: "#5c8a43",
    rock: "#4a4740",
    rockTop: "#6b6353",
    vegetation: true,
  },

  night: {
    id: "night",
    sky: ["#070b1c", "#101a3a", "#1e2c50", "#33405e"],
    hillFar: "#1b2440",
    hillNear: "#131a2e",
    skyline: "castle",
    skylineColor: "#0d1224",
    windowColor: "rgba(255,180,80,0.55)",
    cloudColor: "120,132,170",
    cloudAlpha: 0.3,
    cloudCount: 9,
    sun: null,
    moon: { xFrac: 0.72, yOffset: 250, color: "226,232,255", radius: 74 },
    stars: 150,
    starColor: "#dfe6ff",
    haze: "40,52,92",
    ground: "#1f2a24",
    groundTop: "#2f4a33",
    rock: "#2a2a30",
    rockTop: "#3d3d46",
    vegetation: true,
    ambient: "#1a2450",
    ambientAlpha: 0.22,
  },

  alien: {
    id: "alien",
    sky: ["#160c2b", "#2c1450", "#4a2a5e", "#6d5a4a"],
    hillFar: "#3f2a5c",
    hillNear: "#2a1c40",
    skyline: "spires",
    skylineColor: "#1d1230",
    windowColor: "rgba(150,255,170,0.4)",
    cloudColor: "150,110,190",
    cloudAlpha: 0.34,
    cloudCount: 12,
    sun: { xFrac: 0.26, yOffset: 330, color: "180,255,190", radius: 200 },
    moon: { xFrac: 0.78, yOffset: 200, color: "255,190,220", radius: 52 },
    stars: 90,
    starColor: "#d7ffe6",
    haze: "110,200,120",
    ground: "#2e2340",
    groundTop: "#4c7a45",
    rock: "#332747",
    rockTop: "#4a3a62",
    vegetation: true,
    ambient: "#2e7a44",
    ambientAlpha: 0.1,
  },

  mars: {
    id: "mars",
    sky: ["#3a1c14", "#6e3320", "#a85c33", "#d9a06a"],
    hillFar: "#8a4a2c",
    hillNear: "#63321e",
    skyline: "mesa",
    skylineColor: "#4a2417",
    windowColor: "rgba(255,255,255,0)",
    cloudColor: "210,150,110",
    cloudAlpha: 0.22,
    cloudCount: 7,
    sun: { xFrac: 0.68, yOffset: 320, color: "255,235,200", radius: 130 },
    moon: null,
    stars: 40,
    starColor: "#ffd9c0",
    haze: "220,150,100",
    ground: "#7a3b22",
    groundTop: "#a35a30",
    rock: "#5e2d1a",
    rockTop: "#8a4425",
    // Nothing grows on Mars.
    vegetation: false,
  },
};
