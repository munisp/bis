import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { trpc } from "@/lib/trpc";
const LIMIT = 20;
export default function SARScreen() {
  const [offset, setOffset] = useState(0);
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, refetch } = trpc.sar.list.useQuery({ offset, limit: LIMIT });
  const submit = trpc.sar.submitForReview.useMutation({ onSuccess: () => void utils.sar.list.invalidate(), onError: () => Alert.alert("Unable to submit", "The SAR was not submitted for review.") });
  const filings = data?.items ?? [];
  return <View style={styles.container}><Text style={styles.title}>SAR filings</Text>{isLoading ? <ActivityIndicator color="#3b82f6" /> : <FlatList data={filings} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#3b82f6" />} renderItem={({ item }) => <View style={styles.card}><Text style={styles.ref}>{item.sarRef}</Text><Text style={styles.detail}>{item.subjectName}</Text><Text style={styles.detail}>{item.suspiciousCurrency} {Number(item.suspiciousAmount ?? 0).toLocaleString()}</Text><Text style={styles.status}>{item.status.replace("_", " ").toUpperCase()}</Text>{item.status === "draft" ? <TouchableOpacity style={styles.button} disabled={submit.isPending} onPress={() => Alert.alert("Submit SAR", "Submit this SAR for review?", [{ text:"Cancel", style:"cancel" }, { text:"Submit", onPress: () => submit.mutate({ id:item.id }) }])}><Text style={styles.buttonText}>{submit.isPending ? "Submitting…" : "Submit for review"}</Text></TouchableOpacity> : null}</View>} ListEmptyComponent={<Text style={styles.empty}>No authorised SAR filings</Text>} onEndReached={() => { if (offset + filings.length < (data?.total ?? 0)) setOffset((value) => value + LIMIT); }} onEndReachedThreshold={0.5} />}</View>;
}
const styles=StyleSheet.create({container:{flex:1,backgroundColor:"#0f172a",padding:16},title:{fontSize:22,fontWeight:"700",color:"#f8fafc",marginBottom:16},card:{backgroundColor:"#1e293b",padding:14,borderRadius:10,marginBottom:10},ref:{color:"#f8fafc",fontWeight:"700"},detail:{color:"#94a3b8",marginTop:3},status:{color:"#3b82f6",fontSize:11,marginTop:8,fontWeight:"700"},button:{backgroundColor:"#2563eb",borderRadius:6,padding:9,marginTop:10,alignSelf:"flex-start"},buttonText:{color:"#fff",fontWeight:"700",fontSize:12},empty:{color:"#64748b",textAlign:"center",marginTop:48}});
