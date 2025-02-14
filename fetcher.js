const xrpl = require("xrpl");
const sqlite3 = require("sqlite3").verbose();

let fetch; // imported dynamically later

// ----------------------
// SQLite Promise Wrappers
// ----------------------
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ----------------------
// Database Setup
// ----------------------
const db = new sqlite3.Database("nfts.db", (err) => {
  if (err) console.error("Error opening database", err);
});

async function createTable() {
  const createSQL = `
    CREATE TABLE IF NOT EXISTS nfts (
      nft_id TEXT PRIMARY KEY,
      is_burned INTEGER,
      owner TEXT,
      name TEXT,
      image TEXT
    )
  `;
  await run(db, createSQL);
}

// Sanitize trait names to be used as SQL column names
function sanitizeColumnName(name) {
  return name.trim().toLowerCase().replace(/\W+/g, "_");
}

// Check if a column exists; if not, alter the table to add it.
async function ensureColumnExists(columnName) {
  const pragmaSQL = `PRAGMA table_info(nfts)`;
  const columns = await all(db, pragmaSQL);
  const exists = columns.some((col) => col.name === columnName);
  if (!exists) {
    const alterSQL = `ALTER TABLE nfts ADD COLUMN "${columnName}" TEXT`;
    await run(db, alterSQL);
    console.log(`Added column: ${columnName}`);
  }
}

// Store NFT details and metadata into the database.
async function storeNFTInDatabase(nftData, metadata) {
  // Base NFT data from the XRPL and metadata
  let data = {
    nft_id: nftData.nft_id,
    is_burned: nftData.is_burned ? 1 : 0,
    owner: nftData.owner,
    name: metadata.name || "",
    image: metadata.image || ""
  };

  // Process each trait from metadata.attributes
  if (metadata.attributes && Array.isArray(metadata.attributes)) {
    for (const attr of metadata.attributes) {
      const traitType = attr.trait_type;
      const traitValue = attr.value;
      if (traitType) {
        const colName = sanitizeColumnName(traitType);
        await ensureColumnExists(colName);
        data[colName] = traitValue;
      }
    }
  }

  // Build dynamic INSERT query.
  const columns = Object.keys(data).map((col) => `"${col}"`).join(", ");
  const placeholders = Object.keys(data).map(() => "?").join(", ");
  const values = Object.values(data);
  const sql = `INSERT OR REPLACE INTO nfts (${columns}) VALUES (${placeholders})`;

  await run(db, sql, values);
  console.log(`Stored NFT ${nftData.nft_id} in database.`);
}

// ----------------------
// Helper Functions
// ----------------------

// Decode a hex-encoded string to UTF-8.
function decodeHex(hexStr) {
  try {
    return Buffer.from(hexStr, "hex").toString("utf8");
  } catch (err) {
    console.error("Error decoding hex string:", err);
    return "";
  }
}

// Given a URI (which might be an IPFS link), fetch its JSON metadata.
async function fetchMetadata(uri) {
  if (!uri) return {};
  let url = uri;
  if (uri.startsWith("ipfs://")) {
    const ipfsHash = uri.slice(7);
    url = `https://ipfs.io/ipfs/${ipfsHash}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`HTTP error! status: ${res.status}`);
      return {};
    }
    const json = await res.json();
    return json;
  } catch (err) {
    console.error("Error fetching metadata:", err);
    return {};
  }
}

// Fetch NFTs by issuer (using the nfts_by_issuer command).
async function getNFTsByIssuer(issuer, taxon, limit = 500) {
  try {
    const client = new xrpl.Client("wss://s2-clio.ripple.com");
    await client.connect();
    console.log(`Querying NFTs for issuer: ${issuer} with taxon: ${taxon}`);

    let nfts = [];
    let marker = null;
    let batchCount = 0;

    do {
      batchCount++;
      const request = {
        method: "nfts_by_issuer",
        issuer: issuer,
        limit: limit,
        nft_taxon: taxon
      };

      if (marker) {
        request.marker = marker;
      }

      const response = await client.request(request);

      if (response.result.nfts && response.result.nfts.length > 0) {
        nfts = nfts.concat(response.result.nfts);
        console.log(
          `Batch ${batchCount}: Found ${response.result.nfts.length} NFTs (Total so far: ${nfts.length})`
        );
      }

      marker = response.result.marker;
      // Small delay to prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (marker);

    console.log(`Total NFTs found: ${nfts.length}`);
    await client.disconnect();
    return nfts;
  } catch (error) {
    console.error("Error fetching NFTs:", error);
    throw error;
  }
}

// For a given NFT, fetch detailed info (including the URI) using the nft_info API.
async function getNFTInfo(client, nft_id) {
  try {
    const response = await client.request({
      command: "nft_info",
      nft_id: nft_id
    });
    return response.result;
  } catch (error) {
    console.error(`Error fetching nft_info for ${nft_id}:`, error);
    return null;
  }
}

// ----------------------
// Main Process
// ----------------------
async function main() {
  // Get issuer address and taxon from command line arguments.
  if (process.argv.length < 4) {
    console.error("Usage: node script.js <issuer address> <taxon>");
    process.exit(1);
  }
  const ISSUER_ADDRESS = process.argv[2];
  const TAXON = parseInt(process.argv[3], 10);
  if (isNaN(TAXON)) {
    console.error("Taxon must be a number.");
    process.exit(1);
  }

  // Create the base table if it doesn't exist.
  await createTable();

  // Connect to XRPL client.
  const client = new xrpl.Client("wss://s2-clio.ripple.com");
  await client.connect();

  // Fetch NFTs by issuer.
  const nfts = await getNFTsByIssuer(ISSUER_ADDRESS, TAXON);
  console.log(`Fetched ${nfts.length} NFTs.`);

  // Process each NFT: retrieve additional info (URI), fetch metadata, then store in DB.
  for (const nft of nfts) {
    // Get detailed NFT info (including the URI) via nft_info.
    const info = await getNFTInfo(client, nft.nft_id);
    if (!info) continue;

    // The URI is expected as a hex string.
    let uriHex = info.uri || "";
    let uri = decodeHex(uriHex);
    console.log(`NFT ${nft.nft_id} URI: ${uri}`);

    // Fetch metadata JSON from the URI.
    const metadata = await fetchMetadata(uri);
    console.log(`Fetched metadata for NFT ${nft.nft_id}:`, metadata);

    // Store NFT data and metadata in the SQLite database.
    await storeNFTInDatabase(nft, metadata);

    // Small delay to pace requests.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await client.disconnect();
  db.close((err) => {
    if (err) console.error("Error closing database:", err);
    else console.log("Database closed.");
  });
}

// Dynamically import node-fetch and then start main().
(async () => {
  try {
    const fetchModule = await import("node-fetch");
    fetch = fetchModule.default;
    await main();
  } catch (err) {
    console.error("Error initializing fetch module:", err);
  }
})();
