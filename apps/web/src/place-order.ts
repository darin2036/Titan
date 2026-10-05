export function placeGroup(place: { type: string }) {
  return ["Project", "Initiative"].includes(place.type) ? 1 : 0;
}

export function orderPlaces<T extends { id: string; type: string }>(
  places: T[],
  order: string[],
  autoGroup: boolean,
): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...places].sort(
    (a, b) =>
      (autoGroup ? placeGroup(a) - placeGroup(b) : 0) ||
      (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length),
  );
}
