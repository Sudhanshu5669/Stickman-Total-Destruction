/**
 * A world's whole visual identity in one object: sky, horizon, ground and the
 * silhouette on the skyline. Levels reference a theme instead of hardcoding colours,
 * so a new world is a palette plus a layout rather than a new renderer.
 *
 * Every palette here is built on the same seven-step value ladder, because the game's
 * lead character is a black stick figure and the only thing that can lose him is a
 * frame with no value structure. Read top to bottom, each world runs:
 *
 *   1 sky top        darkest sky, most saturated — gives the frame a lid
 *   2 sky horizon    lightest thing in the frame; silhouettes are read against it
 *   3 far silhouette barely separated from the sky (atmospheric perspective)
 *   4 ridges         far → mid → near, each step darker and more saturated
 *   5 surface line   brightest saturated colour in the frame, one hard graphic edge
 *   6 soil body      mid-dark and warm, so props and rubble sit on top of it
 *   7 bedrock        near-black, the floor of the value range
 *
 * The rule the whole thing exists to serve: **background low-contrast, playable band
 * high-contrast.** Everything from the horizon up sits inside a narrow, desaturated
 * range; everything the player can touch is separated by at least two steps of value
 * from whatever it sits against. That is what makes a black stickman read instantly,
 * and what makes the frame survive being shrunk to a 200px thumbnail.
 */
/**
 * One image layer of a painted backdrop.
 *
 * `depth` is the scroll rate (1.0 would be locked to the world), `height` is how many
 * metres tall to draw the sheet, and `lift` raises its bottom edge off the horizon —
 * negative sinks it, which is how a layer's solid base band gets hidden behind the
 * terrain instead of stranded above it.
 */
export interface BackdropLayer {
  path: string;
  depth: number;
  height: number;
  lift: number;
  alpha?: number;
}

/**
 * A backdrop made of artwork rather than of code.
 *
 * The procedural path — baked strips, generated skylines, sine ridges — stays the
 * default and stays untouched; a theme that sets this opts out of all of it in favour
 * of parallaxed image layers. Only the world built on a bought tileset uses it.
 */
export interface SpriteBackdrop {
  /** Layers far to near. Drawn in array order. */
  layers: BackdropLayer[];
  /** Flat colour behind the furthest layer, for viewports taller than the art. */
  sky: string;
}

export interface Theme {
  id: string;
  /** Sky gradient stops, top to bottom, at 0 / 0.42 / 0.78 / 1. */
  sky: [string, string, string, string];
  /**
   * Light banked along the horizon itself, as "r,g,b". This is the single cheapest
   * source of drama in the frame: it lifts the sky exactly where silhouettes cross it.
   */
  horizonGlow: string;
  horizonGlowAlpha: number;
  /** Ridge bands, far to near. Each is darker and more saturated than the last. */
  hillFar: string;
  hillMid: string;
  hillNear: string;
  /** Distant silhouette drawn behind the hills. */
  skyline: "city" | "castle" | "spires" | "mesa" | "none";
  skylineColor: string;
  /** A second, hazier silhouette band behind `skylineColor` — depth in one colour. */
  skylineFar: string;
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
  /**
   * Bedrock. Everything below the ground plane fades from `ground` to this, which is
   * both the depth cue under a canyon and the reason no sky can ever show beneath the
   * terrain slabs — see `Background.drawSubsurface`.
   */
  underground: string;
  /** Near-camera silhouettes that pass in front of the action. Near-black by design. */
  foreground: string;
  /** Which shape vocabulary the near layer uses. */
  foregroundKind: "grass" | "bones" | "fungal" | "rock";
  /** Full-screen colour wash applied over the finished frame. */
  ambient?: string;
  ambientAlpha?: number;
  /** Whether terrain sprouts tufts along its top edge. Dead worlds shouldn't. */
  vegetation: boolean;
  /** Painted backdrop. When set, it replaces sky, clouds, skyline and ridges entirely. */
  sprites?: SpriteBackdrop;
}

/** Where the platformer pack's parallax layers live, so the paths appear once. */
const PACK_BG = "GandalfHardcore FREE Platformer Assets/GandalfHardcore Background layers";
const BG = `${PACK_BG}/Normal BG`;
const BG_AUTUMN = `${PACK_BG}/Autumn BG`;
const BG_WINTER = `${PACK_BG}/Winter BG`;
const BG_CITY = "GandalfHardcore City Tiles";

/**
 * The platformer pack's five parallax plates, as one backdrop.
 *
 * The three seasonal sets are the same picture repainted, so they share every number:
 * identical size, identical anchor, only the scroll rate differing between plates. See
 * the long note on `grove.sprites` for why sizing them individually destroys the
 * illusion — that lesson cost real time and applies to all three.
 */
const seasonBackdrop = (dir: string, castle: string, sky: string): SpriteBackdrop => ({
  sky,
  layers: [
    { path: `${dir}/GandalfHardcore Background layers_layer 5.png`, depth: 0.02, height: 34, lift: -1 },
    { path: `${dir}/${castle}`, depth: 0.05, height: 15, lift: -1 },
    { path: `${dir}/GandalfHardcore Background layers_layer 4.png`, depth: 0.10, height: 15, lift: -1 },
    { path: `${dir}/GandalfHardcore Background layers_layer 3.png`, depth: 0.17, height: 15, lift: -1 },
    { path: `${dir}/GandalfHardcore Background layers_layer 2.png`, depth: 0.27, height: 15, lift: -1 },
    { path: `${dir}/GandalfHardcore Background layers_layer 1.png`, depth: 0.42, height: 15, lift: -1 },
  ],
});

export const THEMES: Record<string, Theme> = {
  /**
   * Test Range — bright noon playground.
   *
   * The whole sky runs cool (azure → cyan → cream) and the whole ground runs warm
   * (emerald → ochre → chocolate), so the horizon is a hue flip as well as a value
   * flip. It also keeps the level's own materials legible: brick towers are warm red
   * and concrete is neutral grey, and both of those separate hard from a cool backdrop.
   */
  day: {
    id: "day",
    sky: ["#0742a0", "#1a86e0", "#6fd2f5", "#ffe7a8"],
    horizonGlow: "255,222,138",
    horizonGlowAlpha: 0.55,
    hillFar: "#63a2c4",
    hillMid: "#358a94",
    hillNear: "#18613f",
    skyline: "city",
    skylineColor: "#3f77ac",
    skylineFar: "#86bbdb",
    windowColor: "rgba(255,216,128,0.55)",
    cloudColor: "255,255,255",
    cloudAlpha: 0.9,
    cloudCount: 18,
    sun: { xFrac: 0.78, yOffset: 300, color: "255,244,196", radius: 300 },
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "255,224,164",
    ground: "#7d4520",
    groundTop: "#63e03f",
    rock: "#6b5a44",
    rockTop: "#9c8560",
    underground: "#211105",
    foreground: "#0e2411",
    foregroundKind: "grass",
    // A whisper of warm overlay. Overlay only pushes what is already there, so it
    // saturates the greens and golds without touching the black of the stickmen.
    ambient: "#ffc46a",
    ambientAlpha: 0.07,
    vegetation: true,
  },

  /**
   * Blackthorn Keep — cold moonlit night with warm fire in it.
   *
   * Night is where a black protagonist is easiest to lose, so this palette does the
   * opposite of what "night" usually means: the sky gets *lighter* toward the horizon
   * and the ground surface is held at a genuine mid value. The castle is the only
   * near-black mass, which is exactly where you want the eye. Every artificial light
   * — windows, torches — is warm orange against cold blue, the strongest contrast pair
   * available, and it is spent only on things that matter.
   */
  night: {
    id: "night",
    sky: ["#02040f", "#0a1642", "#20489c", "#7aa0dc"],
    horizonGlow: "130,176,248",
    horizonGlowAlpha: 0.44,
    hillFar: "#2f4a80",
    hillMid: "#1c2e55",
    hillNear: "#0f1930",
    skyline: "castle",
    skylineColor: "#080d1c",
    skylineFar: "#2b4068",
    windowColor: "rgba(255,174,58,0.92)",
    cloudColor: "138,158,206",
    cloudAlpha: 0.34,
    cloudCount: 11,
    sun: null,
    moon: { xFrac: 0.72, yOffset: 250, color: "232,240,255", radius: 78 },
    stars: 170,
    starColor: "#eaf1ff",
    haze: "70,110,190",
    ground: "#263b34",
    groundTop: "#4fae7e",
    rock: "#2e3442",
    rockTop: "#4d566b",
    underground: "#05090f",
    foreground: "#050912",
    foregroundKind: "bones",
    ambient: "#1a3a7a",
    ambientAlpha: 0.2,
    vegetation: true,
  },

  /**
   * Xenoform Basin — violet and acid, and nothing in between.
   *
   * Built on the one complementary pair no other world in the game uses: magenta sky
   * against lime ground. They are near-equal in value, so the horizon has to be carried
   * by chroma alone — which is why the surface line is the most saturated colour
   * anywhere in the game and the ridge under it is the least. Soil stays violet rather
   * than going green, so the lime reads as a *crust* growing on something else.
   */
  alien: {
    id: "alien",
    sky: ["#0d0126", "#3a077a", "#8f1094", "#ff4fa4"],
    horizonGlow: "255,120,196",
    horizonGlowAlpha: 0.52,
    hillFar: "#6d1f86",
    hillMid: "#460f63",
    hillNear: "#280b3e",
    skyline: "spires",
    skylineColor: "#170422",
    skylineFar: "#93379b",
    windowColor: "rgba(180,255,110,0.85)",
    cloudColor: "186,104,214",
    cloudAlpha: 0.42,
    cloudCount: 13,
    sun: { xFrac: 0.26, yOffset: 330, color: "196,255,160", radius: 230 },
    moon: { xFrac: 0.78, yOffset: 200, color: "255,196,226", radius: 54 },
    stars: 110,
    starColor: "#ffd9f2",
    haze: "150,86,190",
    ground: "#3a2166",
    groundTop: "#aaff2e",
    rock: "#2e2044",
    rockTop: "#5b3f7e",
    underground: "#0c041a",
    foreground: "#140a20",
    foregroundKind: "fungal",
    ambient: "#8a2eff",
    ambientAlpha: 0.08,
    vegetation: true,
  },

  /**
   * Ares Colony — butterscotch sky, rust ground, cold light in the windows.
   *
   * Mars is one hue family top to bottom, so it lives or dies on value separation:
   * every band is a clean step, maroon at the top down to near-black bedrock. The only
   * colour that breaks the family is the cyan in the habitat lights, and that is
   * deliberate — one cold accent is what stops an all-orange frame reading as a smear,
   * and it happens to match the off-white `hull` panelling the level is built from.
   */
  mars: {
    id: "mars",
    sky: ["#3f0d0a", "#b0441a", "#f08a33", "#ffe0a8"],
    horizonGlow: "255,190,112",
    horizonGlowAlpha: 0.5,
    hillFar: "#c4703a",
    hillMid: "#94441c",
    hillNear: "#6b2a11",
    skyline: "mesa",
    skylineColor: "#722c12",
    skylineFar: "#cc8155",
    windowColor: "rgba(126,232,255,0.8)",
    cloudColor: "236,180,132",
    cloudAlpha: 0.3,
    cloudCount: 9,
    sun: { xFrac: 0.68, yOffset: 320, color: "255,240,208", radius: 160 },
    moon: null,
    stars: 55,
    starColor: "#ffe0c8",
    haze: "245,172,110",
    ground: "#963f1c",
    groundTop: "#e07b34",
    rock: "#5e3320",
    rockTop: "#93542e",
    underground: "#1c0703",
    foreground: "#2a0f06",
    foregroundKind: "rock",
    ambient: "#ff7a3c",
    ambientAlpha: 0.08,
    // Nothing grows on Mars.
    vegetation: false,
  },

  /**
   * Hollowbrook — the one world drawn by a person instead of by this file.
   *
   * Every other theme here is a palette the renderer turns into art. This one is art,
   * and the palette exists only to serve the parts of the frame the artwork does not
   * cover: the soil under a crater, the haze, the tint. So the values are sampled
   * straight from the tileset rather than composed — the point is that nothing the
   * engine draws underneath can be told apart from what the pack draws on top.
   *
   * The procedural sky, clouds, skyline and ridges are all switched off. Five painted
   * layers replace them, and `skyline: "none"` keeps the backdrop baker from generating
   * a silhouette strip that would never be blitted.
   */
  grove: {
    id: "grove",
    // Sampled off the pack's own sky layer, so the flat fill above the art matches it.
    sky: ["#7ec4d2", "#a5dbe4", "#c6ebef", "#dcf2f2"],
    horizonGlow: "220,244,240",
    horizonGlowAlpha: 0.2,
    hillFar: "#7c8a5a",
    hillMid: "#5c6f42",
    hillNear: "#3f5730",
    skyline: "none",
    skylineColor: "#3f5730",
    skylineFar: "#7c8a5a",
    windowColor: "rgba(255,206,120,0.85)",
    cloudColor: "255,255,255",
    cloudAlpha: 0,
    cloudCount: 0,
    sun: null,
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "198,232,228",
    // Dirt and grass lifted from Floor Tiles1, so a hole blown in the tiled surface
    // exposes exactly the colours the tiles themselves are drawn in.
    ground: "#2b1f16",
    groundTop: "#6ab04a",
    rock: "#6d6257",
    rockTop: "#9a8d7c",
    underground: "#150e09",
    foreground: "#1d2a16",
    foregroundKind: "grass",
    ambient: "#ffe6b0",
    ambientAlpha: 0.05,
    vegetation: false,
    /**
     * The six plates are one picture the artist sliced, not six independent bands: they
     * are drawn at an identical size and anchor, and *only* the scroll rate differs.
     * Sizing them individually — which is the obvious thing to try — pushes each plate's
     * horizon to a different height and the distance falls apart into stacked stickers.
     *
     * 15 metres is the number the composition turns on. It puts the near treeline's
     * crown at roughly 11m and its opaque base a metre below the ground line, so the
     * pines top out inside the frame at resting zoom with sky above them, and the band
     * of solid green under them is hidden by the terrain instead of stranded over it.
     * The sky plate alone is drawn taller, since it is a gradient with no horizon of its
     * own to misplace and it has to keep covering as the jetpack climbs.
     */
    sprites: {
      // The sky plate's own top colour, so the fill above it is not a visible seam.
      sky: "#8ecdd8",
      layers: [
        { path: `${BG}/GandalfHardcore Background layers_layer 5.png`, depth: 0.02, height: 34, lift: -1 },
        { path: `${BG}/Background Castle .png`, depth: 0.05, height: 15, lift: -1 },
        { path: `${BG}/GandalfHardcore Background layers_layer 4.png`, depth: 0.10, height: 15, lift: -1 },
        { path: `${BG}/GandalfHardcore Background layers_layer 3.png`, depth: 0.17, height: 15, lift: -1 },
        { path: `${BG}/GandalfHardcore Background layers_layer 2.png`, depth: 0.27, height: 15, lift: -1 },
        { path: `${BG}/GandalfHardcore Background layers_layer 1.png`, depth: 0.42, height: 15, lift: -1 },
      ],
    },
  },

  /**
   * Ashfall — the autumn valley.
   *
   * Same pack, same plates, repainted warm. It exists because a set of six arenas needs
   * to be six *places*, and the cheapest honest way to get a second place out of one
   * tileset is the season the artist already drew. The ground colours are pulled off the
   * autumn plates rather than reused from `grove`, so a hole blown in the turf exposes
   * the same russet the backdrop is painted in.
   */
  autumn: {
    id: "autumn",
    sky: ["#c98a4b", "#e0a862", "#efc98d", "#f6e0b4"],
    horizonGlow: "255,214,150",
    horizonGlowAlpha: 0.26,
    hillFar: "#9a7440",
    hillMid: "#7d5730",
    hillNear: "#5a3d22",
    skyline: "none",
    skylineColor: "#5a3d22",
    skylineFar: "#9a7440",
    windowColor: "rgba(255,206,120,0.85)",
    cloudColor: "255,240,214",
    cloudAlpha: 0,
    cloudCount: 0,
    sun: null,
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "236,200,150",
    ground: "#2e1d10",
    groundTop: "#a8622a",
    rock: "#6f5e4c",
    rockTop: "#9c8770",
    underground: "#160d06",
    foreground: "#2a1a0e",
    foregroundKind: "grass",
    ambient: "#ffc27a",
    ambientAlpha: 0.08,
    vegetation: false,
    sprites: seasonBackdrop(BG_AUTUMN, "Background Castle Autumn.png", "#dda86a"),
  },

  /**
   * Coldspine — the winter fortress.
   *
   * The one arena with a genuinely cold palette, which matters more than it sounds:
   * five warm-to-neutral worlds in a row make the whole game feel like one long level.
   * Snow also does something no other surface here does — it makes the black stickman
   * the *darkest* thing in the frame by a wide margin, so the ragdolls read even when
   * the screen is full of debris.
   */
  winter: {
    id: "winter",
    sky: ["#5d7fa8", "#8fb0cc", "#c2d8e6", "#e6eff5"],
    horizonGlow: "226,240,252",
    horizonGlowAlpha: 0.3,
    hillFar: "#8fa3b8",
    hillMid: "#6d8298",
    hillNear: "#4e6376",
    skyline: "none",
    skylineColor: "#4e6376",
    skylineFar: "#8fa3b8",
    windowColor: "rgba(255,206,120,0.9)",
    cloudColor: "255,255,255",
    cloudAlpha: 0,
    cloudCount: 0,
    sun: null,
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "222,236,246",
    // Frozen earth under snow, so a crater reads as broken ground rather than as a hole
    // in a white rectangle.
    ground: "#2a3340",
    groundTop: "#eaf2f8",
    rock: "#5c6773",
    rockTop: "#8f9ba8",
    underground: "#141a22",
    foreground: "#20303f",
    foregroundKind: "rock",
    ambient: "#cfe4f5",
    ambientAlpha: 0.1,
    vegetation: false,
    sprites: seasonBackdrop(BG_WINTER, "Background Castle  Winter.png", "#a8c6da"),
  },

  /**
   * Grid City — the street.
   *
   * A different pack entirely, and the only arena with a man-made horizon. Its backdrop
   * is three plates rather than six and they are *wider* than they are tall, so they are
   * anchored lower and drawn larger than the platformer set: a city skyline wants to sit
   * on the ground line and tower over it, where a treeline wants to sit behind it.
   */
  city: {
    id: "city",
    sky: ["#1b2540", "#33436b", "#5f6f95", "#93a0bd"],
    horizonGlow: "180,196,232",
    horizonGlowAlpha: 0.24,
    hillFar: "#3d4866",
    hillMid: "#2e3852",
    hillNear: "#222a3e",
    skyline: "none",
    skylineColor: "#222a3e",
    skylineFar: "#3d4866",
    windowColor: "rgba(255,214,140,0.95)",
    cloudColor: "210,220,244",
    cloudAlpha: 0,
    cloudCount: 0,
    sun: null,
    moon: null,
    stars: 0,
    starColor: "#ffffff",
    haze: "150,166,204",
    ground: "#262b34",
    groundTop: "#4c5561",
    rock: "#3c4450",
    rockTop: "#5e6874",
    underground: "#12151b",
    foreground: "#161b25",
    foregroundKind: "rock",
    ambient: "#8fa8d8",
    ambientAlpha: 0.07,
    vegetation: false,
    sprites: {
      sky: "#4a5878",
      layers: [
        { path: `${BG_CITY}/City background sky.png`, depth: 0.02, height: 30, lift: -2 },
        { path: `${BG_CITY}/City background layer2.png`, depth: 0.09, height: 24, lift: -2 },
        { path: `${BG_CITY}/City background layer1.png`, depth: 0.2, height: 22, lift: -2 },
      ],
    },
  },

};
