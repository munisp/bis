package main

import "testing"

func TestNewTransactionalOutboxRejectsMissingDatabaseURL(t *testing.T) {
	outbox, err := newTransactionalOutbox("")
	if err == nil {
		t.Fatal("expected a missing DATABASE_URL to reject transactional outbox startup")
	}
	if outbox != nil {
		t.Fatal("expected no outbox when DATABASE_URL is missing")
	}
}

func TestNewTransactionalOutboxRejectsNonPostgresURL(t *testing.T) {
	outbox, err := newTransactionalOutbox("mysql://not-supported")
	if err == nil {
		t.Fatal("expected a non-PostgreSQL URL to reject transactional outbox startup")
	}
	if outbox != nil {
		t.Fatal("expected no outbox for a non-PostgreSQL URL")
	}
}

func TestStableEventKeyUsesBusinessReference(t *testing.T) {
	payload := []byte(`{"reference":"PAY-2026-0001","amount_kobo":5000}`)
	first := stableEventKey("bis.payment.events", payload)
	second := stableEventKey("bis.payment.events", payload)
	want := "bis.payment.events:PAY-2026-0001"
	if first != want || second != want {
		t.Fatalf("expected a stable referenced key %q, got %q and %q", want, first, second)
	}
}

func TestStableEventKeyDoesNotDeduplicateUnreferencedEvents(t *testing.T) {
	payload := []byte(`{"status":"verified"}`)
	first := stableEventKey("bis.gateway.nin_lookup", payload)
	second := stableEventKey("bis.gateway.nin_lookup", payload)
	if first == second {
		t.Fatal("unreferenced events must receive unique durable keys rather than being conflated")
	}
}
