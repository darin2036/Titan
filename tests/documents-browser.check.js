// Authenticated workspace. Uses a browser-only folder fixture; no documents change.
async (page) => {
  const response = await page.request.get(
    new URL("/api/v1/documents", page.url()).href,
  );
  if (!response.ok()) throw new Error("Document listing failed");
  const files = await response.json();
  if (!files.length) throw new Error("Requires one readable document");
  const fixture = [
    { ...files[0], path: "guides/handbook.md" },
    { ...files[0], path: "overview.md" },
  ];
  const route = async (route) => route.fulfill({ json: fixture });
  await page.route("**/api/v1/documents", route);
  try {
    await page.setViewportSize({ width: 1400, height: 800 });
    await page
      .getByRole("navigation", { name: "Browse workspace", exact: true })
      .getByRole("button", { name: "All records", exact: true })
      .click();
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    const browser = page.getByRole("region", {
      name: "Document files",
      exact: true,
    });
    await browser
      .getByRole("button", { name: "guides Folder", exact: true })
      .click();
    await browser
      .getByRole("navigation", { name: "Document folders" })
      .getByRole("button", { name: "guides", exact: true })
      .waitFor();
    if (
      !(await browser.locator(".document-file-name").textContent()).includes(
        "handbook.md",
      )
    )
      throw new Error("Folder contents missing");
    await browser
      .getByRole("button", { name: "Document root", exact: true })
      .click();
    await browser
      .getByRole("searchbox", { name: "Find document files" })
      .fill("handbook");
    if ((await browser.locator(".document-file-row").count()) !== 1)
      throw new Error("Document search failed");
    for (const width of [1400, 761, 390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      const result = await browser.evaluate((el) => ({
        rect: el.getBoundingClientRect().toJSON(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      if (result.rect.left < 0 || result.rect.right > width || result.overflow)
        throw new Error("Browser overflows at " + width);
    }
    await browser.locator(".document-file-row").click();
    await page
      .getByRole("heading", { name: files[0].title, exact: true, level: 1 })
      .waitFor();
  } finally {
    await page.unroute("**/api/v1/documents", route);
    await page.setViewportSize({ width: 1400, height: 800 });
  }
};
