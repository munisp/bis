import React, { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";
const LIMIT = 20;
export default function ScreeningScreen() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isFetching, refetch } = trpc.screening.list.useQuery({ offset, limit: LIMIT });
  const records = data?.records ?? [];
  return <View style={styles.container}><Text style={styles.title}>Screening records</Text>{isLoading ? <ActivityIndicator color="#3b82f6" /> : <FlatList data={records} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#3b82f6" />} renderItem={({ item }) => <View style={styles.card}><Text style={styles.name}>{item.subjectName ?? "Subject withheld"}</Text><Text style={styles.detail}>Type: {item.type}</Text><Text style={styles.detail}>Reference: {item.requestRef}</Text><Text style={styles.status}>{item.status.toUpperCase()}</Text></View>} ListEmptyComponent={<Text style={styles.empty}>No authorised screening records</Text>} onEndReached={() => { if (offset + records.length < (data?.total ?? 0)) setOffset((value) => value + LIMIT); }} onEndReachedThreshold={0.5} />}</View>;
}
const styles=StyleSheet.create({container:{flex:1,backgroundColor:"#0f172a",padding:16},title:{fontSize:22,fontWeight:"700",color:"#f8fafc",marginBottom:16},card:{backgroundColor:"#1e293b",padding:14,borderRadius:10,marginBottom:10},name:{color:"#f8fafc",fontWeight:"700"},detail:{color:"#94a3b8",marginTop:3},status:{color:"#3b82f6",fontSize:11,marginTop:8,fontWeight:"700"},empty:{color:"#64748b",textAlign:"center",marginTop:48}});
