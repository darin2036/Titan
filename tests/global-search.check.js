// Run in an authenticated workspace: playwright-cli run-code "$(sed '$s/;$//' tests/global-search.check.js)"
async (page) => {
  const scope = page.getByRole("combobox", { name: "Search scope" });
  const input = page.getByRole("textbox", {
    name: "Search knowledge and work",
  });
  await page.getByRole("button", { name: "All records", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Search scope"]').value ===
      "everywhere",
  );
  if ((await scope.inputValue()) !== "everywhere")
    throw new Error("Home search is scoped");
  const places = await page.evaluate(async () =>
    (await fetch("/api/v1/places")).json(),
  );
  if (!places.length)
    throw new Error("Prepare a place before running this check");
  const place = places[0];
  await page
    .getByRole("navigation", { name: "Places", exact: true })
    .getByRole("button", { name: place.name, exact: true })
    .click();
  await page.waitForFunction(
    (id) => document.querySelector('[aria-label="Search scope"]').value === id,
    place.id,
  );
  if ((await scope.inputValue()) !== place.id)
    throw new Error("Place search did not default to its place");
  await input.fill("identity");
  await input.press("Enter");
  await page
    .locator(".section-label")
    .filter({ hasText: "Search results" })
    .waitFor();
  const results = await page.evaluate(async () =>
    (
      await fetch("/api/v1/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "identity" }),
      })
    ).json(),
  );
  const active = results.filter((record) => record.lifecycle === "active");
  const count = async () =>
    Number(await page.locator(".section-label span").textContent());
  if (
    (await count()) !==
    active.filter((record) => place.memberIds.includes(record.id)).length
  )
    throw new Error("Place scope includes other records");
  await scope.selectOption("everywhere");
  await page.waitForFunction(
    (total) =>
      Number(document.querySelector(".section-label span")?.textContent) ===
      total,
    active.length,
  );
  if ((await count()) !== active.length)
    throw new Error("Everywhere still filters to the place");
  if ((await input.inputValue()) !== "identity")
    throw new Error("Scope change lost the query");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Header overflows at " + width);
    for (const control of [scope, input]) {
      if (
        (await control.evaluate((el) => getComputedStyle(el).fontSize)) !==
        "14px"
      )
        throw new Error("Search typography differs");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "All records", exact: true }).click();
};
