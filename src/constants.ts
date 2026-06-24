/**
 * Known Entity IDs from the Knowledge Graph Ontology
 *
 * These are system properties and types defined in the root space.
 * See knowledge-graph-ontology.md for the full registry.
 */

export const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";

// ─── Type IDs ────────────────────────────────────────────────────────────────

export const TYPES = {
  type:       "e7d737c536764c609fa16aa64a8c90ad",  // Type — meta-type for type definitions
  property:   "808a04ceb21c4d888ad12e240613e5ca",  // Property — meta-type for property definitions
  person:     "7ed45f2bc48b419e8e4664d5ff680b0d",
  project:    "484a18c5030a499cb0f2ef588ff16d50",
  event:      "4d876b81787e41fcab5d075d4da66a3f",
  dataset:    "0c4babfb43893486af827341bbf32e09",  // Dataset — AI-space dataset type
  topic:      "5ef5a5860f274d8e8f6c59ae5b3e89e2",
  // Keep env override support, but default to the confirmed AI-space ontology IDs.
  tag:        process.env.GEO_TAG_TYPE_ID || "e0fcc66c9e8643f480802469d8a1a93a",
  journal:    process.env.GEO_JOURNAL_TYPE_ID || "d3f2be5a7be2426b80cce890092e01fe",
  text_block: "76474f2f00894e77a0410b39fb17d0bf",  // Text Block — rich markdown content
  data_block: "b8803a8665de412bbb357e0c84adf473",  // Data Block — renders query or collection results
  image:      "ba4e41460010499da0a3caaa7f579d0e",  // Image — media entity with IPFS URL

  // ── Space-specific types (Evolution of Intelligence) ──────────────────────
  // Discovered via introspect on real paper entity (8c05944b…)
  paper:      "5e24fb52856c4189a9716af4387b1b89",  // Paper — native type in this space
};

// ─── Property IDs ────────────────────────────────────────────────────────────

export const PROPERTIES = {
  name:             "a126ca530c8e48d5b88882c734c38935",
  description:      "9b1f76ff9711404c861e59dc3fa7d037",
  types:            "8f151ba4de204e3c9cb499ddf96f48f1",
  web_url:          "eed38e74e67946bf8a42ea3e4f8fb5fb",
  birth_date:       "60f8b943d9a742109356fc108ee7212c",
  date_founded:     "41aa3d9847b64a97b7ec427e575b910e",
  topics:           "458fbc070dbf4c928f5716f3fdde7c32",
  blocks:           "beaba5cba67741a8b35377030613fc70",  // Blocks relation — attaches blocks to a parent entity
  markdown_content: "e3e363d1dd294ccb8e6ff3b76d99bc33",  // Markdown body for a text block
  data_source_type: "1f69cc9880d444abad493df6a7b15ee4",  // Declares query vs collection data source
  filter:           "14a46854bfd14b1882152785c2dab9f3",  // JSON-encoded filter for data blocks
  collection_item:  "a99f9ce12ffa4dac8c61f6310d46064a",  // Points to an entity in a collection
  view:             "1907fd1c81114a3ca378b1f353425b65",  // View preference on a Blocks relation
};

// ─── Data Source Singletons ──────────────────────────────────────────────────

export const QUERY_DATA_SOURCE      = "3b069b04adbe4728917d1283fd4ac27e";
export const COLLECTION_DATA_SOURCE = "1295037a5d9c4d09b27c5502654b9177";

// Discovered via introspect on "Recent papers" block (e67e2ae2…):
// "Data source type" → "Geo data source" — used for space-native query blocks
export const GEO_DATA_SOURCE        = "f9adb87452b949828f55aa40792751e3";

// ─── View Type IDs ───────────────────────────────────────────────────────────

export const VIEWS = {
  table:   "cba271cef7c140339047614d174c69f1",  // Table view (default)
  list:    "7d497dba09c249b8968f716bcf520473",  // List view
  gallery: "ccb70fc917f04a54b86e3b4d20cc7130",  // Gallery / grid view
  bullets: "0aaac6f7c916403eaf6d2e086dc92ada",  // Bulleted list view
};

// ─── Space Ontology — "Evolution of Intelligence" ─────────────────────────────
// Discovered by introspecting real entities in the space.
// Use these IDs instead of generic PROPERTIES when publishing papers.

export const SPACE_PROPS = {
  // ── Values (text properties on Paper entities) ─────────────────────────────
  description:          "9b1f76ff9711404c861e59dc3fa7d037",  // same as root
  web_url:              "412ff593e9154012a43d4c27ec5c68b6",  // ≠ root PROPERTIES.web_url!
  arxiv_url:            "b1417e3a509237b8f32970b6bf6f227e",
  semantic_scholar_url: "044660dd8984d7b46e11dfefa29eb8d4",
  key_contribution:     "875890d85e38caa08e325415d915b628",
  publication_date:     "3176c284b8653e6cfad174fb1ecd6af0",  // ≠ root PROPERTIES.date_founded!
  code_url:             "766386c7b6b1b77d4adac0ba8b5ba60d",
  citation_count:       "47ee87d8fac606d73e69d4c212804ffb",

  // ── Relations (relation type IDs on Paper entities) ────────────────────────
  authors:              "5c8a2a40986a29fe3430775cc2c0fa2e",  // direct Person relations
  published_in:         "8b87530a67774d93a9aa8321b7f10019",
  related_topics:       "806d52bc27e94c9193c057978b093351",  // ≠ root PROPERTIES.topics!
  related_projects:     "6e3503fab974460ea3dbab8af9a41427",
  peer_reviewed_by:     "f4b6a7714d934b1db24a30177a322b07",
  introduced_model:     "8ce0918670809f48b9ae52f9652c2d32",
  tags:                 "257090341ba5406f94e4d4af90042fba",
  cover:                "34f535072e6b42c5a84443981a77cfa2",

  // ── Filter helpers (for Query Data Blocks) ────────────────────────────────
  related_spaces:       "5b722cd361d6494e88871310566437ba",  // "Related spaces" — use {is: null} for space-local filter
};
