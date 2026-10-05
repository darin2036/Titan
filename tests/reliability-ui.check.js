// Run with playwright-cli run-code after opening a record in an authenticated workspace.
async (page) => {
  const panel = page.locator(".record-management");
  const summary = page.getByRole("button", { name: /Record management/ });
  await summary.waitFor();
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Reliability basis").waitFor();
  if (!(await panel.textContent()).includes("Basis for revision"))
    throw new Error("Assessment is missing its revision binding");
  if (!(await panel.textContent()).includes("Record details"))
    throw new Error("Recorded validity is missing from the basis");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Reliability basis overflows at " + width);
    if (
      (await summary.evaluate((el) => getComputedStyle(el).fontSize)) !== "14px"
    )
      throw new Error("Reliability control typography differs at " + width);
    if (
      (await page
        .getByLabel("Record metadata")
        .evaluate((el) => getComputedStyle(el).fontSize)) !== "12px"
    )
      throw new Error("Metadata typography differs at " + width);
    await page.screenshot({
      path: "output/playwright/titan-reliability-" + width + ".png",
      fullPage: true,
    });
  }
  await page.keyboard.press("Escape");
  if (await panel.isVisible())
    throw new Error("Record management does not close with Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
};
