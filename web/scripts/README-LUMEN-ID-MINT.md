# Creating the Lumen ID mint

The Lumen ID is a **Token-2022** mint with the **NonTransferable** extension (soulbound: cannot be transferred). You create it **once** on mainnet, then set the env vars for the API.

## Option A: Random mint address

```bash
cd web
npx ts-node --esm scripts/create-lumen-id-mint.ts --payer ./path/to/your-payer-keypair.json
```

The script will print `LUMEN_ID_MINT` and `LUMEN_ID_MINT_AUTHORITY`. Add them (and `LUMEN_ID_TREASURY`) to your env. The mint is created under the Token-2022 program and is non-transferable (soulbound).

## Option B: Vanity (nice) mint address

You can use a **pre-defined keypair** so the mint has a human-friendly public key (e.g. starting with `Lumen` or `lumen`).

### 1. Generate a vanity keypair

With [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools):

```bash
# Example: address starts with "Lumen" (case-sensitive)
solana-keygen grind --starts-with Lumen:1

# Or e.g. 6 chars
solana-keygen grind --starts-with lumen:1
```

This creates a keypair and writes it to `~/.config/solana/id.json` (overwriting the default). **Before grinding**, back up your existing keypair if you use it. **After grinding**, copy the new keypair to a dedicated file:

```bash
cp ~/.config/solana/id.json ./lumen-id-mint-keypair.json
# Restore your original wallet if needed: mv ~/.config/solana/id.json.backup ~/.config/solana/id.json
```

The JSON file is an array of 64 numbers (the secret key). **Keep it secret.**

### 2. Create the mint with that keypair

```bash
cd web
npx ts-node --esm scripts/create-lumen-id-mint.ts \
  --payer ./path/to/payer-keypair.json \
  --mint-keypair ./lumen-id-mint-keypair.json
```

The mint’s public key will be the vanity address from step 1.

### 3. Set env vars

Use the printed values:

- `LUMEN_ID_MINT` = mint public key (your nice address)
- `LUMEN_ID_MINT_AUTHORITY` = base58 secret of the **same** keypair (so the server can sign mint instructions)
- `LUMEN_ID_TREASURY` = your treasury wallet address (receives the 0.05 SOL per mint)

Optionally save the authority secret to a file and load it in prod from secrets:

```bash
npx ts-node --esm scripts/create-lumen-id-mint.ts \
  --payer ./payer.json \
  --mint-keypair ./lumen-id-mint-keypair.json \
  --out ./lumen-id-mint-authority.txt
```

Then set `LUMEN_ID_MINT_AUTHORITY` to the contents of `lumen-id-mint-authority.txt` and **do not commit** that file.

## Non-transferable (soulbound)

The script creates the mint under **Token-2022** with the **NonTransferable** extension. Holders cannot transfer the token to anyone else; it is soulbound to the wallet that minted it. If you already have a legacy SPL Token mint for Lumen ID, you must create a new Token-2022 mint and update `LUMEN_ID_MINT` (and optionally `LUMEN_ID_MINT_AUTHORITY`) in your env.
