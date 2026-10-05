import { z } from "zod";
import { id } from "./contracts.ts";
import { placeRecordKinds } from "../../shared/places.ts";

export const PlaceContentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.string().trim().min(1).max(60),
    organization: z.enum(["manual", "assisted"]),
    groupings: z
      .array(z.enum(placeRecordKinds))
      .min(1)
      .max(4)
      .refine(
        (kinds) => new Set(kinds).size === kinds.length,
        "Groupings must be unique",
      )
      .optional(),
    memberIds: z
      .array(id)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Records must be unique",
      ),
    pinnedIds: z
      .array(id)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Pins must be unique"),
  })
  .strict()
  .refine(
    (p) => p.pinnedIds.every((id) => p.memberIds.includes(id)),
    "Pinned records must belong to the place",
  );

export const PlaceSchema = PlaceContentSchema.safeExtend({
  schemaVersion: z.literal(1),
  id,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
