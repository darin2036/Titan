// Run: playwright-cli run-code "$(sed '$s/;$//' tests/record-header.check.js)"
// Requires an authenticated disposable workspace. Publishes and removes its QA page.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  const title = "Document header QA " + Date.now();
  await page.getByRole("button", { name: /New page/ }).click();
  if (await page.locator("main h1").count())
    fail("Category headline remains above the composer");
  const titleInput = page.getByRole("textbox", {
    name: "Page title",
    exact: true,
  });
  await titleInput.fill(title);
  const draftMetadata = page.getByLabel("Draft metadata");
  if (!(await draftMetadata.textContent()).includes("Unpublished"))
    fail("Draft implies published validity");
  await titleInput.press("Enter");
  await page
    .getByRole("textbox", { name: "Page content", exact: true })
    .pressSequentially("Company dates and shared guidance.");
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  await page
    .getByRole("heading", { name: title, exact: true, level: 1 })
    .waitFor();
  if ((await page.locator("main h1").count()) !== 1)
    fail("Document does not have one primary heading");
  const metadata = page.getByLabel("Record metadata");
  await metadata.filter({ hasText: "Updated by Owner" }).waitFor();
  if (!(await metadata.textContent()).includes("Knowledge"))
    fail("Record signals are missing");
  if (!(await metadata.locator("time").getAttribute("datetime")))
    fail("Update time has no machine-readable value");
  if (await page.locator(".document-toolbar .revision").count())
    fail("Technical revision clutters the page header");
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
      fail("Header overflows at " + width);
    if (
      (await metadata.evaluate((el) => getComputedStyle(el).fontSize)) !==
      "12px"
    )
      fail("Metadata typography differs at " + width);
    await page.screenshot({
      path: "output/playwright/titan-record-header-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const updated = await page.evaluate(async (title) => {
    const unit = (await (await fetch("/api/v1/units")).json()).find(
      (unit) => unit.title === title,
    );
    const response = await fetch("/api/v1/units/" + unit.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        patch: { validity: "disputed" },
      }),
    });
    if (!response.ok) throw new Error("Could not update QA record signals");
    return await response.json();
  }, title);
  await page.reload();
  await page.locator(".record-card").filter({ hasText: title }).click();
  await page
    .getByRole("heading", { name: title, exact: true, level: 1 })
    .waitFor();
  await metadata.filter({ hasText: "Knowledge" }).waitFor();
  await page
    .locator(".record-reliability summary")
    .filter({ hasText: "Disputed" })
    .waitFor();
  await metadata.filter({ hasText: "Updated by Owner" }).waitFor();
  await page.getByText("Record details", { exact: true }).click();
  await page.locator(".record-details .revision").waitFor();
  await page.evaluate(async (unit) => {
    const response = await fetch("/api/v1/units/" + unit.id + "/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        justification: "Remove disposable document header QA page",
      }),
    });
    if (!response.ok) throw new Error("Could not remove QA page");
  }, updated);
};
