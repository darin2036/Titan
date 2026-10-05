// Run: playwright-cli run-code "$(sed '$s/;$//' tests/composer-ui.check.js)"
// Requires an authenticated disposable workspace; creates one page and removes it.
async (page) => {
  const fail = (message) => {
    throw new Error(message);
  };
  const title = "Composer QA company calendar " + Date.now();
  const original =
    "## Office closures\n\n| Date | Event |\n| --- | --- |\n| 2027-01-01 | Office closed |\n\nThe office closes at noon.\n";
  if (!(await page.getByRole("button", { name: /New page/ }).isVisible()))
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: /New page/ }).click();
  await page.getByLabel("Page actions", { exact: true }).click();
  await page.getByText("Templates", { exact: true }).click();
  await page
    .getByRole("button", { name: "Company calendar", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .fill(title);
  await page.getByText("Page details", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Applies to", exact: false })
    .fill("US employees, operations");
  async function pasteMarkdown(text) {
    const field = page.getByRole("textbox", {
      name: "Page content",
      exact: true,
    });
    const mod = await page.evaluate(() =>
      /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
    );
    await field.click();
    await field.press(mod + "+a");
    await field.press("Backspace");
    await page.waitForFunction(
      () => !document.querySelector(".rich-editor")?.editor?.getText().trim(),
    );
    await field.pressSequentially("~ Text");
    await field.press("Enter");
    await field.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  }
  await pasteMarkdown(original);
  await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
  const expectedBody = await page.evaluate(
    async (title) =>
      (await (await fetch("/api/v1/composer-drafts")).json()).find(
        (draft) => draft.title === title,
      ).body,
    title,
  );
  if (await page.locator(".record-card").filter({ hasText: title }).count())
    fail("Unpublished draft entered the record list");
  if ((await page.locator(".rich-editor table").count()) !== 1)
    fail("Calendar table did not render in the editor");
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
    const controls = await page
      .locator(".editor-toolbar button, .composer-actions button, .draft-row")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const style = getComputedStyle(el);
          return [style.fontSize, style.lineHeight, style.fontWeight].join("/");
        }),
      );
    if (controls.some((value) => value !== "14px/21px/500"))
      fail("Composer controls have inconsistent typography at " + width);
    await page.screenshot({
      path: "output/playwright/titan-composer-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  await page.reload();
  await page
    .getByRole("button", { name: title + " Unpublished", exact: true })
    .click();
  await page.locator(".rich-editor table").waitFor();
  if (
    !(
      await page
        .getByRole("textbox", { name: "Page content", exact: true })
        .textContent()
    ).includes("The office closes at noon.")
  )
    fail("Draft did not survive reload");
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  await page
    .getByRole("heading", { name: title, exact: true, level: 1 })
    .waitFor();
  if ((await page.locator(".document-panel table").count()) !== 1)
    fail("Published table did not render");
  const published = await page.evaluate(async (title) => {
    const response = await fetch("/api/v1/units");
    return (await response.json()).find((unit) => unit.title === title);
  }, title);
  if (published.body !== expectedBody)
    fail("Publishing changed the author's text");
  if (published.applicability.join(",") !== "US employees,operations")
    fail("Publishing lost applicability");
  if (
    published.validity !== "unverified" ||
    published.authority !== "hypothesis"
  )
    fail("Publishing elevated authority or validity");
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  const edited = original + "\nA human-authored update.\n";
  await pasteMarkdown(edited);
  // Simulate another writer changing the published revision while this draft is open.
  await page.evaluate(async (unit) => {
    const response = await fetch("/api/v1/units/" + unit.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        patch: { body: "Updated elsewhere" },
      }),
    });
    if (!response.ok) throw new Error("Could not prepare revision conflict");
  }, published);
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "This page changed" })
    .waitFor();
  if (
    !(
      await page
        .getByRole("textbox", { name: "Page content", exact: true })
        .textContent()
    ).includes("A human-authored update.")
  )
    fail("Revision conflict lost the draft");
  const editedBody = await page.evaluate(
    async (title) =>
      (await (await fetch("/api/v1/composer-drafts")).json()).find(
        (draft) => draft.title === title,
      ).body,
    title,
  );
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Compare latest page", exact: true })
    .click();
  await page
    .locator(".document-panel article")
    .getByText("Updated elsewhere", { exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Continue with my draft against this version",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page
    .getByRole("heading", { name: title, exact: true, level: 1 })
    .waitFor();
  const revised = await page.evaluate(
    async (id) => await (await fetch("/api/v1/units/" + id)).json(),
    published.id,
  );
  if (revised.id !== published.id || revised.body !== editedBody)
    fail("Editing did not preserve identity and exact content");
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Page content", exact: true })
    .fill("Discard these changes");
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await page
    .getByRole("heading", { name: title, exact: true, level: 1 })
    .waitFor();
  const retained = await page.evaluate(
    async (id) => await (await fetch("/api/v1/units/" + id)).json(),
    published.id,
  );
  if (retained.body !== editedBody)
    fail("Discarding a draft changed the published page");
  // Finish by exercising the API retention path and leaving no active QA page.
  await page.evaluate(async (unit) => {
    const response = await fetch("/api/v1/units/" + unit.id + "/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        justification: "Remove disposable composer QA page",
      }),
    });
    if (!response.ok) throw new Error("Could not remove QA page");
  }, retained);
};
