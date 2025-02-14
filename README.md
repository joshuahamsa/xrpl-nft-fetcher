# XRPL NFT Metadata Fetcher

A Node.js script that retrieves NFTs issued by a specified XRPL account and collection taxon. The script fetches detailed NFT information (including metadata hosted on HTTP/IPFS), decodes hex-encoded URIs, and dynamically stores NFT details along with their attributes into a local SQLite database.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Dependencies](#dependencies)
- [Contributing](#contributing)

## Overview

This script connects to the XRP Ledger (XRPL) using the `xrpl` library and fetches NFTs minted by a given issuer with a specified taxon. For each NFT, it:

1. Retrieves detailed NFT information using the `nft_info` command.
2. Decodes the NFT's URI from hex to UTF-8.
3. Fetches JSON metadata from the decoded URI (including IPFS links).
4. Dynamically updates a local SQLite database (`nfts.db`) to store the NFT data and its attributes.

The dynamic database schema allows new NFT traits to be stored as separate columns by sanitizing attribute names and altering the table if needed.

## Features

- **NFT Retrieval:** Query NFTs by issuer and taxon using the XRPL's `nfts_by_issuer` command.
- **Metadata Handling:** Decode hex-encoded URIs and fetch JSON metadata, including support for IPFS links.
- **Dynamic Schema:** Automatically create or add columns in the SQLite database to store NFT traits.
- **SQLite Integration:** Store NFT details, owner information, and custom attributes in a local database.

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/joshuahamsa/xrpl-nft-fetcher.git
   cd xrpl-nft-metadata-fetcher
   ```

2. **Install Dependencies:**

   Ensure you have [Node.js](https://nodejs.org/) installed, then run:

   ```bash
   npm install xrpl sqlite3
   ```

   *Note: The script dynamically imports `node-fetch` when needed.*

## Usage

Run the script by providing the issuer's XRPL address and the taxon number as command-line arguments:

```bash
node fetcher.js <issuer_address> <taxon>
```

**Example:**

```bash
node fetcher.js rExampleIssuer 12345
```

The script will:

- Create (or update) an SQLite database named `nfts.db`.
- Connect to the XRPL and query for NFTs issued by the specified address with the given taxon.
- For each NFT, fetch detailed information and metadata.
- Store the NFT data along with any dynamic attributes into the database.

## How It Works

1. **Database Setup:**  
   The script initializes an SQLite database (`nfts.db`) and creates a base table (`nfts`) if it doesn't exist. It uses promise-based wrappers for SQLite operations.

2. **Dynamic Columns for Traits:**  
   NFT metadata often includes attributes (traits). The script sanitizes these attribute names and dynamically alters the SQLite table to add new columns as needed.

3. **Fetching NFT Data:**
   - **nfts_by_issuer:** The script uses the XRPL client to fetch NFTs by issuer, iterating through paginated results.
   - **nft_info:** For each NFT, detailed info (including the hex-encoded URI) is retrieved.
   - **URI Decoding & Metadata Fetching:** The hex-encoded URI is decoded to UTF-8, then the script fetches JSON metadata (handling IPFS links by redirecting to a public gateway).

4. **Storing Data:**  
   The NFT details and its metadata (including any dynamic attributes) are stored in the SQLite database. Existing records are updated via an `INSERT OR REPLACE` query.

5. **Cleanup:**  
   Once all NFTs are processed, the XRPL client disconnects and the database connection is closed.

## Dependencies

- [xrpl](https://www.npmjs.com/package/xrpl)
- [sqlite3](https://www.npmjs.com/package/sqlite3)
- [node-fetch](https://www.npmjs.com/package/node-fetch) *(dynamically imported)*

## Contributing

Contributions are welcome! Please open an issue or submit a pull request if you have suggestions or improvements.
