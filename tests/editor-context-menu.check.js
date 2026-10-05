// Run: playwright-cli run-code "$(sed '$s/;$//' tests/editor-context-menu.check.js)"
// Requires an authenticated disposable workspace; discards a draft and removes its published QA page.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  await page.getByRole("button", { name: /New page/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Page content",
    exact: true,
  });
  await editor.waitFor();
  if (await page.getByRole("toolbar", { name: "Text formatting" }).count())
    fail("Formatting is visible before selection");
  if (await page.getByRole("textbox", { name: /Applies to/ }).isVisible())
    fail("Optional metadata interrupts the canvas");
  if (await page.locator(".record-browser").isVisible())
    fail("Record browser constrains the writing canvas");
  const mod = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await editor.click();
  await editor.pressSequentially("~ ");
  const menu = page.getByRole("listbox", { name: "Text style" });
  await menu.waitFor();
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Enter");
  await editor.pressSequentially("A heading chosen with the keyboard");
  await page
    .locator(".rich-editor h2")
    .filter({ hasText: "A heading chosen with the keyboard" })
    .waitFor();
  if ((await editor.textContent()).includes("~ "))
    fail("Applied command leaked into content");
  await editor.press("Enter");
  await editor.pressSequentially("~ bullet");
  if ((await menu.getByRole("option").count()) !== 1)
    fail("Style filtering failed");
  await editor.press("Enter");
  await editor.pressSequentially("A list item");
  await page
    .locator(".rich-editor ul li")
    .filter({ hasText: "A list item" })
    .waitFor();
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("~ ");
  await menu.waitFor();
  await editor.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await editor.pressSequentially("Leave this literal");
  if (await menu.count()) fail("Dismissed command reopened while typing");
  await editor.press(mod + "+a");
  await page.getByRole("toolbar", { name: "Text formatting" }).waitFor();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.locator(".rich-editor strong").first().waitFor();
  if (!(await editor.textContent()).includes("A list item"))
    fail("Selection formatting lost content");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await editor.click();
    await editor.press(mod + "+End");
    await editor.press("Enter");
    await editor.pressSequentially("~ ");
    await menu.waitFor();
    for (let i = 0; i < 13; i++) await editor.press("ArrowDown");
    await menu.waitFor();
    const box = await page.locator(".editor-command-menu").boundingBox();
    if (
      !box ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > width ||
      box.y + box.height > height
    )
      fail("Style menu escaped viewport at " + width);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      fail("Page overflow at " + width);
    const type = await menu
      .getByRole("option")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.lineHeight, s.fontWeight].join("/");
      });
    if (type !== "14px/21px/500")
      fail("Popover typography differs from controls");
    await page.screenshot({
      path: "output/playwright/titan-context-editor-" + width + ".png",
      fullPage: true,
    });
    await editor.press("Escape");
    await editor.press("Backspace");
    await editor.press("Backspace");
  }
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  // An inline title is optional; publishing supplies the familiar Untitled name.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /New page/ }).click();
  const body = "Untitled publication QA " + Date.now();
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .press("Enter");
  if (!(await editor.evaluate((el) => el === document.activeElement)))
    fail("Enter from title did not focus the canvas");
  await editor.pressSequentially(body);
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  await page
    .getByRole("heading", { name: "Untitled", level: 1, exact: true })
    .waitFor();
  await page.evaluate(async (body) => {
    const units = await (await fetch("/api/v1/units")).json();
    const unit = units.find(
      (unit) => unit.title === "Untitled" && unit.body.includes(body),
    );
    if (!unit) throw new Error("Optional title publishing failed");
    const response = await fetch("/api/v1/units/" + unit.id + "/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        justification: "Remove disposable untitled QA page",
      }),
    });
    if (!response.ok) throw new Error("Could not remove untitled QA page");
  }, body);
};
