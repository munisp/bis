import React, { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function StablecoinPage() {
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState<"USDC" | "eNaira" | "cUSD">("USDC");
  const [network, setNetwork] = useState<"ethereum" | "polygon" | "celo" | "nigeria">("ethereum");

  const { data: history, isLoading } = trpc.stablecoin.history.useQuery(
    { address: address || "0x0000000000000000000000000000000000000000", currency, network },
    { enabled: address.length > 0 }
  );

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Stablecoin Transfers</h1>
      <div className="flex gap-3 mb-6">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Wallet address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <select
          className="border rounded px-3 py-2"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as "USDC" | "eNaira" | "cUSD")}
        >
          <option value="USDC">USDC</option>
          <option value="eNaira">eNaira</option>
          <option value="cUSD">cUSD</option>
        </select>
        <select
          className="border rounded px-3 py-2"
          value={network}
          onChange={(e) => setNetwork(e.target.value as "ethereum" | "polygon" | "celo" | "nigeria")}
        >
          <option value="ethereum">Ethereum</option>
          <option value="polygon">Polygon</option>
          <option value="celo">Celo</option>
          <option value="nigeria">Nigeria (CBN CBDC)</option>
        </select>
      </div>
      {isLoading ? (
        <div className="text-gray-500">Loading transfers...</div>
      ) : (
        <div className="space-y-3">
          {(history?.transactions ?? []).map((t: any) => (
            <div key={t.txHash} className="border rounded p-4 bg-white shadow-sm">
              <div className="flex justify-between">
                <span className="font-mono text-sm">{t.txHash}</span>
                <span className={`text-sm font-medium ${
                  t.status === "completed" ? "text-green-600" :
                  t.status === "failed" ? "text-red-600" : "text-yellow-600"
                }`}>{t.status}</span>
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {t.from} → {t.to}
              </div>
              <div className="text-sm font-medium mt-1">
                {t.amount} {t.currency}
              </div>
            </div>
          ))}
          {(history?.transactions ?? []).length === 0 && address && (
            <div className="text-gray-500">No stablecoin transfers found for this address.</div>
          )}
          {!address && (
            <div className="text-gray-400 text-center py-8">Enter a wallet address to view transfer history.</div>
          )}
        </div>
      )}
    </div>
  );
}
