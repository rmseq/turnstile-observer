const ORB = {
  width: 58,
  height: 34,
  horizontalScale: 0.47,
  verticalScale: 0.5,
  radius: 0.74,
};

const GLYPHS = " .,:;ox%#@";
const FRAME_DELAY = 85;

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const stateRadiusOffset = (state, tick, angle) => {
  if (state === "waiting") return Math.sin(tick * 0.13) * 0.06;
  if (state === "failed") return -0.11 + Math.sin(tick * 0.18) * 0.05;
  if (state === "verified") return Math.sin(tick * 0.08) * 0.009;
  if (state === "error") return Math.sin(tick * 0.1) * 0.018;
  if (state === "checking")
    return (
      Math.sin(angle * 4 + tick * 0.16) * 0.022 + Math.sin(tick * 0.11) * 0.012
    );
  return 0;
};

const surfaceTexture = (state, column, row, angle, tick) => {
  if (state === "checking")
    return Math.sin(column * 1.7 + row * 0.8 + tick * 1.35) * 0.075;
  if (state === "failed")
    return -Math.abs(Math.sin(angle * 5 + tick * 0.17)) * 0.12;
  return 0;
};

const highlight = (state, x, y, tick) =>
  state === "verified" ? Math.sin(tick * 0.17 + x * 5 - y * 3) * 0.075 : 0;

const errorGlyph = (state, x, y, tick, fallback) => {
  if (state !== "error") return fallback;
  const fractured = Math.abs(Math.sin(x * 25 + y * 13 + tick * 0.14)) < 0.11;
  const broken = Math.sin(x * 7 - y * 11 - tick * 0.19) > 0.87;
  if (broken) return " ";
  return fractured ? (x + y > 0 ? "/" : "\\") : fallback;
};

const glyphAt = (state, tick, column, row) => {
  const x = (column - ORB.width / 2) / (ORB.width * ORB.horizontalScale);
  const y = (row - ORB.height / 2) / (ORB.height * ORB.verticalScale);
  const angle = Math.atan2(y, x);
  const radius = ORB.radius + stateRadiusOffset(state, tick, angle);
  const distance = Math.hypot(x, y);
  if (distance > radius) return " ";

  const z = Math.sqrt(Math.max(0, radius * radius - distance * distance));
  const lighting = Math.max(0, x * -0.36 + y * -0.42 + z * 0.85);
  const shade = clamp(
    lighting +
      surfaceTexture(state, column, row, angle, tick) +
      highlight(state, x, y, tick),
    0,
    1,
  );
  const glyph = GLYPHS[Math.floor(shade * (GLYPHS.length - 1))];
  return errorGlyph(state, x, y, tick, glyph);
};

const makeOrb = (state, tick) =>
  Array.from({ length: ORB.height }, (_, row) =>
    Array.from({ length: ORB.width }, (_, column) =>
      glyphAt(state, tick, column, row),
    ).join(""),
  ).join("\n");

export const createSignal = (element) => {
  let state = "waiting";
  let frame = 0;
  let intervalId;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const draw = () => {
    element.textContent = makeOrb(state, frame++);
  };
  const stop = () => {
    if (intervalId === undefined) return;
    clearInterval(intervalId);
    intervalId = undefined;
  };
  const start = () => {
    if (document.hidden || reducedMotion.matches || intervalId !== undefined)
      return;
    intervalId = setInterval(draw, FRAME_DELAY);
  };
  const updateAnimation = () => {
    stop();
    if (!document.hidden && !reducedMotion.matches) {
      draw();
      start();
    }
  };

  draw();
  start();
  document.addEventListener("visibilitychange", updateAnimation);
  reducedMotion.addEventListener("change", updateAnimation);

  return (nextState) => {
    state = nextState;
    element.dataset.state = state;
    draw();
  };
};
