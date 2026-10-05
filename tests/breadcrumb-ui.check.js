// Run in an authenticated workspace with playwright-cli run-code.
async (page) => {
  const originalViewport = page.viewportSize();
  try {
    for (const width of [1440, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      const result = await page.locator(".breadcrumbs").evaluate((nav) => {
        const items = [...nav.children];
        const centers = items.map((item) => {
          const rect = item.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        const type = items.map((item) => {
          const style = getComputedStyle(item);
          return [style.fontSize, style.lineHeight, style.fontWeight].join("/");
        });
        return {
          aligned: Math.max(...centers) - Math.min(...centers) < 1,
          type,
          overflow: document.documentElement.scrollWidth > innerWidth,
          current: nav.querySelector('[aria-current="page"]') !== null,
        };
      });
      if (
        !result.aligned ||
        result.overflow ||
        !result.current ||
        result.type.some((type) => type !== "14px/21px/500")
      ) {
        throw new Error(
          "Breadcrumb contract failed at " +
            width +
            ": " +
            JSON.stringify(result),
        );
      }
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
};
