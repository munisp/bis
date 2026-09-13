import React, { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";

const LIMIT = 20;

export default function GoamlScreen() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isFetching, refetch } = trpc.goaml.list.useQuery({ offset, limit: LIMIT });
  const filings = data ?? [];
  return <View style={styles.container}>
    <Text style={styles.title}>goAML filings</Text>
    {isLoading ? <ActivityIndicator color="#38bdf8" /> : <FlatList data={filings} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#38bdf8" />} renderItem={({ item }) => <View style={styles.card}><Text style={styles.ref}>{item.filingRef}</Text><Text style={styles.detail}>{item.subjectName}</Text><Text style={styles.detail}>{item.transactionCurrency} {Number(item.transactionAmount ?? 0).toLocaleString()}</Text><Text style={styles.status}>{item.status.replace("_", " ").toUpperCase()}</Text></View>} ListEmptyComponent={<Text style={styles.empty}>No authorised goAML filings</Text>} onEndReached={() => { if (filings.length === LIMIT) setOffset((value) => value + LIMIT); }} onEndReachedThreshold={0.5} />}
  </View>;
}
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:"#0f172a",padding:16},title:{fontSize:22,fontWeight:"700",color:"#f8fafc",marginBottom:16},card:{backgroundColor:"#1e293b",padding:14,borderRadius:10,marginBottom:10},ref:{color:"#f8fafc",fontWeight:"700"},detail:{color:"#94a3b8",marginTop:3},status:{color:"#38bdf8",fontSize:11,marginTop:8,fontWeight:"700"},empty:{color:"#64748b",textAlign:"center",marginTop:48} });
