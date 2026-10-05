// Run with playwright-cli run-code. Requires the offline confluence-browser-fixture,
// authenticated, with its Confluence connection configured and this screen open.
async (page) => {
  const configuration = page.locator(".integration-configuration");
  await page
    .getByRole("heading", { name: "Confluence", exact: true })
    .waitFor();
  if (
    await page.getByRole("heading", { name: "Repository", exact: true }).count()
  )
    throw new Error("Configuration is not a dedicated screen");
  if (!page.url().endsWith("#settings/integrations/confluence"))
    throw new Error("Missing integration route");
  await page.reload();
  await page
    .getByRole("combobox", { name: "Confluence site", exact: true })
    .waitFor();
  if (
    (await page
      .getByRole("combobox", { name: "Confluence site", exact: true })
      .inputValue()) !== "cloud"
  )
    throw new Error("Saved configuration was not restored");
  await page
    .getByRole("checkbox", { name: "Team knowledge", exact: true })
    .waitFor();
  if (
    !(await page
      .getByRole("checkbox", { name: "Team knowledge", exact: true })
      .isChecked())
  )
    throw new Error("Saved spaces were not restored");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const controls = await configuration
      .locator("button, select, summary, .integration-check")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return {
            tag: node.tagName,
            size: style.fontSize,
            line: style.lineHeight,
          };
        }),
      );
    if (
      controls.some(
        (style) =>
          style.size !== "14px" ||
          (style.line !== "21px" &&
            !(style.tag === "SELECT" && style.line === "normal")),
      )
    )
      throw new Error(
        "Integration controls have inconsistent typography: " +
          JSON.stringify(controls),
      );
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Integration configuration overflows the viewport");
    await page.screenshot({
      path: `output/playwright/integration-configuration-${width}.png`,
    });
  }
  await page
    .getByRole("button", { name: "← All integrations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configure Confluence", exact: true })
    .waitFor();
  if (
    await page
      .getByRole("combobox", { name: "Confluence site", exact: true })
      .count()
  )
    throw new Error("Provider form leaked into the catalog");
  await page.goBack();
  await page
    .getByRole("heading", { name: "Confluence", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("group", { name: "Confirm disconnection", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Keep connection", exact: true })
    .click();
};
