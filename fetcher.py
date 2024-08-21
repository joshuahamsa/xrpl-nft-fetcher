import asyncio
import websockets
import json
import sqlite3
import binascii
import time
import requests
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database setup (SQLite in this example)
conn = sqlite3.connect('nftdata.db')
c = conn.cursor()

# Create the NFTs table if it doesn't exist
c.execute('''
    CREATE TABLE IF NOT EXISTS nfts (
        NFTokenID TEXT PRIMARY KEY,
        owner_address TEXT,
        name TEXT,
        image TEXT,
        trait1 TEXT,
        trait2 TEXT,
        trait3 TEXT,
        trait4 TEXT,
        trait5 TEXT,
        trait6 TEXT
    )
''')
conn.commit()

# List of WebSocket server URIs to rotate through
ws_uris = [
    "wss://s1.ripple.com/",
    "wss://xrplcluster.com/",
    "wss://s2.ripple.com/"
]

# Replace with your issuer's address and desired taxon
issuer_address = "rExampleIssuerAddress"
taxon = 1

async def fetch_nfts_by_issuer_and_taxon(issuer, taxon, ws_uris, marker=None):
    for ws_uri in ws_uris:
        try:
            logger.info(f"Attempting to connect to WebSocket server: {ws_uri}")
            async with websockets.connect(ws_uri) as websocket:
                request = {
                    "command": "nfts_by_issuer",
                    "issuer": issuer,
                    "nft_taxon": taxon,
                    "limit": 100,
                    "ledger_index": "validated"
                }
                if marker:
                    request["marker"] = marker

                await websocket.send(json.dumps(request))

                response = await websocket.recv()
                nft_data = json.loads(response)

                # Log the entire response for debugging
                logger.debug(f"Response: {json.dumps(nft_data, indent=2)}")

                if 'result' in nft_data:
                    nfts = nft_data['result'].get('nfts', [])
                    next_marker = nft_data['result'].get('marker', None)
                    logger.info(f"Fetched {len(nfts)} NFTs from {ws_uri}")
                    return nfts, next_marker
                else:
                    logger.error(f"Error in response from {ws_uri}: {nft_data}")
                    continue
        except Exception as e:
            logger.warning(f"Error connecting to {ws_uri}: {e}")

    logger.error("Failed to fetch NFTs from all available WebSocket servers.")
    return [], None

def hex_to_ascii(hex_string):
    try:
        ascii_string = binascii.unhexlify(hex_string).decode('utf-8')
    except Exception as e:
        logger.error(f"Error decoding hex: {e}")
        ascii_string = ""
    return ascii_string

ipfs_gateways = [
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
    "https://gateway.pinata.cloud/ipfs/"
]

def fetch_ipfs_metadata(uri, max_retries=50):
    if uri.startswith("ipfs://"):
        ipfs_hash = uri.split("ipfs://")[1]

        for gateway in ipfs_gateways:
            retries = 0
            while retries < max_retries:
                try:
                    ipfs_url = gateway + ipfs_hash
                    response = requests.get(ipfs_url)
                    if response.status_code == 200:
                        logger.info(f"Successfully fetched data from {gateway}")
                        return response.json()
                    else:
                        logger.warning(f"Error fetching IPFS data from {gateway}: {response.status_code}")
                except requests.exceptions.RequestException as e:
                    logger.warning(f"Request failed from {gateway}: {e}")

                retries += 1
                wait_time = 2 ** retries  # Exponential backoff: 2, 4, 8, 16, etc., seconds
                logger.info(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)

            logger.info(f"Switching to next gateway after {max_retries} retries with {gateway}")

    logger.error("All gateways failed")
    return {}

def store_nft_in_database(nftoken_id, owner_address, metadata):
    name = metadata.get("name", "")
    image = metadata.get("image", "")
    
    attributes = {attr["trait_type"]: attr["value"] for attr in metadata.get("attributes", [])}

    c.execute('''
        INSERT OR REPLACE INTO nfts (
            NFTokenID, owner_address, name, image, background, weapon, mask, helmet, chest, arms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        nftoken_id, owner_address, name, image,
        attributes.get("Background", ""),
        attributes.get("Weapon", ""),
        attributes.get("Mask", ""),
        attributes.get("Helmet", ""),
        attributes.get("Chest", ""),
        attributes.get("Arms", "")
    ))
    conn.commit()

async def process_nfts(issuer, taxon, ws_uris):
    marker = None
    total_nfts = 0
    while True:
        nfts, marker = await fetch_nfts_by_issuer_and_taxon(issuer, taxon, ws_uris, marker)
        if not nfts:
            logger.info("No more NFTs to process.")
            break

        for nft in nfts:
            if not nft.get("is_burned", False):
                nftoken_id = nft["nft_id"]
                owner_address = nft["owner"]
                uri_hex = nft.get("uri", "")
                uri_ascii = hex_to_ascii(uri_hex)
                metadata = fetch_ipfs_metadata(uri_ascii)

                store_nft_in_database(nftoken_id, owner_address, metadata)
                total_nfts += 1

        logger.info(f"Processed {total_nfts} NFTs so far.")

        if not marker:
            break  # No more pages to fetch

async def main():
    await process_nfts(issuer_address, taxon, ws_uris)
    logger.info("All NFTs have been processed and stored in the database.")

    # Close the database connection
    conn.close()

# Run the WebSocket client
asyncio.run(main())
