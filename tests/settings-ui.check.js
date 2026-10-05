// Read-only UI verification. Start from an authenticated Settings integrations catalog.
async (page) => {
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.waitFor();
  for (const [name, section] of [
    ["Repository", "repository"],
    ["Intelligence & autonomy", "intelligence"],
    ["Agent access", "access"],
    ["Background operations", "operations"],
    ["Integrations", "integrations"],
  ]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    if (!page.url().endsWith("#settings/" + section))
      throw new Error("Settings section has no dedicated route");
    if (
      (await nav
        .getByRole("button", { name, exact: true })
        .getAttribute("aria-current")) !== "page"
    )
      throw new Error("Active section is not accessible");
    if (
      section !== "integrations" &&
      (await page.getByRole("button", { name: "Configure Confluence" }).count())
    )
      throw new Error("Integration catalog leaked into another section");
  }
  await page.reload();
  await page.getByRole("button", { name: "Configure Confluence" }).waitFor();
  for (const [width, height] of [
    [1440, 1000],
    [1024, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Settings overflow the viewport");
    const typography = await nav.locator("button").evaluateAll((nodes) =>
      nodes.map((node) => {
        const s = getComputedStyle(node);
        return `${s.fontSize}/${s.lineHeight}/${s.fontWeight}`;
      }),
    );
    if (typography.some((style) => style !== "14px/21px/500"))
      throw new Error("Settings navigation typography differs from controls");
    if (
      (await page
        .locator(".integration-card-action")
        .evaluate((node) => getComputedStyle(node).fontSize)) !== "14px"
    )
      throw new Error("Configuration action has incorrect typography");
    if (
      width === 390 &&
      (
        await page
          .getByRole("button", { name: "Navigation", exact: true })
          .boundingBox()
      ).height > 64
    )
      throw new Error("Mobile navigation stretches on short Settings pages");
    await page.screenshot({
      path: `output/playwright/settings-catalog-${width}.png`,
    });
  }
  await page.getByRole("button", { name: "Configure Confluence" }).click();
  await page
    .getByRole("heading", { name: "Confluence", exact: true })
    .waitFor();
  if (
    (await nav
      .getByRole("button", { name: "Integrations", exact: true })
      .getAttribute("aria-current")) !== "page"
  )
    throw new Error("Configuration lost its settings navigation");
  await page.reload();
  await page
    .getByRole("heading", { name: "Confluence", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "← All integrations", exact: true })
    .click();
  await page.getByRole("button", { name: "Configure Confluence" }).waitFor();
  await page.goBack();
  await page
    .getByRole("heading", { name: "Confluence", exact: true })
    .waitFor();
  await nav.getByRole("button", { name: "Repository", exact: true }).click();
  await page.reload();
  await page
    .getByRole("heading", { name: "Repository", exact: true })
    .waitFor();
  await nav.getByRole("button", { name: "Integrations", exact: true }).click();
};
