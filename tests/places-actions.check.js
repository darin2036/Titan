// Run with playwright-cli run-code in an authenticated workspace.
async (page) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const trigger = page.getByRole("button", {
    name: "Places actions",
    exact: true,
  });
  const menu = page.getByRole("group", { name: "Places actions", exact: true });
  await trigger.click();
  const grouping = menu.getByRole("button", {
    name: "Auto Group Places",
    exact: true,
  });
  const original = await grouping.getAttribute("aria-pressed");
  await menu
    .getByRole("button", { name: "Create new place", exact: true })
    .click();
  await page.getByRole("dialog", { name: "New place", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await trigger.click();
  await menu.getByRole("button", { name: "Find Place", exact: true }).click();
  const finder = page.getByRole("dialog", { name: "Find Place", exact: true });
  await finder
    .getByRole("searchbox", { name: "Search places" })
    .fill("unmatched-place-qa-319837");
  await finder.getByRole("status").waitFor();
  await finder.getByRole("button", { name: "Close", exact: true }).click();
  await trigger.click();
  await grouping.click();
  await trigger.click();
  if ((await grouping.getAttribute("aria-pressed")) === original)
    throw new Error("Grouping did not toggle");
  await grouping.click();
  for (const [width, height] of [
    [1024, 300],
    [390, 600],
    [320, 400],
  ]) {
    await page.setViewportSize({ width, height });
    if (width <= 760 && (await trigger.isHidden()))
      await page
        .getByRole("button", { name: "Navigation", exact: true })
        .click();
    await trigger.click();
    const bounds = await menu.boundingBox();
    if (
      !bounds ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > width ||
      bounds.y + bounds.height > height
    )
      throw new Error("Places menu exceeds viewport");
    const types = await menu.locator("button").evaluateAll((items) =>
      items.map((item) => {
        const s = getComputedStyle(item);
        return [s.fontSize, s.lineHeight, s.fontWeight].join("/");
      }),
    );
    if (types.some((type) => type !== "14px/21px/500"))
      throw new Error("Inconsistent menu typography");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};
