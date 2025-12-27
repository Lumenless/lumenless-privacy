"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArciumRealPaymentClient } from "@/lib/arcium-real-payment";
import { useConnector } from "@solana/connector";
import { Wallet } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

interface PaymentData {
  amount: string;
  recipient: string;
  memo?: string;
}

export default function PrivatePaymentForm() {
  const { account, signTransaction, signAllTransactions } = useConnector();
  const publicKey = account ? new PublicKey(account.address) : null;
  const [mounted, setMounted] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData>({
    amount: "",
    recipient: "",
    memo: "",
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [transactionSignature, setTransactionSignature] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleInputChange = (field: keyof PaymentData, value: string) => {
    setPaymentData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!publicKey || !signTransaction || !signAllTransactions) {
      setPaymentStatus("Please connect your wallet first");
      return;
    }

    setIsProcessing(true);
    setPaymentStatus("Initializing private payment...");

    try {
      // Create wallet adapter for Arcium client
      // ConnectorKit's signTransaction returns base64, but Arcium expects Transaction objects
      // We need to create an adapter
      const wallet: Wallet = {
        publicKey,
        signTransaction: async (tx: any) => {
          if (!signTransaction) {
            throw new Error('Wallet does not support signing transactions');
          }
          // Serialize transaction and sign
          const signedBase64 = await signTransaction({
            transaction: tx.serialize({ requireAllSignatures: false }),
          });
          // Deserialize back to Transaction
          const signedBuffer = Buffer.from(signedBase64, 'base64');
          return Transaction.from(signedBuffer);
        },
        signAllTransactions: async (txs: any[]) => {
          if (!signAllTransactions) {
            throw new Error('Wallet does not support signing multiple transactions');
          }
          // Serialize all transactions
          const serialized = txs.map(tx => tx.serialize({ requireAllSignatures: false }));
          // Sign all
          const signedBase64Array = await signAllTransactions({
            transactions: serialized,
          });
          // Deserialize back to Transaction array
          return signedBase64Array.map((signed: string) => {
            const signedBuffer = Buffer.from(signed, 'base64');
            return Transaction.from(signedBuffer);
          });
        },
      } as Wallet;

      // Initialize Arcium private payment client
      const arciumClient = new ArciumRealPaymentClient(wallet);
      await arciumClient.initialize();
      
      setPaymentStatus("Encrypting payment data with Arcium...");

      // Create Arcium private payment transaction
      const amount = parseFloat(paymentData.amount);
      const { transaction, computationOffset } = await arciumClient.createPrivatePaymentTransaction(
        amount,
        paymentData.recipient,
        publicKey
      );

      setPaymentStatus("Signing private payment transaction...");

      // Sign and send the Arcium private payment
      const result = await arciumClient.signAndSendPrivatePayment(transaction);
      setTransactionSignature(result.signature);
      
      setPaymentStatus("Waiting for Arcium computation to complete...");

      // Wait for Arcium computation to complete
      await arciumClient.awaitPrivatePaymentCompletion(computationOffset);
      
      setPaymentStatus(`✅ Private payment completed! Transaction: ${result.signature}`);
      
    } catch (error) {
      console.error("Payment failed:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages
      if (errorMessage.includes('User rejected')) {
        setPaymentStatus('❌ Private payment cancelled: You rejected the transaction in your wallet.');
      } else if (errorMessage.includes('Insufficient funds')) {
        setPaymentStatus('❌ Insufficient funds: Not enough SOL in your wallet for private payment.');
      } else if (errorMessage.includes('Invalid recipient')) {
        setPaymentStatus('❌ Invalid recipient: Please check the recipient address.');
      } else if (errorMessage.includes('Arcium private payment failed')) {
        setPaymentStatus('❌ Arcium computation failed: The private payment was rejected by the network.');
      } else if (errorMessage.includes('not initialized')) {
        setPaymentStatus('❌ Arcium client error: Private payment client not properly initialized.');
      } else if (errorMessage.includes('Encryption failed')) {
        setPaymentStatus('❌ Encryption failed: Unable to encrypt payment data with Arcium.');
      } else {
        setPaymentStatus(`❌ Private payment failed: ${errorMessage}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (!mounted) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Private Payment</CardTitle>
          <CardDescription>
            Send encrypted payments using Arcium&apos;s confidential computation network
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Private Payment</CardTitle>
        <CardDescription>
          Send encrypted payments using Arcium&apos;s confidential computation network
        </CardDescription>
        {publicKey && (
          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-800">
              ✅ Wallet connected: {publicKey.toString().slice(0, 8)}...{publicKey.toString().slice(-8)}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium mb-1">
              Amount (SOL)
            </label>
            <Input
              id="amount"
              type="number"
              step="0.000000001"
              min="0"
              value={paymentData.amount}
              onChange={(e) => handleInputChange("amount", e.target.value)}
              placeholder="0.1"
              required
            />
          </div>

          <div>
            <label htmlFor="recipient" className="block text-sm font-medium mb-1">
              Recipient Address
            </label>
            <Input
              id="recipient"
              type="text"
              value={paymentData.recipient}
              onChange={(e) => handleInputChange("recipient", e.target.value)}
              placeholder="Enter Solana address"
              required
            />
          </div>

          <div>
            <label htmlFor="memo" className="block text-sm font-medium mb-1">
              Memo (Optional)
            </label>
            <Input
              id="memo"
              type="text"
              value={paymentData.memo || ""}
              onChange={(e) => handleInputChange("memo", e.target.value)}
              placeholder="Payment memo"
            />
          </div>

          <Button 
            type="submit" 
            className="w-full" 
            disabled={isProcessing || !publicKey}
          >
            {!publicKey ? "Connect Wallet First" : isProcessing ? "Processing..." : "Send Private Payment"}
          </Button>

          {paymentStatus && (
            <div className="mt-4 p-3 bg-gray-100 rounded-md">
              <p className="text-sm">{paymentStatus}</p>
            </div>
          )}

          {transactionSignature && (
            <div className="mt-4 p-3 bg-blue-50 rounded-md">
              <p className="text-sm font-medium">Transaction Signature:</p>
              <p className="text-xs text-gray-600 break-all mb-2">{transactionSignature}</p>
              <a 
                href={`https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                View on Solana Explorer →
              </a>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
