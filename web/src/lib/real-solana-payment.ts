import { createSolanaRpc, type Base64EncodedWireTransaction, type Signature } from "@solana/kit";
import { PublicKey, Transaction, SystemProgram, Connection } from "@solana/web3.js"; // Temporary - for Transaction building until kit has full transaction support
import { LAMPORTS_PER_SOL } from "@solana/web3.js"; // Constant
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";

// Solana devnet RPC endpoint
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const rpc = createSolanaRpc(DEVNET_RPC);

// Real Solana payment implementation
export class RealSolanaPaymentClient {
  private provider: AnchorProvider;
  private rpc: ReturnType<typeof createSolanaRpc>;

  constructor(wallet: Wallet) {
    this.rpc = rpc;
    // AnchorProvider still needs Connection for now - keep using it temporarily
    // TODO: Migrate to kit-native provider when available
    const connection = new Connection(DEVNET_RPC, "confirmed");
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
  }

  async initialize() {
    try {
      console.log("Real Solana payment client initialized");
    } catch (error) {
      console.error("Failed to initialize Solana payment client:", error);
      throw error;
    }
  }

  async createPaymentTransaction(amount: number, recipient: string, sender: PublicKey) {
    try {
      console.log("Creating real Solana payment transaction...");
      
      // Convert SOL to lamports
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      
      // Create recipient public key
      const recipientPubkey = new PublicKey(recipient);
      
      // Create transaction using SystemProgram (this file still uses web3.js for AnchorProvider)
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipientPubkey,
          lamports: lamports,
        })
      );
      
      // Get recent blockhash
      const { value: { blockhash } } = await this.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = sender;
      
      console.log("Transaction created:", {
        amount: amount,
        lamports: lamports.toString(),
        recipient: recipient,
        sender: sender.toString(),
        blockhash: blockhash
      });
      
      return transaction;
    } catch (error) {
      console.error("Failed to create payment transaction:", error);
      throw error;
    }
  }

  async signAndSendTransaction(transaction: Transaction) {
    try {
      console.log("Signing and sending real transaction...");
      
      // Sign the transaction
      const signedTransaction = await this.provider.wallet.signTransaction(transaction);
      
      // Send the transaction using RPC
      const txBase64 = signedTransaction.serialize().toString('base64');
      const signatureResponse = await this.rpc.sendTransaction(txBase64 as Base64EncodedWireTransaction, { skipPreflight: false }).send();
      const signature = signatureResponse;
      
      console.log("Transaction sent with signature:", signature);
      
      // Wait for confirmation using getSignatureStatuses
      let confirmed = false;
      let attempts = 0;
      while (!confirmed && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const statusResponse = await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
        const status = statusResponse.value[0];
        if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
          confirmed = true;
        }
        if (status?.err) {
          throw new Error(`Transaction failed: ${status.err}`);
        }
        attempts++;
      }
      
      console.log("Transaction confirmed");
      
      return {
        signature,
        transaction: signedTransaction
      };
    } catch (error) {
      console.error("Failed to sign and send transaction:", error);
      throw error;
    }
  }

  async getTransactionDetails(signature: string) {
    try {
      const transaction = await this.rpc.getTransaction(signature as Signature, {
        commitment: "confirmed",
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
      }).send();
      
      if (!transaction) {
        throw new Error("Transaction not found");
      }
      
      return {
        signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        fee: transaction.meta?.fee,
        status: transaction.meta?.err ? "failed" : "success",
        logs: transaction.meta?.logMessages || []
      };
    } catch (error) {
      console.error("Failed to get transaction details:", error);
      throw error;
    }
  }

  async simulatePayment(amount: number, recipient: string, sender: PublicKey) {
    try {
      console.log("Simulating payment with real transaction...");
      
      // Create transaction
      const transaction = await this.createPaymentTransaction(amount, recipient, sender);
      
      // Simulate the transaction using RPC
      const txBase64 = transaction.serialize({ requireAllSignatures: false }).toString('base64');
      const simulationResponse = await this.rpc.simulateTransaction(txBase64 as Base64EncodedWireTransaction, {
        commitment: 'confirmed',
        sigVerify: false,
        encoding: 'base64',
      }).send();
      
      if (simulationResponse.value.err) {
        throw new Error(`Transaction simulation failed: ${simulationResponse.value.err}`);
      }
      
      console.log("Transaction simulation successful:", simulationResponse.value);
      
      return {
        success: true,
        simulation: simulationResponse.value,
        transaction
      };
    } catch (error) {
      console.error("Payment simulation failed:", error);
      throw error;
    }
  }
}

// Utility function to create a wallet from keypair
export function createWalletFromKeypair(keypair: { publicKey: PublicKey; sign: (tx: Transaction) => void }): Wallet {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx) => {
      if (tx instanceof Transaction) {
        keypair.sign(tx);
      }
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => {
        if (tx instanceof Transaction) {
          keypair.sign(tx);
        }
      });
      return txs;
    },
  } as Wallet;
}
