/**
 * InvestigationDetailScreen — full detail view with notes, evidence, and field dispatch.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import { investigationsApi } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

type Route = RouteProp<InvestigationsStackParamList, 'InvestigationDetail'>;
type Nav = NativeStackNavigationProp<InvestigationsStackParamList, 'InvestigationDetail'>;

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6', in_progress: '#f97316', pending_review: '#eab308',
  closed: '#22c55e', escalated: '#ef4444',
};

export function InvestigationDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { id } = route.params;

  const [inv, setInv] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const data = await investigationsApi.get(id);
      setInv(data);
    } catch {
      Alert.alert('Error', 'Failed to load investigation');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setAddingNote(true);
    try {
      await investigationsApi.addNote(id, note.trim());
      setNote('');
      fetchDetail();
    } catch {
      Alert.alert('Error', 'Failed to add note');
    } finally { setAddingNote(false); }
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!inv) return <View style={styles.centered}><Text style={styles.errorText}>Not found</Text></View>;

  const status = String(inv.status ?? 'open');
  const notes = (inv.notes as unknown[]) ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.ref}>{String(inv.ref ?? '')}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] + '22' }]}>
            <Text style={[styles.badgeText, { color: STATUS_COLORS[status] }]}>{status.replace(/_/g,' ').toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.title}>{String(inv.title ?? '')}</Text>
        <Text style={styles.subject}>{String(inv.subject ?? '')}</Text>
      </View>

      {/* Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Details</Text>
        {[
          ['Risk Level', String(inv.riskLevel ?? 'unknown')],
          ['Assigned To', String(inv.assignedTo ?? 'Unassigned')],
          ['Created', inv.createdAt ? new Date(String(inv.createdAt)).toLocaleString() : '—'],
          ['Updated', inv.updatedAt ? new Date(String(inv.updatedAt)).toLocaleString() : '—'],
        ].map(([label, value]) => (
          <View key={label} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
          </View>
        ))}
      </View>

      {/* Description */}
      {inv.description ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.bodyText}>{String(inv.description)}</Text>
        </View>
      ) : null}

      {/* Notes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notes ({notes.length})</Text>
        {notes.map((n: unknown, i: number) => {
          const noteObj = n as Record<string, unknown>;
          return (
            <View key={i} style={styles.noteCard}>
              <Text style={styles.noteText}>{String(noteObj.content ?? noteObj.note ?? n)}</Text>
              <Text style={styles.noteTs}>{noteObj.createdAt ? new Date(String(noteObj.createdAt)).toLocaleString() : ''}</Text>
            </View>
          );
        })}
        <View style={styles.noteInputRow}>
          <TextInput
            style={styles.noteInput}
            placeholder="Add a note…"
            placeholderTextColor={colors.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <TouchableOpacity style={styles.addNoteBtn} onPress={handleAddNote} disabled={addingNote || !note.trim()}>
            {addingNote ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addNoteBtnText}>Add</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn}
          onPress={() => navigation.navigate('FieldAgent', { investigationId: id })}>
          <Text style={styles.actionBtnText}>Dispatch Field Agent</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.evidenceBtn]}
          onPress={() => navigation.navigate('CaptureEvidence', { investigationId: id })}>
          <Text style={styles.actionBtnText}>Capture Evidence</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#ef4444', fontSize: 14 },
  headerCard: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  ref: { fontSize: 11, fontFamily: 'Courier', color: colors.textMuted },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '600' },
  title: { ...typography.h3, color: colors.text, marginBottom: 4 },
  subject: { fontSize: 13, color: colors.textSecondary },
  section: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailLabel: { fontSize: 12, color: colors.textMuted },
  detailValue: { fontSize: 13, color: colors.text, fontWeight: '500' },
  bodyText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  noteCard: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 10, marginBottom: 8 },
  noteText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  noteTs: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  noteInputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  noteInput: { flex: 1, backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 10, color: colors.text, fontSize: 13, borderWidth: 1, borderColor: colors.border, minHeight: 44 },
  addNoteBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  addNoteBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  actionBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  evidenceBtn: { backgroundColor: '#8b5cf6' },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
