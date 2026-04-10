# Spark Dream UI

Next.js frontend for the Spark Dream Cosmos SDK blockchain.

## Related Repos

- **Chain repo**: `/home/chill/cosmos/sparkdream/sparkdream/`
  - Proto definitions: `proto/sparkdream/blog/v1/` and `proto/sparkdream/commons/v1/`
- **TypeScript client library**: `/home/chill/cosmos/sparkdream/sparkdreamjs/`
  - Used as `@sparkdreamnft/sparkdreamjs` — provides proto-generated registry for tx signing
  - If missing interfaces/registries are needed (e.g. for session or commons modules), ask the user — they can create an updated npm package

## API Conventions

- The Cosmos SDK LCD REST API returns **snake_case** field names (e.g. `replies_enabled`, `created_at`, `content_type`).
- All TypeScript interfaces in `src/types/` must use snake_case to match the API responses.
- Proto-generated Go structs use `json:"field_name,omitempty"` tags, not camelCase proto JSON names.
