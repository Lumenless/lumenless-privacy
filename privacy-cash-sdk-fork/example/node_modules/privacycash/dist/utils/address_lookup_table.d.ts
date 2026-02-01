import { Connection, PublicKey } from '@solana/web3.js';
/**
 * Helper function to use an existing ALT (recommended for production)
 * Use create_alt.ts to create the ALT once, then hardcode the address and use this function
 */
export declare function useExistingALT(connection: Connection, altAddress: PublicKey): Promise<{
    value: any;
} | null>;
export declare function getProtocolAddressesWithMint(programId: PublicKey, authority: PublicKey, treeAta: PublicKey, feeRecipient: PublicKey, feeRecipientAta: PublicKey): PublicKey[];
