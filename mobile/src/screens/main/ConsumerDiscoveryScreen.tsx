import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  consumerDiscoveryApi,
  type ConsumerDiscoveryMode,
  type ConsumerDiscoveryProfile,
  type ConsumerDiscoveryPurpose,
} from '../../services/api';
import { colors, spacing, typography } from '../../utils/theme';

const PURPOSES: Array<{ value: ConsumerDiscoveryPurpose; label: string; consumer: boolean }> = [
  { value: 'self', label: 'My own record', consumer: true },
  { value: 'personal_safety', label: 'Personal safety', consumer: true },
  { value: 'fraud_prevention', label: 'Fraud prevention', consumer: true },
  { value: 'account_security', label: 'Account security', consumer: false },
  { value: 'compliance_investigation', label: 'Compliance investigation', consumer: false },
  { value: 'legal_authority', label: 'Legal authority', consumer: false },
];

type SearchKind = 'name' | 'phone' | 'email' | 'address';

export function ConsumerDiscoveryScreen() {
  const [mode, setMode] = useState<ConsumerDiscoveryMode>('consumer');
  const [kind, setKind] = useState<SearchKind>('name');
  const [purpose, setPurpose] = useState<ConsumerDiscoveryPurpose>('personal_safety');
  const [term, setTerm] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ConsumerDiscoveryProfile[]>([]);
  const [searched, setSearched] = useState(false);

  const selectMode = (next: ConsumerDiscoveryMode) => {
    setMode(next);
    if (next === 'consumer' && !PURPOSES.find(item => item.value === purpose)?.consumer) {
      setPurpose('personal_safety');
    }
  };

  const search = async () => {
    if (term.trim().length < 2) {
      Alert.alert('Search term required', 'Enter at least two characters to search the synthetic Nigeria dataset.');
      return;
    }
    if (!consentConfirmed) {
      Alert.alert('Purpose confirmation required', 'Confirm the permitted purpose and synthetic-data acknowledgement before searching.');
      return;
    }
    const input: {
      mode: ConsumerDiscoveryMode;
      purpose: ConsumerDiscoveryPurpose;
      consentConfirmed: true;
      countryCode: 'NG';
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
    } = { mode, purpose, consentConfirmed: true, countryCode: 'NG', [kind]: term.trim() };

    setLoading(true);
    try {
      await consumerDiscoveryApi.grantConsent({
        purpose,
        legalBasis: mode === 'consumer' ? 'consent' : 'legitimate_interest',
        policyVersion: 'NG-CONSUMER-2026-01',
        scopes: ['consumer_discovery', 'profile_detail', 'provenance', 'relationship_linkage'],
      });
      const response = await consumerDiscoveryApi.search(input);
      setResults(response.results);
      setSearched(true);
    } catch (error) {
      Alert.alert('Search unavailable', error instanceof Error ? error.message : 'The synthetic discovery service did not return a result.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View accessibilityRole="alert" style={styles.notice}>
        <Text style={styles.noticeTitle}>Synthetic demonstration environment</Text>
        <Text style={styles.noticeText}>All records are artificial Nigeria-first fixtures. They are not real people or provider data and must never support a real-world eligibility decision.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>People and Contact Discovery</Text>
        <Text style={styles.subtitle}>Nigeria-first lookup with declared purpose, consent acknowledgment, and provenance controls.</Text>

        <Text style={styles.label}>Access mode</Text>
        <View style={styles.chipRow}>
          {(['consumer', 'institutional'] as const).map(value => (
            <TouchableOpacity accessibilityRole="button" key={value} style={[styles.chip, mode === value && styles.chipActive]} onPress={() => selectMode(value)}>
              <Text style={[styles.chipText, mode === value && styles.chipTextActive]}>{value === 'consumer' ? 'Consumer' : 'Institutional'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Search type</Text>
        <View style={styles.chipRow}>
          {(['name', 'phone', 'email', 'address'] as const).map(value => (
            <TouchableOpacity accessibilityRole="button" key={value} style={[styles.chip, kind === value && styles.chipActive]} onPress={() => setKind(value)}>
              <Text style={[styles.chipText, kind === value && styles.chipTextActive]}>{value[0].toUpperCase() + value.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Purpose</Text>
        <View style={styles.chipRow}>
          {PURPOSES.filter(item => mode === 'institutional' || item.consumer).map(item => (
            <TouchableOpacity accessibilityRole="button" key={item.value} style={[styles.chip, purpose === item.value && styles.chipActive]} onPress={() => setPurpose(item.value)}>
              <Text style={[styles.chipText, purpose === item.value && styles.chipTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Search term</Text>
        <TextInput
          accessibilityLabel="Consumer discovery search term"
          style={styles.input}
          placeholder={kind === 'name' ? 'Amara Demo-Okafor' : kind === 'phone' ? '+2340000000001' : kind === 'email' ? 'name@example.test' : 'Example Road, Lagos'}
          placeholderTextColor={colors.textMuted}
          value={term}
          onChangeText={setTerm}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.consentRow}>
          <Switch value={consentConfirmed} onValueChange={setConsentConfirmed} accessibilityLabel="Confirm permitted purpose" />
          <Text style={styles.consentText}>I confirm the declared permitted purpose and understand that results are synthetic demonstration data only.</Text>
        </View>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Search synthetic Nigeria records" style={[styles.submitButton, loading && styles.submitButtonDisabled]} disabled={loading} onPress={search}>
          {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>Search synthetic Nigeria records</Text>}
        </TouchableOpacity>
      </View>

      {searched && <View style={styles.resultsSection}>
        <Text style={styles.resultsTitle}>Synthetic results</Text>
        {results.length === 0 ? <View style={styles.card}><Text style={styles.empty}>No synthetic Nigeria profile matches this query.</Text></View> : results.map(profile => <ProfileCard key={profile.profileRef} profile={profile} />)}
      </View>}
    </ScrollView>
  );
}

function ProfileCard({ profile }: { profile: ConsumerDiscoveryProfile }) {
  const location = [profile.location.addressLine, profile.location.cityOrLocality, profile.location.stateOrRegion].filter(Boolean).join(', ');
  return (
    <View style={styles.resultCard} accessible accessibilityLabel={`Synthetic profile ${profile.name}`}>
      <View style={styles.resultHeader}><View><Text style={styles.resultName}>{profile.name}</Text><Text style={styles.reference}>{profile.profileRef}</Text></View><Text style={styles.syntheticBadge}>SYNTHETIC</Text></View>
      <Text style={styles.detail}>{profile.contact.phone ?? 'No phone'}</Text>
      <Text style={styles.detail}>{profile.contact.email ?? 'No email'}</Text>
      <Text style={styles.detail}>{location || 'No address'}</Text>
      {profile.occupation && <Text style={styles.detail}>{profile.occupation}</Text>}
      <Text style={styles.noticeText}>{profile.provenance.notice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  notice: { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  noticeTitle: { color: '#78350f', fontWeight: '700', fontSize: 15, marginBottom: 5 },
  noticeText: { color: '#92400e', fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.h3, color: colors.text, marginBottom: 5 },
  subtitle: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 7, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.backgroundSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { borderColor: '#059669', backgroundColor: '#ecfdf5' },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: '#047857', fontWeight: '700' },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 10, marginTop: spacing.md },
  consentText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  submitButton: { backgroundColor: '#047857', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  submitButtonDisabled: { opacity: 0.65 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  resultsSection: { marginTop: spacing.lg, gap: spacing.sm },
  resultsTitle: { ...typography.h3, color: colors.text },
  empty: { color: colors.textMuted, textAlign: 'center', fontSize: 14 },
  resultCard: { backgroundColor: colors.card, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 7 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 3 },
  resultName: { color: colors.text, fontWeight: '700', fontSize: 16 },
  reference: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  syntheticBadge: { color: '#92400e', backgroundColor: '#fef3c7', overflow: 'hidden', borderRadius: 5, fontWeight: '700', fontSize: 10, paddingHorizontal: 7, paddingVertical: 4 },
  detail: { color: colors.textMuted, fontSize: 13 },
});
