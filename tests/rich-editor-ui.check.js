// Run: playwright-cli run-code "$(sed '$s/;$//' tests/rich-editor-ui.check.js)"
// Requires an authenticated disposable workspace. Publishes and removes a QA page.
async (page) => {
  const title = "Rich editor QA " + Date.now();
  const mod = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.getByRole("button", { name: /New page/ }).click();
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .fill(title);
  const editor = page.getByRole("textbox", {
    name: "Page content",
    exact: true,
  });
  async function setText(text) {
    await editor.click();
    await editor.press(mod + "+a");
    await editor.press("Backspace");
    await page.waitForFunction(
      () => !document.querySelector(".rich-editor")?.editor?.getText().trim(),
    );
    if (text) await editor.pressSequentially(text);
  }

  await setText("");
  await editor.pressSequentially("~ Text");
  await editor.press("Enter");
  await editor.pressSequentially("## Company calendar");
  await page
    .locator(".rich-editor h2")
    .filter({ hasText: "Company calendar" })
    .waitFor();
  await editor.press("Enter");
  await editor.pressSequentially(
    "**Bold text** *Italic text* ~~Old date~~ `inline code` ",
  );
  for (const [selector, text] of [
    ["strong", "Bold text"],
    ["em", "Italic text"],
    ["s", "Old date"],
    ["code", "inline code"],
  ]) {
    await page
      .locator(".rich-editor " + selector)
      .filter({ hasText: text })
      .waitFor();
  }
  // Test the platform's keyboard shortcuts on a selection, including combined marks.
  await setText("Selected text");
  await editor.press(mod + "+a");
  for (const [key, selector, label] of [
    ["b", "strong", "Bold"],
    ["i", "em", "Italic"],
    ["u", "u", "Underline"],
    ["Shift+x", "s", "Strikethrough"],
  ]) {
    await editor.press(mod + "+" + key);
    await page
      .locator(".rich-editor " + selector)
      .filter({ hasText: "Selected text" })
      .waitFor();
    if (
      (await page
        .getByRole("button", { name: label, exact: true })
        .getAttribute("aria-pressed")) !== "true"
    )
      throw new Error("Toolbar did not reflect " + label);
  }
  const formatted = await editor.innerHTML();
  await editor.press(mod + "+z");
  if ((await editor.innerHTML()) === formatted)
    throw new Error("Undo did not change formatting");
  await editor.press(mod + "+Shift+z");
  if ((await editor.innerHTML()) !== formatted)
    throw new Error("Redo did not restore formatting");
  await editor.press(mod + "+k");
  await page
    .getByRole("textbox", { name: "Link address", exact: true })
    .fill("https://example.com/hr");
  await page
    .getByRole("textbox", { name: "Link address", exact: true })
    .press("Enter");
  await page.locator('.rich-editor a[href="https://example.com/hr"]').waitFor();
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: title + " Unpublished", exact: true })
    .click();
  for (const selector of ["strong", "em", "u", "s"])
    await page
      .locator(".rich-editor " + selector)
      .filter({ hasText: "Selected text" })
      .waitFor();
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  await page
    .getByRole("heading", { name: title, level: 1, exact: true })
    .waitFor();
  for (const selector of ["strong", "em", "u", "del"])
    await page
      .locator(".document-panel article " + selector)
      .filter({ hasText: "Selected text" })
      .waitFor();
  const published = await page.evaluate(
    async (title) =>
      (await (await fetch("/api/v1/units")).json()).find(
        (unit) => unit.title === title,
      ),
    title,
  );
  if (
    !published.body.includes("<u>") ||
    !published.body.includes("https://example.com/hr")
  )
    throw new Error("Published Markdown lost underline or the link");
  await page.evaluate(async (unit) => {
    const response = await fetch("/api/v1/units/" + unit.id + "/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: unit.revision,
        justification: "Remove disposable rich editor QA page",
      }),
    });
    if (!response.ok) throw new Error("Could not remove QA page");
  }, published);
  // Block shortcuts and table editing on a private draft.
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: /New page/ }).click();
  await setText("");
  await editor.pressSequentially("~ Text");
  await editor.press("Enter");
  await editor.pressSequentially("- List item");
  await page
    .locator(".rich-editor ul li")
    .filter({ hasText: "List item" })
    .waitFor();
  await setText("");
  await editor.pressSequentially("~ Text");
  await editor.press("Enter");
  await editor.pressSequentially("1. First item");
  await page
    .locator(".rich-editor ol li")
    .filter({ hasText: "First item" })
    .waitFor();
  await setText("");
  await editor.pressSequentially("~ Text");
  await editor.press("Enter");
  await editor.pressSequentially("> Quoted note");
  await page
    .locator(".rich-editor blockquote")
    .filter({ hasText: "Quoted note" })
    .waitFor();
  await setText("Heading by shortcut");
  await editor.press(mod + "+Alt+2");
  await page
    .locator(".rich-editor h2")
    .filter({ hasText: "Heading by shortcut" })
    .waitFor();
  await setText("Code shortcut");
  await editor.press(mod + "+a");
  await editor.press(mod + "+e");
  await page
    .locator(".rich-editor code")
    .filter({ hasText: "Code shortcut" })
    .waitFor();
  await setText("");
  await editor.pressSequentially("~ Text");
  await editor.press("Enter");
  await editor.pressSequentially("~ Table");
  await editor.press("Enter");
  await page.locator(".rich-editor table").waitFor();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  if ((await page.locator(".rich-editor table tr").count()) !== 4)
    throw new Error("Table row insertion failed");
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  if (
    (await page
      .locator(".rich-editor table tr")
      .first()
      .locator("th,td")
      .count()) !== 4
  )
    throw new Error("Table column insertion failed");
  await page.getByLabel("Page actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await page.locator(".page-composer").waitFor({ state: "hidden" });
};
