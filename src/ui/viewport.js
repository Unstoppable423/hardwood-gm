// Pure geometry for the scrolling shell. The page itself does not scroll.
// iOS Safari / in-app browsers report the visible area on visualViewport:
// offsetTop is the browser chrome covering the top of the layout viewport,
// and height is the visible height. Sticky headers pinned to the layout
// viewport sit under that chrome, and with scroll already at 0 the user
// cannot scroll up to reveal them.
export function viewportBox({ innerHeight = 0, offsetTop = 0, height = 0, scale = 1 } = {}) {
  const ih = Math.max(0, Math.round(Number(innerHeight) || 0));
  const zoomed = Math.abs((Number(scale) || 1) - 1) > 0.01;
  if (zoomed || !ih) return { active: false, top: 0, height: ih, bottom: 0 };
  let top = Math.round(Number(offsetTop) || 0);
  // A huge offset is a rubber-band or a zoom leftover, not browser chrome.
  if (top < 0 || top > 180) top = 0;
  let h = Math.round(Number(height) || 0);
  if (h < 240) h = ih;
  let bottom = Math.round(ih - h - top);
  if (bottom < 0 || bottom > 240) bottom = 0;
  return { active: true, top, height: h, bottom };
}
