import { Keypair, PublicKey } from '@solana/web3.js';
import { PaymentLinkData } from './deposit.js';
import { type LoggerFn } from './utils/logger.js';
export type { PaymentLinkData };
export declare class PrivacyCash {
    private connection;
    publicKey: PublicKey;
    private encryptionService;
    private keypair;
    private isRuning?;
    private status;
    constructor({ RPC_url, owner, enableDebug }: {
        RPC_url: string;
        owner: string | number[] | Uint8Array | Keypair;
        enableDebug?: boolean;
    });
    setLogger(loger: LoggerFn): this;
    /**
     * Clears the cache of utxos.
     *
     * By default, downloaded utxos will be cached in the local storage. Thus the next time when you makes another
     * deposit or withdraw or getPrivateBalance, the SDK only fetches the utxos that are not in the cache.
     *
     * This method clears the cache of utxos.
     */
    clearCache(): Promise<this>;
    /**
     * Get the receiving pubkey for this wallet.
     * Share this pubkey with senders who want to deposit funds for you.
     *
     * @returns The UTXO public key as a decimal string
     */
    getReceivingPubkey(): Promise<string>;
    /**
     * Get the public key for pay links (SAFE to share in URLs).
     * This is used for asymmetric encryption - only you can decrypt payments
     * made to this public key.
     *
     * @returns The box public key as a hex string (64 characters)
     */
    getPayLinkPublicKey(): string;
    /**
     * Get all data needed for a pay link.
     * Returns both the UTXO pubkey (for spending) and encryption public key (for visibility).
     * Both are SAFE to share!
     *
     * @returns Object with utxoPubkey and encryptionPublicKey
     */
    getPayLinkData(): Promise<{
        utxoPubkey: string;
        encryptionPublicKey: string;
    }>;
    /**
     * Deposit SOL to the Privacy Cash.
     *
     * Lamports is the amount of SOL in lamports. e.g. if you want to deposit 0.01 SOL (10000000 lamports), call deposit({ lamports: 10000000 })
     *
     * @param lamports - Amount in lamports to deposit
     * @param recipientUtxoPubkey - Optional: The recipient's UTXO pubkey (from their `getReceivingPubkey()`).
     *   When provided, creates a deposit that the recipient can spend.
     *   Returns `paymentLink` data (blinding, amount, index) that you share with the recipient.
     */
    deposit({ lamports, recipientUtxoPubkey }: {
        lamports: number;
        recipientUtxoPubkey?: string;
    }): Promise<{
        tx: string;
        paymentLink?: PaymentLinkData;
    }>;
    /**
    * Deposit USDC to the Privacy Cash.
    */
    depositUSDC({ base_units }: {
        base_units: number;
    }): Promise<{
        tx: string;
    }>;
    /**
     * Withdraw SOL from the Privacy Cash.
     *
     * Lamports is the amount of SOL in lamports. e.g. if you want to withdraw 0.01 SOL (10000000 lamports), call withdraw({ lamports: 10000000 })
     */
    withdraw({ lamports, recipientAddress, referrer }: {
        lamports: number;
        recipientAddress?: string;
        referrer?: string;
    }): Promise<{
        isPartial: boolean;
        tx: string;
        recipient: string;
        amount_in_lamports: number;
        fee_in_lamports: number;
    }>;
    /**
     * Claim funds from a payment link.
     *
     * The sender creates a payment link using `deposit({ recipientUtxoPubkey })` and shares
     * the returned `paymentLink` data with you. Use this method to claim those funds.
     *
     * @param paymentLink - The payment link data received from the sender
     * @param recipientAddress - Optional: Address to receive the funds. Defaults to your wallet.
     */
    claimPaymentLink({ paymentLink, recipientAddress, referrer }: {
        paymentLink: PaymentLinkData;
        recipientAddress?: string;
        referrer?: string;
    }): Promise<{
        tx: string;
        recipient: string;
        amount_in_lamports: number;
        fee_in_lamports: number;
    }>;
    /**
      * Withdraw USDC from the Privacy Cash.
      *
      * base_units is the amount of USDC in base unit. e.g. if you want to withdraw 1 USDC (1,000,000 base unit), call withdraw({ base_units: 1000000, recipientAddress: 'some_address' })
      */
    withdrawUSDC({ base_units, recipientAddress, referrer }: {
        base_units: number;
        recipientAddress?: string;
        referrer?: string;
    }): Promise<{
        isPartial: boolean;
        tx: string;
        recipient: string;
        base_units: number;
        fee_base_units: number;
    }>;
    /**
     * Returns the amount of lamports current wallet has in Privacy Cash.
     */
    getPrivateBalance(abortSignal?: AbortSignal): Promise<{
        lamports: number;
    }>;
    /**
    * Returns the amount of base unites current wallet has in Privacy Cash.
    */
    getPrivateBalanceUSDC(): Promise<{
        base_units: number;
        amount: number;
        lamports: number;
    }>;
    /**
    * Returns the amount of base unites current wallet has in Privacy Cash.
    */
    getPrivateBalanceSpl(mintAddress: PublicKey | string): Promise<{
        base_units: number;
        amount: number;
        lamports: number;
    }>;
    /**
     * Returns true if the code is running in a browser.
     */
    isBrowser(): boolean;
    startStatusRender(): Promise<void>;
    /**
   * Deposit SPL to the Privacy Cash.
   */
    depositSPL({ base_units, mintAddress, amount }: {
        base_units?: number;
        amount?: number;
        mintAddress: PublicKey | string;
    }): Promise<{
        tx: string;
    }>;
    /**
      * Withdraw SPL from the Privacy Cash.
      */
    withdrawSPL({ base_units, mintAddress, recipientAddress, amount, referrer }: {
        base_units?: number;
        amount?: number;
        mintAddress: PublicKey | string;
        recipientAddress?: string;
        referrer?: string;
    }): Promise<{
        isPartial: boolean;
        tx: string;
        recipient: string;
        base_units: number;
        fee_base_units: number;
    }>;
}
