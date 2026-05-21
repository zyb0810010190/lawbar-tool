// Wire the conformance harness against the in-memory implementation.

import { InMemoryCaseBoxPersistence } from "../dist/index.js";
import { runConformance } from "./conformance/runCaseBoxPersistenceConformance.mjs";

runConformance("InMemory", () => ({ Persistence: InMemoryCaseBoxPersistence }));
