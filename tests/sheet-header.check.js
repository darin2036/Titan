// Run: playwright-cli run-code "$(sed '$s/;$//' tests/sheet-header.check.js)"
// Requires an authenticated disposable workspace. Publishes and removes its QA page.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  const title = "Clean document sheet QA " + Date.now();
  await page.getByRole("button", { name: /New page/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Page content",
    exact: true,
  });
  await editor.waitFor();
  const header = page.locator(".topbar");
  await page.getByLabel("Page actions", { exact: true }).click();
  await page.getByText("Templates", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  if (
    await page
      .getByRole("button", { name: /New page|Draft with agent/ })
      .count()
  )
    fail("Creation actions remain while writing");
  if (await page.locator(".page-heading, .document-toolbar").count())
    fail("Extra header row remains");
  if (await page.locator(".page-composer .composer-actions").count())
    fail("Draft actions still interrupt the canvas");
  if (
    await header
      .getByRole("button", { name: "Publish page", exact: true })
      .isEnabled()
  )
    fail("Empty page can publish");
  for (const [width, height] of [
    [1440, 1000],
    [1024, 900],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    const positions = await header
      .locator("button:visible, summary:visible")
      .evaluateAll((elements) =>
        elements.map((el) => el.getBoundingClientRect().top),
      );
    if (Math.max(...positions) - Math.min(...positions) > 5)
      fail("Actions span several lines at " + width);
    const headerBox = await header.boundingBox();
    const titleBox = await page.locator("#page-title").boundingBox();
    if (
      !headerBox ||
      headerBox.height > 60 ||
      !titleBox ||
      titleBox.y - headerBox.y - headerBox.height > 35
    )
      fail("Too much space before the title at " + width);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      fail("Page overflows at " + width);
    await page.getByLabel("Page actions", { exact: true }).click();
    await page
      .getByRole("button", { name: "Discard draft", exact: true })
      .waitFor();
    const menuBox = await page.locator(".page-action-options").boundingBox();
    if (!menuBox || menuBox.x < 0 || menuBox.x + menuBox.width > width)
      fail("Overflow menu escapes the viewport");
    const sizes = await header
      .locator("button:visible, summary:visible")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const s = getComputedStyle(el);
          return [s.fontSize, s.lineHeight, s.fontWeight].join("/");
        }),
      );
    if (sizes.some((value) => value !== "14px/21px/500"))
      fail("Header control typography differs at " + width);
    await page.screenshot({
      path: "output/playwright/titan-sheet-header-" + width + ".png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    if (
      await page
        .getByRole("button", { name: "Discard draft", exact: true })
        .isVisible()
    )
      fail("Escape did not close the menu");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .fill(title);
  await editor.pressSequentially("Dates and guidance for the whole team.");
  // Close immediately, before the debounce, to verify the portaled action flushes edits.
  await header
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  await page.reload();
  await page.locator(".draft-row").filter({ hasText: title }).click();
  if (!(await editor.textContent()).includes("Dates and guidance"))
    fail("Close lost the draft content");
  await header
    .getByRole("button", { name: "Publish page", exact: true })
    .click();
  await page
    .getByRole("heading", { name: title, level: 1, exact: true })
    .waitFor();
  await header
    .getByRole("button", { name: "Edit page", exact: true })
    .waitFor();
  if (
    await header
      .getByRole("button", { name: /Publish|Save and close|New page/ })
      .count()
  )
    fail("Writing actions remain while reading");
  await header.getByRole("button", { name: "Edit page", exact: true }).click();
  await header
    .getByRole("button", { name: "Publish changes", exact: true })
    .waitFor();
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Compare latest page", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  await page.evaluate(async (title) => {
    const unit = (await (await fetch("/api/v1/units")).json()).find(
      (unit) => unit.title === title,
    );
    const response = await fetch("/api/v1/units/" + unit.id + "/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        justification: "Remove disposable sheet header QA page",
      }),
    });
    if (!response.ok) throw new Error("Could not remove QA page");
  }, title);
};
