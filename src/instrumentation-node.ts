// The Node.js half of src/instrumentation.ts, which says why.
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

setDefaultAutoSelectFamilyAttemptTimeout(2_500);
