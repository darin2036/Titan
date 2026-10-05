// Run through playwright-cli run-code --filename tests/ui-design.check.js.
// Requires an authenticated local demo session with at least one knowledge record.
// Prepares and discards a draft without applying changes.
// Create output/playwright before running; screenshots are saved there.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  await page.getByRole("button", { name: /◈ Knowledge/ }).click();
  await page.locator(".record-card").first().click();
  await page.getByText("Record details", { exact: true }).click();
  const details = page.locator(".record-details");
  if (!(await details.evaluate((el) => el.open)))
    fail("Record details did not expand");
  await page.getByText("Record details", { exact: true }).click();
  await page.getByRole("button", { name: "Open agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Minimize agent", exact: true })
    .click();
  if (await page.locator("#workspace-agent").isVisible())
    fail("Agent did not hide");
  await page.getByRole("button", { name: /New record/ }).click();
  if (!(await page.locator("#workspace-agent").isVisible()))
    fail("New record did not reopen agent");
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelector(".composer textarea"),
  );
  await page
    .getByRole("textbox", { name: "Message the workspace agent" })
    .fill("An approachable home for team ideas");
  await page.getByRole("button", { name: "Prepare agent draft" }).click();
  await page.getByRole("button", { name: "Apply change" }).waitFor();
  const controls = await page
    .locator(".preview .button-row button")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const style = getComputedStyle(el);
        return [style.fontSize, style.lineHeight, style.fontWeight].join("/");
      }),
    );
  if (
    controls.length !== 2 ||
    controls.some((value) => value !== "14px/21px/500")
  )
    fail("Draft actions have inconsistent typography");
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
      fail("Horizontal page overflow at " + width);
    const panel = await page.locator("#workspace-agent").boundingBox();
    if (
      !panel ||
      panel.x < 0 ||
      panel.y < 0 ||
      panel.x + panel.width > width ||
      panel.y + panel.height > height
    )
      fail("Floating panel escaped viewport at " + width);
    const sizes = await page
      .locator(
        ".nav, .agent-toggle, .agent-minimize, .preview .button-row button, .composer textarea",
      )
      .evaluateAll((elements) =>
        elements.map((el) => getComputedStyle(el).fontSize),
      );
    if (sizes.some((size) => size !== "14px"))
      fail("Control typography changes at " + width);
    if (
      !(await page
        .getByRole("button", { name: "⚙ Settings", exact: true })
        .isVisible())
    )
      fail("Settings missing at " + width);
    await page.screenshot({
      path: "output/playwright/titan-draft-" + width + ".png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
};
