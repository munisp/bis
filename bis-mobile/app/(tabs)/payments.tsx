import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";

export default function PaymentsScreen() {
  const { data, isLoading, isFetching, refetch } = trpc.paymentRails.listTransfers.useQuery({ status: "all", limit: 30 });
  const transfers = data?.items ?? [];
  return <View style={styles.container}><Text style={styles.title}>Payment transfers</Text>{isLoading ? <ActivityIndicator color="#22c55e" /> : <FlatList data={transfers} keyExtractor={(item) => item.txRef} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#22c55e" />} renderItem={({ item }) => <View style={styles.card}><Text style={styles.ref}>{item.txRef}</Text><Text style={styles.detail}>{item.currency} {Number(item.amount ?? 0).toLocaleString()}</Text><Text style={styles.detail}>{item.beneficiaryName ?? "Beneficiary withheld"}</Text><Text style={styles.status}>{item.status.toUpperCase()}</Text></View>} ListEmptyComponent={<Text style={styles.empty}>No authorised transfer records</Text>} />}</View>;
}
const styles=StyleSheet.create({container:{flex:1,backgroundColor:"#0f172a",padding:16},title:{fontSize:22,fontWeight:"700",color:"#f8fafc",marginBottom:16},card:{backgroundColor:"#1e293b",padding:14,borderRadius:10,marginBottom:10},ref:{color:"#f8fafc",fontWeight:"700"},detail:{color:"#94a3b8",marginTop:3},status:{color:"#22c55e",fontSize:11,marginTop:8,fontWeight:"700"},empty:{color:"#64748b",textAlign:"center",marginTop:48}});
