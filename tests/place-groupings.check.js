// Uses an authenticated workspace. Opens and cancels a new place without saving.
async (page) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page
    .getByRole("button", { name: "Places actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create new place", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New place", exact: true });
  await dialog
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("custom");
  await dialog.getByLabel("Custom type", { exact: true }).fill("Information");
  const summary = dialog.locator(".place-groupings-select summary");
  await summary.click();
  const group = dialog.getByRole("group", {
    name: "Place groupings",
    exact: true,
  });
  for (const name of ["Work", "Decisions", "Evidence"])
    await group.getByRole("checkbox", { name, exact: true }).uncheck();
  if (
    !(await group
      .getByRole("checkbox", { name: "Knowledge", exact: true })
      .isDisabled())
  )
    throw new Error("Last grouping can be removed");
  if (
    (await dialog.locator("#place-groupings-value").textContent()) !==
    "Knowledge"
  )
    throw new Error("Summary does not match selection");
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    const box = await summary.boundingBox();
    if (!box || box.x < 0 || box.x + box.width > width)
      throw new Error("Groupings overflow");
    const type = await summary.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontSize, s.lineHeight, s.fontWeight].join("/");
    });
    if (type !== "14px/21px/500")
      throw new Error("Grouping typography differs");
  }
  await dialog
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("Team");
  if (await summary.count())
    throw new Error("Groupings shown on standard place");
  await dialog
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("custom");
  if (
    (await dialog.locator("#place-groupings-value").textContent()) !==
    "Knowledge"
  )
    throw new Error("Selection lost on type switch");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
};
