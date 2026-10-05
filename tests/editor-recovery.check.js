// Run with playwright-cli in an authenticated disposable workspace.
async (page) => {
  const title = "Editor recovery QA " + Date.now();
  const content =
    "## Company calendar\n\nKeep this draft through editor recovery.";
  const moduleRoute =
    /\/(?:src\/RichTextEditor\.tsx|assets\/RichTextEditor-[^/]+\.js)(?:\?|$)/;
  // A rejected dynamic import used to unmount the entire React workspace.
  await page.route(moduleRoute, (route) => route.abort("failed"));
  await page.reload();
  await page.getByRole("button", { name: /New page/ }).click();
  await page.getByText(/Titan couldn’t open the editor/).waitFor();
  await page.getByRole("navigation", { name: "Browse workspace" }).waitFor();
  await page.getByLabel("Page title", { exact: true }).fill(title);
  const editor = page.getByRole("textbox", {
    name: "Page content",
    exact: true,
  });
  await editor.fill(content);

  // Failed saves must keep the page and its current edits mounted.
  const saveRoute = /\/api\/v1\/composer-drafts\/[^/]+$/;
  await page.route(saveRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Recovery QA save unavailable" }),
    }),
  );
  await page
    .getByRole("button", { name: "Save and reload", exact: true })
    .click();
  await page
    .getByText("Recovery QA save unavailable", { exact: true })
    .waitFor();
  if ((await editor.inputValue()) !== content)
    throw new Error("A failed recovery save lost the draft");
  await page.unroute(saveRoute);
  await page.unroute(moduleRoute);
  await page
    .getByRole("button", { name: "Save and reload", exact: true })
    .click();
  await page.locator(".draft-row").filter({ hasText: title }).click();
  await page.locator("#page-body[contenteditable=true]").waitFor();
  await page
    .getByRole("heading", { name: "Company calendar", level: 2 })
    .waitFor();
  if (!(await editor.textContent()).includes("Keep this draft"))
    throw new Error("Recovery lost the saved body");
  if (
    (await page.getByLabel("Page title", { exact: true }).inputValue()) !==
    title
  )
    throw new Error("Recovery lost the saved title");
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
};
