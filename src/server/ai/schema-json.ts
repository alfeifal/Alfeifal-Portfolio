import { z, type ZodType } from "zod";

/** Zod 4 ships a JSON Schema converter; we strip `$schema` and make it Anthropic-friendly. */
export function toInputSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  if (js.type !== "object") return { type: "object", properties: { value: js }, required: ["value"] };
  return js;
}
