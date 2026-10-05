export const placeRecordKinds = [
  "knowledge",
  "work",
  "decision",
  "evidence",
] as const;
export type PlaceRecordKind = (typeof placeRecordKinds)[number];
export function placeGroupings(place: {
  type: string;
  groupings?: PlaceRecordKind[];
}): readonly string[] {
  return ["Project", "Team", "Initiative"].includes(place.type)
    ? placeRecordKinds
    : (place.groupings ?? placeRecordKinds);
}
export type Place = {
  schemaVersion: 1;
  id: string;
  name: string;
  type: string;
  organization: "manual" | "assisted";
  groupings?: PlaceRecordKind[];
  memberIds: string[];
  pinnedIds: string[];
  createdAt: string;
  updatedAt: string;
};
export type PlaceSuggestion = {
  recordId: string;
  connections: {
    id: string;
    anchorId: string;
    type: string;
    justification: string;
    evidence: string[];
  }[];
};
export type PlaceView = Place & {
  revision: string;
  suggestions: PlaceSuggestion[];
};
