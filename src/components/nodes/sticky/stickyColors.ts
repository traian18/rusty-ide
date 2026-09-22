export const STICKY_COLORS = [
  { name: "yellow" },
  { name: "pink" },
  { name: "green" },
  { name: "purple" },
  { name: "blue" },
  { name: "orange" },
] as const;

export type StickyColor = typeof STICKY_COLORS[number];

export const getNextColor = (currentColorName: string): StickyColor => {
  const currentIndex = STICKY_COLORS.findIndex((c) => c.name === currentColorName);
  const nextIndex = (currentIndex + 1) % STICKY_COLORS.length;
  return STICKY_COLORS[nextIndex];
};

export const getRandomColor = (): StickyColor => {
  return STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
};

export const getColorByName = (name: string): StickyColor => {
  return STICKY_COLORS.find((c) => c.name === name) || STICKY_COLORS[0];
};
