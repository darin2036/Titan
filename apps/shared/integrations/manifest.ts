import { z } from "zod";
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/);
const field = z
  .object({
    key,
    label: z.string().min(1),
    type: z.enum(["text", "boolean", "select", "multiselect"]),
    valueType: z.enum(["string", "number"]).default("string"),
    default: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
    ]),
    initialPath: z.string().optional(),
    required: z.boolean().default(false),
    advanced: z.boolean().default(false),
    description: z.string().optional(),
    options: z
      .array(
        z.object({
          value: z.union([z.string(), z.number()]),
          label: z.string(),
        }),
      )
      .optional(),
    source: z
      .object({
        path: z.string().regex(/^\/[a-z-]+$/),
        dependsOn: key.optional(),
        queryParameter: key.optional(),
        empty: z.string(),
      })
      .optional(),
    requiredScope: z.object({ field: key, scope: z.string() }).optional(),
  })
  .strict();
export const IntegrationManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.string(),
    version: z.string(),
    capabilities: z.array(z.string()),
    auth: z
      .object({
        type: z.literal("oauth2"),
        label: z.string(),
        options: z.array(field),
        setup: z.string(),
        details: z.string(),
      })
      .strict(),
    configuration: z
      .object({
        fields: z.array(field),
        saveLabel: z.string(),
        savedMessage: z.string(),
        description: z.string().optional(),
      })
      .strict(),
    actions: z
      .object({ sync: z.boolean(), disconnectMessage: z.string() })
      .strict(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const fields of [
      manifest.auth.options,
      manifest.configuration.fields,
    ]) {
      const keys = fields.map((f) => f.key);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: "custom",
          message: "Configuration field keys must be unique",
        });
      for (const f of fields) {
        if (
          f.source?.dependsOn &&
          (!keys.includes(f.source.dependsOn) || f.source.dependsOn === f.key)
        )
          ctx.addIssue({
            code: "custom",
            message: "Choice dependencies must reference another field",
          });
        if (f.source?.dependsOn && !f.source.queryParameter)
          ctx.addIssue({
            code: "custom",
            message: "Dependent choices need a query parameter",
          });
        if (f.type === "select" && !f.options && !f.source)
          ctx.addIssue({
            code: "custom",
            message: "Select fields need choices",
          });
      }
    }
  });
export type IntegrationManifest = z.infer<typeof IntegrationManifestSchema>;
export type IntegrationField =
  IntegrationManifest["configuration"]["fields"][number];
export type IntegrationValues = Record<
  string,
  string | number | boolean | string[]
>;
export function configurationSchema(fields: IntegrationField[]) {
  return z
    .object(
      Object.fromEntries(
        fields.map((f) => {
          let schema: z.ZodType =
            f.type === "boolean"
              ? z.boolean()
              : f.type === "multiselect"
                ? f.required
                  ? z.array(z.string().min(1)).min(1)
                  : z.array(z.string().min(1))
                : f.valueType === "number"
                  ? z.number().finite()
                  : f.required
                    ? z.string().min(1)
                    : z.string();
          if (f.options)
            schema = schema.refine(
              (value) =>
                Array.isArray(value)
                  ? value.every((item) =>
                      f.options!.some((option) => option.value === item),
                    )
                  : f.options!.some((option) => option.value === value),
              "Choose an available option",
            );
          return [f.key, f.required ? schema : schema.default(f.default)];
        }),
      ),
    )
    .strict();
}
export function initialValues(
  fields: IntegrationField[],
  status: Record<string, any>,
): IntegrationValues {
  return Object.fromEntries(
    fields.map((f) => [
      f.key,
      (f.initialPath ?? f.key)
        .split(".")
        .reduce<any>((value, key) => value?.[key], status) ?? f.default,
    ]),
  );
}
