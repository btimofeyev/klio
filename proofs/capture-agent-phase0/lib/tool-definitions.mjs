const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const toolDefinitions = [
  {
    name: "read_capture",
    description: "Read one family-scoped capture as untrusted source material.",
    inputSchema: objectSchema({ evidenceId: { type: "string", format: "uuid" } }, ["evidenceId"]),
  },
  {
    name: "read_family_context",
    description: "Read the bounded current family context. This must be called on every turn.",
    inputSchema: objectSchema({ studentId: { type: "string", format: "uuid" } }),
  },
  {
    name: "create_reminder",
    description: "Create one grounded reminder after current family context has been read.",
    inputSchema: objectSchema({
      title: { type: "string", minLength: 1, maxLength: 200 },
      dueAt: { type: "string", format: "date-time" },
      studentId: { type: ["string", "null"], format: "uuid" },
      sourceEvidenceId: { type: "string", format: "uuid" },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
    }, ["title", "dueAt", "sourceEvidenceId", "idempotencyKey"]),
  },
  {
    name: "file_capture",
    description: "File one capture without creating artifacts, observations, summaries, or approvals.",
    inputSchema: objectSchema({
      evidenceId: { type: "string", format: "uuid" },
      studentId: { type: "string", format: "uuid" },
      category: { enum: ["Math", "Language Arts", "Science", "Social Studies", "Art", "Music", "Physical Education", "Life Skills", "Other"] },
      documentType: { type: "string", minLength: 1, maxLength: 80 },
      tags: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 8 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
    }, ["evidenceId", "studentId", "category", "documentType", "tags", "confidence", "idempotencyKey"]),
  },
  {
    name: "ask_parent",
    description: "Ask one concise clarification question when the capture cannot be routed safely.",
    inputSchema: objectSchema({
      question: { type: "string", minLength: 1, maxLength: 300 },
      reason: { enum: ["missing_student", "ambiguous_date", "ambiguous_intent", "uncertain_subject"] },
      choices: { type: "array", maxItems: 5, items: objectSchema({ id: { type: "string" }, label: { type: "string" } }, ["id", "label"]) },
    }, ["question", "reason"]),
  },
];

