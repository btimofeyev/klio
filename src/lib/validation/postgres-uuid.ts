import { z } from "zod";

// PostgreSQL accepts the complete 8-4-4-4-12 hexadecimal UUID shape. Some
// deterministic local fixtures intentionally do not encode RFC version or
// variant bits, so z.uuid() rejects identifiers the database already owns.
export const postgresUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Expected a PostgreSQL UUID.",
);
