// Run: playwright-cli run-code "$(sed '$s/;$//' tests/agent-viewport.check.js)"
// Requires an authenticated Titan workspace. Does not change any records.
async (page) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("navigation", { name: "Browse workspace", exact: true })
    .getByRole("button", { name: "⌕ All records", exact: true })
    .click();
  const navigationWidth = await page
    .getByRole("separator", { name: "Navigation width" })
    .getAttribute("aria-valuenow");
  await page.getByRole("separator", { name: "Navigation width" }).focus();
  await page.keyboard.press("End");
  const launcher = page.locator(".agent-launcher");
  await launcher.waitFor();
  if (
    !(await page
      .locator(".floating-agent")
      .evaluate((el) => el.parentElement === document.body))
  )
    throw new Error("Agent is still inside the document layout");
  async function check(open) {
    await page.waitForFunction((open) => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth,
        height = viewport?.height ?? innerHeight;
      const elements = [
        document.querySelector(".agent-launcher"),
        ...(open ? [document.querySelector("#workspace-agent")] : []),
      ];
      return elements.every((element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= left + 11 &&
          rect.top >= top + 11 &&
          rect.right <= left + width - 11 &&
          rect.bottom <= top + height - 11
        );
      });
    }, open);
  }
  for (const [width, height] of [
    [1440, 1000],
    [1024, 900],
    [800, 600],
    [761, 400],
    [760, 500],
    [390, 844],
    [320, 300],
    [240, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      document.querySelector("main").style.transform = "";
      window.scrollTo(0, 0);
    });
    await check(false);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      actions: [...document.querySelectorAll(".page-heading button")].every(
        (button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight
          );
        },
      ),
    }));
    if (layout.overflow || !layout.actions)
      throw new Error(
        "Workspace actions overflow at " + width + " × " + height,
      );
    await page.evaluate(() => {
      document.querySelector("main").style.transform = "translateZ(0)";
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await check(false);
    await launcher.click();
    await page.locator("#workspace-agent").waitFor({ state: "visible" });
    await check(true);
    await page
      .getByRole("button", { name: "Minimize agent", exact: true })
      .click();
    await check(false);
    await launcher.focus();
    for (let i = 0; i < 8; i++) await launcher.press("ArrowDown");
    await check(false);
  }
  // A long place title must wrap without pushing the actions off the canvas.
  await page.setViewportSize({ width: 761, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".page-heading h1").evaluate((heading) => {
    heading.dataset.originalText = heading.textContent;
    heading.textContent =
      "A very long workspace title with an unbroken segment " +
      "Workspace".repeat(12);
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Long workspace title pushes actions outside the window");
  await page.locator(".page-heading h1").evaluate((heading) => {
    heading.textContent = heading.dataset.originalText;
    delete heading.dataset.originalText;
  });
  // Existing drafts can be opened without changing their contents.
  const savedDraft = page
    .getByRole("navigation", { name: "Your drafts", exact: true })
    .getByRole("button")
    .first();
  if (await savedDraft.count()) {
    await savedDraft.click();
    await page.locator(".page-composer").waitFor();
    for (const width of [761, 390, 320]) {
      await page.setViewportSize({ width, height: 600 });
      await check(false);
      await launcher.click();
      await check(true);
      await page
        .getByRole("button", { name: "Minimize agent", exact: true })
        .click();
    }
    await page.setViewportSize({ width: 761, height: 900 });
    await page
      .getByRole("navigation", { name: "Browse workspace", exact: true })
      .getByRole("button", { name: "⌕ All records", exact: true })
      .click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Simulate the visual viewport shrinking and moving while the layout viewport
  // stays the same, as with a keyboard or zoomed browser surface.
  await page.evaluate(() => {
    window.__originalViewport = window.visualViewport;
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: 300,
      height: 240,
      offsetLeft: 40,
      offsetTop: 200,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    window.dispatchEvent(new Event("resize"));
  });
  await check(false);
  await launcher.click();
  await check(true);
  await page.evaluate(() => {
    Object.assign(window.visualViewport, { height: 300, offsetTop: 140 });
    window.visualViewport.dispatchEvent(new Event("scroll"));
  });
  await check(true);
  await page
    .getByRole("button", { name: "Minimize agent", exact: true })
    .click();
  await page.evaluate(() => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: window.__originalViewport,
    });
    delete window.__originalViewport;
    document.querySelector("main").style.transform = "";
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("resize"));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check(false);
  await page.evaluate((width) => {
    localStorage.setItem("titan:sidebar-width", width);
  }, navigationWidth);
  await page.reload();
};
