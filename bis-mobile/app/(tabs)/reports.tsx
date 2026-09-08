import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { trpc } from "@/lib/trpc";
const LIMIT = 20;
export default function ReportsScreen() {
  const [offset, setOffset] = useState(0);
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, refetch } = trpc.regulatoryReports.list.useQuery({ offset, limit: LIMIT });
  const transition = trpc.regulatoryReports.transition.useMutation({ onSuccess: () => void utils.regulatoryReports.list.invalidate(), onError: () => Alert.alert("Unable to submit", "The report status was not changed.") });
  const reports = data?.items ?? [];
  return <View style={styles.container}><Text style={styles.title}>Regulatory reports</Text>{isLoading ? <ActivityIndicator color="#3b82f6" /> : <FlatList data={reports} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#3b82f6" />} renderItem={({ item }) => <View style={styles.card}><Text style={styles.ref}>{item.reportRef}</Text><Text style={styles.detail}>{item.type}</Text><Text style={styles.status}>{item.status.replace("_", " ").toUpperCase()}</Text>{item.status === "draft" || item.status === "reviewed" ? <TouchableOpacity accessibilityRole="button" style={styles.button} disabled={transition.isPending} onPress={() => Alert.alert("Submit report", "Submit this report?", [{ text: "Cancel", style: "cancel" }, { text: "Submit", onPress: () => transition.mutate({ id: item.id, status: "submitted" }) }])}><Text style={styles.buttonText}>{transition.isPending ? "Submitting…" : "Submit"}</Text></TouchableOpacity> : null}</View>} ListEmptyComponent={<Text style={styles.empty}>No authorised reports</Text>} onEndReached={() => { if (offset + reports.length < (data?.total ?? 0)) setOffset((value) => value + LIMIT); }} onEndReachedThreshold={0.5} />}</View>;
}
const styles = StyleSheet.create({container:{flex:1,backgroundColor:"#0f172a",padding:16},title:{fontSize:22,fontWeight:"700",color:"#f8fafc",marginBottom:16},card:{backgroundColor:"#1e293b",padding:14,borderRadius:10,marginBottom:10},ref:{color:"#f8fafc",fontWeight:"700"},detail:{color:"#94a3b8",marginTop:4},status:{color:"#3b82f6",fontSize:11,marginTop:8,fontWeight:"700"},button:{backgroundColor:"#2563eb",borderRadius:6,padding:9,marginTop:10,alignSelf:"flex-start"},buttonText:{color:"#fff",fontWeight:"700",fontSize:12},empty:{color:"#64748b",textAlign:"center",marginTop:48}});
